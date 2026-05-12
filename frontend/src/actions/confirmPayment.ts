'use server';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const schema = z.object({ paymentId: z.string().uuid() });

interface ConfirmedPaymentRow {
    id: string;
    transaction_id: string | null;
    amount_usd_minor: number;
    shipowner_id: string;
}

export async function confirmPayment(input: { paymentId: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { data: ok, error: gateErr } = await admin.rpc('can_confirm_payment', {
        p_payment_id: parsed.paymentId,
        p_profile_id: auth.user.id,
    });
    if (gateErr) throw gateErr;
    if (!ok) throw new Error('Not authorized to confirm this payment');

    const confirmedAt = new Date().toISOString();
    const { data: updated, error: updErr } = await admin
        .from('payments')
        .update({ status: 'CONFIRMED', confirmed_by: auth.user.id, confirmed_at: confirmedAt })
        .eq('id', parsed.paymentId)
        .select('id, transaction_id, amount_usd_minor, shipowner_id')
        .single();
    if (updErr) throw updErr;

    if (updated.transaction_id) {
        await splitOverpayment(admin, updated, auth.user.id);
        await admin.rpc('recompute_transaction_status', { p_transaction_id: updated.transaction_id });
    }

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Payment',
        entity_id: parsed.paymentId,
        details_json: { event: 'PAYMENT_CONFIRMED', confirmed_at: confirmedAt },
    });

    // Plan 7C-4: generate receipt PDF + send confirmation email
    // Both fail-soft — log on error, don't roll back the confirmation.
    let receiptResult: { receiptRef: string; pdfBuffer?: Uint8Array } | null = null;
    try {
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        receiptResult = await generatePaymentReceipt(admin, parsed.paymentId);
    } catch (e) {
        console.error(`[confirmPayment] receipt generation failed for ${parsed.paymentId}:`, e);
    }

    let txForNotif: { invoice_ref: string | null; vessel_name: string | null } | null = null;
    try {
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');

        // Lookup recipient (shipowner contact)
        const { data: ownerRow } = await admin
            .from('shipowners')
            .select('name, official_email')
            .eq('id', updated.shipowner_id)
            .single();

        if (ownerRow?.official_email) {
            const { data: tx } = updated.transaction_id
                ? await admin
                    .from('transactions')
                    .select('invoice_ref, vessel_name, tax_amount_usd')
                    .eq('id', updated.transaction_id)
                    .single()
                : { data: null as { invoice_ref: string | null; vessel_name: string | null; tax_amount_usd: number | null } | null };
            txForNotif = tx
                ? { invoice_ref: tx.invoice_ref as string | null, vessel_name: tx.vessel_name as string | null }
                : null;

            await sendPaymentConfirmationEmail({
                to: ownerRow.official_email as string,
                recipientName: (ownerRow.name as string) ?? 'Shipowner',
                vesselName: (tx?.vessel_name as string) ?? '—',
                invoiceRef: (tx?.invoice_ref as string) ?? '—',
                amountUsd: (updated.amount_usd_minor ?? 0) / 100,
                paidAt: new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),
                receiptRef: receiptResult?.receiptRef,
                receiptPdfBuffer: receiptResult?.pdfBuffer,
            });
        }
    } catch (e) {
        console.error(`[confirmPayment] email send failed for ${parsed.paymentId}:`, e);
    }

    // Plan 7F: in-app notification (email already dispatched above for PAYMENT_RECEIVED;
    // WALLET_TOPPED_UP path lets notifyOwner send its own topup email). Fail-soft.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        const isTopup = updated.transaction_id === null;
        if (isTopup) {
            const { data: wallet } = await admin
                .from('wallets')
                .select('balance_usd_minor')
                .eq('shipowner_id', updated.shipowner_id)
                .maybeSingle();
            await notifyOwner(admin, {
                shipownerId: updated.shipowner_id,
                kind: 'WALLET_TOPPED_UP',
                params: {
                    amount_usd: (updated.amount_usd_minor ?? 0) / 100,
                    new_balance_usd: ((wallet?.balance_usd_minor as number | undefined) ?? 0) / 100,
                },
                deepLink: '/owner/wallet',
            });
        } else {
            await notifyOwner(admin, {
                shipownerId: updated.shipowner_id,
                kind: 'PAYMENT_RECEIVED',
                params: {
                    vessel_name: txForNotif?.vessel_name ?? '—',
                    invoice_ref: txForNotif?.invoice_ref ?? '—',
                    amount_usd: (updated.amount_usd_minor ?? 0) / 100,
                    paid_at: confirmedAt,
                    receipt_ref: receiptResult?.receiptRef,
                },
                deepLink: `/owner/invoices?ref=${encodeURIComponent(txForNotif?.invoice_ref ?? '')}`,
                skipEmail: true,
                ...(receiptResult?.pdfBuffer
                    ? { attachments: { pdfBuffer: receiptResult.pdfBuffer, filename: `${receiptResult.receiptRef}.pdf` } }
                    : {}),
            });
        }
    } catch (notifyErr) {
        console.error(`[confirmPayment] notifyOwner failed for ${parsed.paymentId}:`, notifyErr);
    }

    return { ok: true, paymentId: parsed.paymentId };
}

async function splitOverpayment(
    admin: SupabaseClient,
    payment: ConfirmedPaymentRow,
    actorUserId: string,
): Promise<void> {
    if (!payment.transaction_id) return;

    const { data: tx } = await admin
        .from('transactions')
        .select('id, tax_amount_usd, shipowner_id')
        .eq('id', payment.transaction_id)
        .single();
    if (!tx) return;

    const dueMinor = Math.round(Number(tx.tax_amount_usd) * 100);

    const { data: summary } = await admin
        .from('transaction_paid_summary')
        .select('paid_usd_minor')
        .eq('transaction_id', payment.transaction_id)
        .maybeSingle();

    // paid_so_far includes this payment (just CONFIRMED). Subtract this row to get
    // "paid before this confirm" — the basis for "remaining due".
    const paidIncludingThis = Number(summary?.paid_usd_minor ?? payment.amount_usd_minor);
    const paidBefore = paidIncludingThis - payment.amount_usd_minor;
    const remainingBeforeThis = Math.max(0, dueMinor - paidBefore);

    if (payment.amount_usd_minor <= remainingBeforeThis) return;  // no overpay

    const adjusted = remainingBeforeThis;
    const excess = payment.amount_usd_minor - remainingBeforeThis;

    // Adjust this payment's amount_usd_minor to fit within remaining due
    await admin
        .from('payments')
        .update({ amount_usd_minor: adjusted })
        .eq('id', payment.id)
        .select('id')
        .single();

    // Look up wallet.id for ledger insert (mig 050 schema: wallet_ledger.wallet_id)
    const { data: wallet } = await admin
        .from('wallets')
        .select('id')
        .eq('shipowner_id', payment.shipowner_id)
        .maybeSingle();
    if (!wallet) return;

    await admin.from('wallet_ledger').insert({
        wallet_id: wallet.id,
        kind: 'OVERPAYMENT_CREDIT',
        amount_signed_usd_minor: excess,
        created_by: actorUserId,
    });
}
