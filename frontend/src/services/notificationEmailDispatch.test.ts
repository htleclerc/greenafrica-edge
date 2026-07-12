import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPaymentRejectedEmail: vi.fn().mockResolvedValue({ success: true }),
    sendProformaReminderEmail: vi.fn().mockResolvedValue({ success: true }),
    sendProformaIssuedEmail: vi.fn().mockResolvedValue({ success: true }),
    sendWalletTopupEmail: vi.fn().mockResolvedValue({ success: true }),
    sendKycRejectedEmail: vi.fn().mockResolvedValue({ success: true }),
    sendRefundIssuedEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { dispatchNotificationEmail } from './notificationEmailDispatch';

describe('dispatchNotificationEmail', () => {
    beforeEach(() => vi.clearAllMocks());

    it('routes PROFORMA_ISSUED to sendProformaIssuedEmail (cron replay path)', async () => {
        const res = await dispatchNotificationEmail({
            kind: 'PROFORMA_ISSUED',
            ownerEmail: 'op@test',
            ownerName: 'Air Co',
            bodyParams: { invoice_ref: 'PRO-2026-9', amount_usd: 104, vessel_name: '6O-GGA' },
        });
        const { sendProformaIssuedEmail } = await import('@/services/emailService');
        expect(sendProformaIssuedEmail).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'op@test', invoiceRef: 'PRO-2026-9', amountUsd: 104 }),
        );
        expect(res).not.toBeNull();
    });

    it('routes PROFORMA_REMINDER to sendProformaReminderEmail with mapped fields (pg_cron replay path)', async () => {
        const res = await dispatchNotificationEmail({
            kind: 'PROFORMA_REMINDER',
            ownerEmail: 'owner@test',
            ownerName: 'Ship Co',
            bodyParams: { invoice_ref: 'PRO-2026-7', amount_usd: 250, age_days: 7 },
        });
        const { sendProformaReminderEmail } = await import('@/services/emailService');
        expect(sendProformaReminderEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'owner@test',
                recipientName: 'Ship Co',
                invoiceRef: 'PRO-2026-7',
                amountUsd: 250,
                ageDays: 7,
            }),
        );
        expect(res).not.toBeNull();
    });

    it('defaults PROFORMA_REMINDER ageDays to 3 when age_days is absent', async () => {
        await dispatchNotificationEmail({
            kind: 'PROFORMA_REMINDER',
            ownerEmail: 'owner@test',
            ownerName: 'Ship Co',
            bodyParams: { invoice_ref: 'PRO-2026-8', amount_usd: 100 },
        });
        const { sendProformaReminderEmail } = await import('@/services/emailService');
        expect(sendProformaReminderEmail).toHaveBeenCalledWith(
            expect.objectContaining({ ageDays: 3, amountUsd: 100 }),
        );
    });

    it('returns null for an unwired kind', async () => {
        const res = await dispatchNotificationEmail({
            kind: 'WALLET_APPLIED',
            ownerEmail: 'op@test',
            ownerName: 'Air Co',
            bodyParams: {},
        });
        expect(res).toBeNull();
    });
});
