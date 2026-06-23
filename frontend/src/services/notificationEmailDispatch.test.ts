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
