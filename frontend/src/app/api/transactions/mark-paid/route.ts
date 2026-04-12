import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPaymentConfirmationEmail } from '@/services/emailService';

/**
 * POST /api/transactions/mark-paid
 *
 * Marks a transaction as PAID, updates the linked vessel's compliance status
 * to COMPLIANT, writes an audit log, and emails the shipping agent a receipt.
 *
 * Body: { transactionId: string, actingUserId: string, actingUserName: string }
 */
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    let body: { transactionId: string; actingUserId: string; actingUserName: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.transactionId) {
        return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, supabaseKey);
    const paidAt = new Date().toISOString();

    // 1. Update transaction
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .update({ status: 'PAID', paid_at: paidAt })
        .eq('id', body.transactionId)
        .select('id, vessel_id, vessel_name, vessel_imo, tax_amount_usd, invoice_pdf_url, created_at')
        .single();

    if (txErr || !tx) {
        return NextResponse.json({ error: txErr?.message || 'Transaction not found' }, { status: 404 });
    }

    // 2. Update vessel compliance status
    if (tx.vessel_id) {
        await admin
            .from('vessels')
            .update({ compliance_status: 'COMPLIANT', tax_liability_usd: 0 })
            .eq('id', tx.vessel_id);
    }

    // 3. Audit log
    await admin.from('audit_logs').insert({
        user_id: body.actingUserId,
        user_full_name: body.actingUserName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: tx.id,
        details_json: {
            vesselName: tx.vessel_name,
            amount: Number(tx.tax_amount_usd),
            newStatus: 'PAID',
            paidAt,
        },
    });

    // 4. Send confirmation email to vessel owner
    let emailResult: { success: boolean; id?: string; error?: string } = { success: false };
    if (tx.vessel_id) {
        const { data: vessel } = await admin
            .from('vessels')
            .select('owner_id')
            .eq('id', tx.vessel_id)
            .single();

        if (vessel?.owner_id) {
            const { data: ownerProfile } = await admin
                .from('profiles')
                .select('email, full_name')
                .eq('id', vessel.owner_id)
                .single();

            if (ownerProfile?.email) {
                const createdAt = new Date(tx.created_at);
                const invoiceRef = `INV-${createdAt.getFullYear()}-${tx.id.split('-')[1].toUpperCase()}`;
                emailResult = await sendPaymentConfirmationEmail({
                    to: ownerProfile.email,
                    recipientName: ownerProfile.full_name || 'Shipping Agent',
                    vesselName: tx.vessel_name,
                    invoiceRef,
                    amountUsd: Number(tx.tax_amount_usd),
                    paidAt: new Date(paidAt).toLocaleString('en-GB', {
                        day: '2-digit', month: 'long', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    }),
                    receiptUrl: tx.invoice_pdf_url ?? undefined,
                });

                if (!emailResult.success) {
                    console.error('[Mark Paid] Email failed:', emailResult.error);
                }
            }
        }
    }

    return NextResponse.json({
        success: true,
        transactionId: tx.id,
        paidAt,
        email: emailResult,
    });
}
