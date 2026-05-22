/**
 * Plan 7H-1 — Pure email-dispatch helper extracted from
 * `notificationService.notifyOwner` switch block.
 *
 * Two call sites today:
 *   1. `notificationService.notifyOwner` — fired inline when an in-app row
 *      is INSERTed and the kind is in EMAIL_KINDS.
 *   2. `/api/cron/notification-email-loop` — daily replay for rows where
 *      `emailed_at IS NULL` (closes the loop for pg_cron-inserted rows
 *      like PROFORMA_REMINDER, where there is no inline call site).
 *
 * No DB writes here — caller is responsible for setting `emailed_at` /
 * counters / audit logs based on the returned EmailResult.
 *
 * Returns `null` for kinds not handled (defensive — caller should also
 * pre-filter via EMAIL_KINDS). Kinds intentionally NOT handled by this
 * dispatcher:
 *   - KYC_APPROVED: activation email lives at the call site (full role /
 *     operationalSite / activationUrl context).
 *   - WALLET_APPLIED, ALERT_DETECTED, KYC_C_REQUIRED, PROFORMA_ISSUED,
 *     FINAL_ISSUED, COMPLEMENT_ISSUED, WALLET_LOW_BALANCE,
 *     DISPUTE_UPDATED, OWNER_ESCALATION: not yet wired to a templated
 *     email — Plan 7H-2+ scope.
 */

import {
    sendPaymentConfirmationEmail,
    sendPaymentRejectedEmail,
    sendProformaReminderEmail,
    sendWalletTopupEmail,
    sendKycRejectedEmail,
    sendRefundIssuedEmail,
    type EmailResult,
    type RefundIssuedParams,
} from '@/services/emailService';
import type { NotificationKind } from '@/services/notificationService';

export interface DispatchNotificationEmailInput {
    kind: NotificationKind;
    ownerEmail: string;
    ownerName: string;
    bodyParams: Record<string, unknown>;
    attachments?: { pdfBuffer?: Uint8Array; filename?: string };
}

export async function dispatchNotificationEmail(
    input: DispatchNotificationEmailInput,
): Promise<EmailResult | null> {
    const { kind, ownerEmail, ownerName, bodyParams, attachments } = input;

    switch (kind) {
        case 'PAYMENT_RECEIVED':
            return sendPaymentConfirmationEmail({
                to: ownerEmail,
                recipientName: ownerName,
                vesselName: String(bodyParams.vessel_name ?? '—'),
                invoiceRef: String(bodyParams.invoice_ref ?? '—'),
                amountUsd: Number(bodyParams.amount_usd ?? 0),
                paidAt: String(bodyParams.paid_at ?? new Date().toLocaleString()),
                receiptRef: bodyParams.receipt_ref as string | undefined,
                receiptPdfBuffer: attachments?.pdfBuffer,
            });

        case 'PAYMENT_REJECTED':
            return sendPaymentRejectedEmail({
                to: ownerEmail,
                recipientName: ownerName,
                invoiceRef: String(bodyParams.invoice_ref ?? '—'),
                reason: String(bodyParams.reason ?? 'unspecified'),
            });

        case 'PROFORMA_REMINDER':
            return sendProformaReminderEmail({
                to: ownerEmail,
                recipientName: ownerName,
                invoiceRef: String(bodyParams.invoice_ref ?? '—'),
                amountUsd: Number(bodyParams.amount_usd ?? 0),
                ageDays: Number(bodyParams.age_days ?? 3),
            });

        case 'WALLET_TOPPED_UP':
            return sendWalletTopupEmail({
                to: ownerEmail,
                recipientName: ownerName,
                amountUsd: Number(bodyParams.amount_usd ?? 0),
                newBalanceUsd: Number(bodyParams.new_balance_usd ?? 0),
            });

        case 'KYC_REJECTED':
            return sendKycRejectedEmail({
                to: ownerEmail,
                recipientName: ownerName,
                reason: String(bodyParams.reason ?? 'See email for details'),
            });

        case 'REFUND_ISSUED':
            return sendRefundIssuedEmail({
                to: ownerEmail,
                recipientName: ownerName,
                invoiceRef: String(bodyParams.invoice_ref ?? '—'),
                amountUsd: Number(bodyParams.amount_usd ?? 0),
                refundRail: (bodyParams.refund_rail ?? 'WALLET') as RefundIssuedParams['refundRail'],
                executedAt: String(bodyParams.executed_at ?? new Date().toLocaleString()),
            });

        // Intentionally not wired — see file header.
        case 'KYC_APPROVED':
        case 'KYC_C_REQUIRED':
        case 'ALERT_DETECTED':
        case 'PROFORMA_ISSUED':
        case 'FINAL_ISSUED':
        case 'COMPLEMENT_ISSUED':
        case 'WALLET_APPLIED':
        case 'WALLET_LOW_BALANCE':
        case 'DISPUTE_UPDATED':
        case 'OWNER_ESCALATION':
        default:
            return null;
    }
}
