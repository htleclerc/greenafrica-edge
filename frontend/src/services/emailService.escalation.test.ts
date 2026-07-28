import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    cc: ['huissier@eidle.so', 'finance@so.gov'],
    recipientName: 'Demo Armateur',
    invoiceRef: 'PRO-2026-30-81be71091a2b',
    amountUsd: 11492,
    jurisdictionName: 'Republic of Djibouti',
    vesselName: 'GG DEMO PIONEER',
    pdfBuffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendCollectionEscalationEmail', () => {
    it('emploie un ton de renvoi huissier pour BAILIFF, avec PDF joint et cc', async () => {
        const { sendCollectionEscalationEmail } = await import('./emailService');
        await sendCollectionEscalationEmail({ ...base, tier: 'BAILIFF' });
        const call = sendMock.mock.calls[0][0];
        expect(String(call.subject)).toMatch(/bailiff|huissier/i);
        expect(String(call.html)).toMatch(/bailiff|huissier|legal recovery/i);
        expect(call.cc).toEqual(['huissier@eidle.so', 'finance@so.gov']);
        expect(call.attachments?.[0]?.filename).toMatch(/PRO-2026-30-81be71091a2b/);
        // souverain de la juridiction émettrice, pas le Somaliland par défaut
        expect(String(call.html)).toContain('Republic of Djibouti');
    });

    it('emploie un ton de procédure judiciaire pour JUDICIAL', async () => {
        const { sendCollectionEscalationEmail } = await import('./emailService');
        await sendCollectionEscalationEmail({ ...base, tier: 'JUDICIAL' });
        const call = sendMock.mock.calls[0][0];
        expect(String(call.subject)).toMatch(/judicial|judiciaire|proceedings/i);
        expect(String(call.html)).toMatch(/judicial|judiciaire|proceedings/i);
    });

    it('remonte l\'échec Resend', async () => {
        sendMock.mockResolvedValue({ data: null, error: { message: 'smtp down' } });
        const { sendCollectionEscalationEmail } = await import('./emailService');
        const r = await sendCollectionEscalationEmail({ ...base, tier: 'BAILIFF' });
        expect(r.success).toBe(false);
    });
});
