import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';
import { sendPaymentConfirmationEmail } from '@/services/emailService';
import {
    generateReceiptPdf,
    generateAndStoreReceipt,
    buildReceiptRef,
    type ReceiptData,
} from '@/services/invoiceService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { acquireIdempotency } from '@/app/api/lib/idempotency';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';

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
    // Money-rail action: only SUPERADMIN and FINANCE_ADMIN may mark invoices
    // paid. Without this guard, any authenticated user (including a
    // SHIPPING_AGENT or MANAGER) could call this endpoint with any
    // transactionId and forge payment records.
    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) return auth.error;

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

    // Override caller-supplied actingUserId/Name with the verified session
    // identity. The body fields are kept for legacy compatibility but the
    // server side trusts only the JWT-derived profile.
    body.actingUserId = auth.user.id;
    body.actingUserName = auth.user.fullName;

    const paymentMethod = body.paymentMethod || 'wire_transfer';
    const paymentReference = body.paymentReference?.trim() || null;
    const paymentNotes = body.paymentNotes?.trim() || null;

    // Resolve the transaction's jurisdiction (find regardless of tenant), confine
    // the acting admin to it (SUPERADMIN may act on any), and scope all writes —
    // transactions/vessels are auto-filtered by jurisdiction_id below.
    let platform: SupabaseClient;
    try {
        platform = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }
    const { data: txJur, error: txJurErr } = await platform
        .from('transactions').select('jurisdiction_id').eq('id', body.transactionId).maybeSingle();
    if (txJurErr) return NextResponse.json({ error: txJurErr.message }, { status: 500 });
    if (!txJur) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    let admin: SupabaseClient;
    try {
        admin = createTenantClient(await assertAdminCanActOn(auth.user, (txJur as { jurisdiction_id: string }).jurisdiction_id));
    } catch {
        return NextResponse.json({ error: 'Forbidden: transaction belongs to another jurisdiction' }, { status: 403 });
    }

    // Idempotency: clients SHOULD send `Idempotency-Key: <uuid>` for retry
    // safety. If absent, we fall back to a domain state guard below
    // (.neq('status', 'PAID')) so double-submits are still safe — but the
    // client loses access to the cached response.
    const idem = await acquireIdempotency(request, admin, auth.user.id, body);
    if (idem.kind === 'replay') return idem.response;
    if (idem.kind === 'conflict') return idem.response;

    try {
        const result = await processMarkPaid(admin, body, paymentMethod, paymentReference, paymentNotes);
        await idem.commit(result.status, result.payload);
        return NextResponse.json(result.payload, { status: result.status });
    } catch (err) {
        await idem.rollback();
        throw err;
    }
}

async function processMarkPaid(
    admin: SupabaseClient,
    body: {
        transactionId: string;
        actingUserId: string;
        actingUserName: string;
    },
    paymentMethod: string,
    paymentReference: string | null,
    paymentNotes: string | null,
): Promise<{ status: number; payload: Record<string, unknown> }> {
    const paidAt = new Date().toISOString();

    // 1. Update transaction — STATE GUARD: only flip PENDING (or any non-PAID
    //    state) to PAID. Atomic at the Postgres level: two concurrent UPDATEs
    //    cannot both succeed because the second sees status='PAID' and
    //    matches 0 rows.
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .update({ status: 'PAID', paid_at: paidAt })
        .eq('id', body.transactionId)
        .neq('status', 'PAID')
        .select('id, vessel_id, vessel_name, vessel_imo, tax_amount_usd, invoice_pdf_url, created_at, jurisdiction_id')
        .single();

    if (txErr || !tx) {
        // Either the transaction does not exist OR it's already PAID. Fetch
        // existing state to distinguish — and if it's already paid, return a
        // 200 with `alreadyPaid: true` so retries are safe even without an
        // Idempotency-Key. We do NOT re-emit audit logs / receipts / emails.
        const { data: existing } = await admin
            .from('transactions')
            .select('id, status, paid_at, receipt_pdf_url')
            .eq('id', body.transactionId)
            .single();
        if (existing?.status === 'PAID') {
            return {
                status: 200,
                payload: {
                    success: true,
                    alreadyPaid: true,
                    transactionId: existing.id,
                    paidAt: existing.paid_at,
                    receiptPdfUrl: existing.receipt_pdf_url ?? null,
                },
            };
        }
        return {
            status: 404,
            payload: { error: txErr?.message || 'Transaction not found' },
        };
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

    // 4. Look up vessel owner profile (used by both receipt generation and email)
    let ownerProfile: { email: string; full_name: string } | null = null;
    if (tx.vessel_id) {
        const { data: vessel } = await admin
            .from('vessels')
            .select('owner_id')
            .eq('id', tx.vessel_id)
            .single();

        if (vessel?.owner_id) {
            const { data: profile } = await admin
                .from('profiles')
                .select('email, full_name')
                .eq('id', vessel.owner_id)
                .single();
            if (profile) ownerProfile = profile;
        }
    }

    // 5. Generate the OFFICIAL RECEIPT PDF + upload to Storage
    //    This is the proof-of-payment document, separate from the pro-forma.
    const paidAtDate = new Date(paidAt);
    const receiptRef = buildReceiptRef(tx.id, paidAtDate);
    const txRecord = tx as typeof tx & { jurisdiction_id?: string | null };
    const jurisdictionName = await fetchJurisdictionName(admin, txRecord.jurisdiction_id);
    const receiptData: ReceiptData = {
        receiptRef,
        invoiceRef,
        vesselName: tx.vessel_name,
        vesselImo: tx.vessel_imo,
        vesselMmsi: '',  // not in select, fall back to empty
        ownerName: ownerProfile?.full_name || 'Unassigned shipping agent',
        // Sovereign name resolved from the transaction's jurisdiction_id — never
        // hardcoded so Djibouti receipts name Djibouti, not Somaliland.
        jurisdiction: jurisdictionName,
        amountUsd: Number(tx.tax_amount_usd),
        paidAt: paidAtDate.toLocaleString('en-GB', {
            day: '2-digit', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
        }) + ' UTC',
        paymentMethod,
        paymentReference: paymentReference ?? undefined,
        paymentNotes: paymentNotes ?? undefined,
        confirmedBy: body.actingUserName,
    };

    let receiptPdfUrl: string | null = null;
    let receiptPdfBuffer: Uint8Array | null = null;
    try {
        receiptPdfUrl = await generateAndStoreReceipt(admin, receiptData);
        // Re-generate the buffer for the email attachment
        // (cheap — qrcode + jspdf rendering takes <100ms)
        receiptPdfBuffer = await generateReceiptPdf(receiptData);
    } catch (err) {
        console.error('[Mark Paid] Receipt generation failed:', err);
    }

    // 6. Update transaction with the receipt URL (best-effort — column may
    //    not exist yet if migration 014 hasn't been applied)
    if (receiptPdfUrl) {
        const { error: updateErr } = await admin
            .from('transactions')
            .update({ receipt_pdf_url: receiptPdfUrl })
            .eq('id', tx.id);
        if (updateErr) {
            console.warn('[Mark Paid] receipt_pdf_url update failed (apply migration 014?):', updateErr.message);
        }
    }

    // 7. Send confirmation email with the receipt PDF attached
    let emailResult: { success: boolean; id?: string; error?: string } = { success: false };
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
            receiptUrl: receiptPdfUrl ?? undefined,
            receiptRef,
            receiptPdfBuffer: receiptPdfBuffer ?? undefined,
        });

        if (!emailResult.success) {
            console.error('[Mark Paid] Email failed:', emailResult.error);
        }
    }

    return {
        status: 200,
        payload: {
            success: true,
            transactionId: tx.id,
            invoiceRef,
            receiptRef,
            receiptPdfUrl,
            paidAt,
            paymentMethod,
            paymentReference,
            paymentNotes,
            email: emailResult,
        },
    };
}
