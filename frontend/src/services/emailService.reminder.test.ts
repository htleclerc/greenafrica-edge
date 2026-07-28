import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    recipientName: 'Demo Armateur',
    invoiceRef: 'PRO-2026-30-81be71091a2b',
    amountUsd: 11492,
    ageDays: 45,
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendProformaReminderEmail — ton par palier', () => {
    it('reste un rappel courtois pour J3/J7', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        await sendProformaReminderEmail({ ...base, ageDays: 3, tier: 'J3' });
        const subject = sendMock.mock.calls[0][0].subject as string;
        expect(subject.toLowerCase()).toContain('reminder');
    });

    it('emploie un ton de mise en demeure formelle à J30', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        await sendProformaReminderEmail({ ...base, ageDays: 30, tier: 'J30' });
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).toMatch(/formal notice|mise en demeure|formal demand/i);
    });

    it('signale l\'imminence d\'une procédure huissier à J45', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        await sendProformaReminderEmail({ ...base, ageDays: 45, tier: 'J45' });
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).toMatch(/bailiff|huissier|legal recovery|enforcement/i);
    });

    it('reste rétro-compatible sans tier (ancien appelant)', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        const res = await sendProformaReminderEmail(base);
        expect(res.success).toBe(true);
    });
});
