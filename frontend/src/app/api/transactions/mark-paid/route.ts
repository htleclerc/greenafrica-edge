import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPaymentConfirmationEmail } from '@/services/emailService';

/**
 * POST /api/transactions/mark-paid
 *
 * Marks a transaction as PAID, updates the linked vessel's compliance status
 * to COMPLIANT, writes a rich audit log capturing how the payment was made,
 * and emails the shipping agent a receipt.
 *
 * Body: {
 *   transactionId:    string,
 *   actingUserId:     string,
 *   actingUserName:   string,
 *   paymentMethod?:   'wire_transfer'|'stripe'|'paystack'|'flutterwave'|'wave'|'cash'|'mobile_money'|'other',
 *   paymentReference?: string,  // bank confirmation number, SWIFT MT103 ref, etc.
 *   paymentNotes?:    string,  // free text from the admin
 * }
 *
 * paymentMethod defaults to 'wire_transfer' (the platform's manual flow)
 * if not provided.
 */
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    let body: {
        transactionId: string;
        actingUserId: string;
        actingUserName: string;
        paymentMethod?: string;
        paymentReference?: string;
        paymentNotes?: string;
    };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.transactionId) {
        return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const paymentMethod = body.paymentMethod || 'wire_transfer';
    const paymentReference = body.paymentReference?.trim() || null;
    const paymentNotes = body.paymentNotes?.trim() || null;

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

    // 3. Audit log — capture WHO confirmed, WHEN, BY WHAT MEANS, and the
    //    bank/provider reference if any. This is the canonical source of
    //    truth for the payment trail in the Audit tab of InvoicesPage.
    const createdAt = new Date(tx.created_at);
    const invoiceRef = `INV-${createdAt.getFullYear()}-${tx.id.split('-')[1].toUpperCase()}`;
    await admin.from('audit_logs').insert({
        user_id: body.actingUserId,
        user_full_name: body.actingUserName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: tx.id,
        details_json: {
            event: 'PAYMENT_RECEIVED',
            invoiceRef,
            vesselName: tx.vessel_name,
            vesselImo: tx.vessel_imo,
            amountUsd: Number(tx.tax_amount_usd),
            currency: 'USD',
            previousStatus: 'PENDING',
            newStatus: 'PAID',
            paidAt,
            paymentMethod,
            paymentReference,
            paymentNotes,
            confirmedBy: body.actingUserName,
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
        invoiceRef,
        paidAt,
        paymentMethod,
        paymentReference,
        paymentNotes,
        email: emailResult,
    });
}
