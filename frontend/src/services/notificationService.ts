import type { SupabaseClient } from '@supabase/supabase-js';
import {
    sendPaymentConfirmationEmail,
    sendPaymentRejectedEmail,
    sendProformaReminderEmail,
    sendProformaIssuedEmail,
    sendWalletTopupEmail,
    sendKycRejectedEmail,
    sendRefundIssuedEmail,
    type EmailResult,
    type RefundIssuedParams,
} from '@/services/emailService';

export type NotificationKind =
    | 'KYC_APPROVED' | 'KYC_REJECTED' | 'KYC_C_REQUIRED'
    | 'ALERT_DETECTED' | 'PROFORMA_ISSUED' | 'PROFORMA_REMINDER'
    | 'PAYMENT_RECEIVED' | 'PAYMENT_REJECTED'
    | 'FINAL_ISSUED' | 'COMPLEMENT_ISSUED' | 'REFUND_ISSUED'
    | 'WALLET_TOPPED_UP' | 'WALLET_APPLIED' | 'WALLET_LOW_BALANCE'
    | 'DISPUTE_UPDATED' | 'OWNER_ESCALATION';

/**
 * Set of kinds that ALSO dispatch an email (besides the in-app row).
 * Subset of NotificationKind. Per spec §6.2.
 *
 * NOTE: KYC_APPROVED is intentionally NOT in this set — the activation
 * email is dispatched at the call site (approveShipownerRegistration)
 * which has the full activation context (role/operationalSite/activationUrl).
 * Callers passing KYC_APPROVED should still set skipEmail: true defensively,
 * but its absence from EMAIL_KINDS prevents a silent-failure trap if forgotten.
 */
export const EMAIL_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
    'KYC_REJECTED', 'KYC_C_REQUIRED',
    'ALERT_DETECTED', 'PROFORMA_ISSUED', 'PROFORMA_REMINDER',
    'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
    'FINAL_ISSUED', 'COMPLEMENT_ISSUED', 'REFUND_ISSUED',
    'WALLET_TOPPED_UP', 'WALLET_LOW_BALANCE',
    'DISPUTE_UPDATED', 'OWNER_ESCALATION',
]);

export interface NotifyOwnerInput {
    shipownerId: string;
    kind: NotificationKind;
    params: Record<string, unknown>;
    deepLink?: string;
    skipEmail?: boolean;
    attachments?: { pdfBuffer?: Uint8Array; filename?: string };
}

/**
 * Title key in i18n. Body key derived as title.body_key.
 */
function titleKeyForKind(kind: NotificationKind): string {
    return `OwnerPortal.notifications.kind.${kind}.title`;
}
function bodyKeyForKind(kind: NotificationKind): string {
    return `OwnerPortal.notifications.kind.${kind}.body`;
}

/**
 * Central notification dispatch. Always INSERTs the in-app row. If kind ∈
 * EMAIL_KINDS AND skipEmail is not set, dispatches email via emailService.
 * Email failures are fail-soft (logged, not rethrown).
 */
export async function notifyOwner(
    client: SupabaseClient,
    input: NotifyOwnerInput,
): Promise<{ id: string }> {
    // 1. INSERT in-app notification row
    const { data: insertedRaw, error } = await client
        .from('owner_notifications')
        .insert({
            shipowner_id: input.shipownerId,
            kind: input.kind,
            title_key: titleKeyForKind(input.kind),
            body_key: bodyKeyForKind(input.kind),
            body_params: input.params,
            deep_link: input.deepLink ?? null,
        })
        .select('id')
        .single();
    if (error) throw new Error(`Failed to INSERT owner_notification: ${error.message}`);

    const inserted = insertedRaw as { id: string };

    // 2. Dispatch email if applicable
    if (!input.skipEmail && EMAIL_KINDS.has(input.kind)) {
        // Fire-and-forget; don't await inside the action's critical path beyond logging
        try {
            // Fetch owner email + preferred language
            const { data: owner } = await client
                .from('shipowners')
                .select('official_email, preferred_language, name')
                .eq('id', input.shipownerId)
                .single();
            if (owner && (owner as { official_email: string | null }).official_email) {
                const ownerEmail = (owner as { official_email: string }).official_email;
                const ownerName = (owner as { name: string | null }).name ?? 'Shipowner';

                let result: EmailResult | null = null;
                switch (input.kind) {
                    case 'PAYMENT_RECEIVED':
                        result = await sendPaymentConfirmationEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            vesselName: String(input.params.vessel_name ?? '—'),
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            paidAt: String(input.params.paid_at ?? new Date().toLocaleString()),
                            receiptRef: input.params.receipt_ref as string | undefined,
                            receiptPdfBuffer: input.attachments?.pdfBuffer,
                        });
                        break;
                    case 'PAYMENT_REJECTED':
                        result = await sendPaymentRejectedEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            reason: String(input.params.reason ?? 'unspecified'),
                        });
                        break;
                    case 'PROFORMA_REMINDER':
                        result = await sendProformaReminderEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            ageDays: Number(input.params.age_days ?? 3),
                        });
                        break;
                    case 'PROFORMA_ISSUED':
                        result = await sendProformaIssuedEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            vesselName: input.params.vessel_name as string | undefined,
                        });
                        break;
                    case 'WALLET_TOPPED_UP':
                        result = await sendWalletTopupEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            newBalanceUsd: Number(input.params.new_balance_usd ?? 0),
                        });
                        break;
                    // KYC_APPROVED: email is dispatched at the call site
                    // (approveShipownerRegistration) which has the activation
                    // context. notifyOwner only handles the in-app row; callers
                    // must pass skipEmail: true. If they forget, fall through
                    // here and skip silently.
                    case 'KYC_REJECTED':
                        result = await sendKycRejectedEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            reason: String(input.params.reason ?? 'See email for details'),
                        });
                        break;
                    case 'REFUND_ISSUED':
                        result = await sendRefundIssuedEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            refundRail: input.params.refund_rail as RefundIssuedParams['refundRail'],
                            executedAt: String(input.params.executed_at ?? new Date().toLocaleString()),
                        });
                        break;
                    default:
                        // Other EMAIL_KINDS not yet wired (deferred to 7G/7H)
                        result = null;
                }

                if (result?.success) {
                    // Mark emailed_at
                    await client.from('owner_notifications')
                        .update({ emailed_at: new Date().toISOString() })
                        .eq('id', inserted.id);
                }
            }
        } catch (e) {
            // Fail-soft: log but don't rethrow
            console.error(`[notifyOwner] email dispatch failed for ${input.kind}:`, e);
        }
    }

    return { id: inserted.id };
}
