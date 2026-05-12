import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the most recent call to resend.emails.send so each test
// can inspect subject / html / text payloads.
const sendMock = vi.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null });

vi.mock('resend', () => ({
    Resend: class {
        emails = { send: sendMock };
    },
}));

import {
    sendPaymentRejectedEmail,
    sendProformaReminderEmail,
    sendWalletTopupEmail,
    sendKycRejectedEmail,
} from './emailService';

beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({ data: { id: 'msg-123' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendPaymentRejectedEmail', () => {
    it('sends with subject and escaped reason', async () => {
        const result = await sendPaymentRejectedEmail({
            to: 'owner@example.com',
            recipientName: '<script>Alice</script>',
            invoiceRef: 'PRO-2026-0001',
            reason: 'Invalid IBAN <bad>',
        });
        expect(result.success).toBe(true);
        expect(sendMock).toHaveBeenCalledTimes(1);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('Payment declined');
        expect(call.subject).toContain('PRO-2026-0001');
        expect(call.html).toContain('&lt;script&gt;');
        expect(call.html).toContain('&lt;bad&gt;');
        expect(call.html).not.toContain('<script>Alice');
    });
});

describe('sendProformaReminderEmail', () => {
    it('sends with age and amount in subject', async () => {
        const result = await sendProformaReminderEmail({
            to: 'owner@example.com',
            recipientName: 'Bob',
            invoiceRef: 'PRO-2026-0002',
            amountUsd: 12500,
            ageDays: 7,
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('PRO-2026-0002');
        expect(call.subject).toContain('7 days');
        expect(call.html).toContain('Payment Reminder');
    });
});

describe('sendWalletTopupEmail', () => {
    it('sends with amount and new balance', async () => {
        const result = await sendWalletTopupEmail({
            to: 'owner@example.com',
            recipientName: 'Carol',
            amountUsd: 5000,
            newBalanceUsd: 15000,
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('Wallet topped up');
        expect(call.html).toContain('Wallet Topped Up');
    });
});

describe('sendKycRejectedEmail', () => {
    it('sends with escaped reason', async () => {
        const result = await sendKycRejectedEmail({
            to: 'applicant@example.com',
            recipientName: 'Dave',
            reason: 'Document <missing>',
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toBe('Registration not approved');
        expect(call.html).toContain('&lt;missing&gt;');
    });
});
