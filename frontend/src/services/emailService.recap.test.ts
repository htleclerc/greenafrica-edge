import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    cc: ['cc@armateur.com', 'finance@so.gov'],
    recipientName: 'Demo Armateur',
    lines: [
        { invoiceRef: 'PRO-1', vesselName: 'MV A', issuedAt: '2026-06-10', ageDays: 20, outstandingUsd: 16500 },
        { invoiceRef: 'PRO-2', vesselName: 'MV B', issuedAt: '2026-06-14', ageDays: 16, outstandingUsd: 11492 },
    ],
    totalOutstandingUsd: 27992,
    jurisdictionName: 'Republic of Djibouti',
    pdfBuffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendCollectionRecapEmail', () => {
    it('nomme le total dans le sujet, liste chaque facture, joint le PDF et propage le cc', async () => {
        const { sendCollectionRecapEmail } = await import('./emailService');
        await sendCollectionRecapEmail(base);
        const call = sendMock.mock.calls[0][0];
        // Round de correction 1 : la locale est desormais figee a 'en-US' dans
        // l'implementation (risque de production releve par la revue - un montant
        // du type 27992 se lit differemment en en-US/fr-FR/de-DE). On affirme donc
        // un format CONCRET, pas le resultat d'un second appel a .toLocaleString()
        // sur la meme reference : ce dernier serait circulaire (les deux traversent
        // la meme fonction non figee du runtime et ne peuvent jamais diverger), et
        // ne detecterait ni le vrai separateur rendu ni une regression qui
        // retirerait la locale explicite de l'implementation.
        expect(String(call.subject)).toContain('27,992');
        expect(String(call.html)).toContain('PRO-1');
        expect(String(call.html)).toContain('PRO-2');
        expect(String(call.html)).toContain('27,992');
        expect(String(call.html)).toContain('16,500'); // ligne PRO-1 (16500), meme separateur fige
        expect(call.cc).toEqual(['cc@armateur.com', 'finance@so.gov']);
        expect(call.attachments).toHaveLength(1);
        expect(call.attachments?.[0]?.filename).toMatch(/\.pdf$/);
        expect(Buffer.from(call.attachments?.[0]?.content).equals(Buffer.from(base.pdfBuffer))).toBe(true);
    });

    it('emploie un ton de recouvrement, distinct du relevé mensuel informatif', async () => {
        const { sendCollectionRecapEmail } = await import('./emailService');
        await sendCollectionRecapEmail(base);
        const call = sendMock.mock.calls[0][0];
        expect(String(call.html)).toMatch(/further collection action/i);
        expect(String(call.html)).not.toMatch(/not an invoice/i);
        // souverain de la juridiction émettrice, pas le repli Somaliland
        expect(String(call.html)).toContain('Republic of Djibouti');
    });

    it('remonte l\'échec Resend', async () => {
        sendMock.mockResolvedValue({ data: null, error: { message: 'smtp down' } });
        const { sendCollectionRecapEmail } = await import('./emailService');
        const r = await sendCollectionRecapEmail(base);
        expect(r.success).toBe(false);
    });
});
