import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OWNER_INVOICES_PATH } from '@/lib/routes/ownerPaths';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    recipientName: 'Demo Armateur',
    periodLabel: 'July 2026',
    totalOutstandingUsd: 27992,
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendStatementReadyEmail', () => {
    it('nomme la période et le total, avec bouton portail', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail(base);
        const call = sendMock.mock.calls[0][0];
        expect(String(call.subject)).toMatch(/statement|July 2026/i);
        expect(String(call.html)).toContain('July 2026');
        // Route réelle du portail. L'assertion portait auparavant sur
        // /owner/invoices, supprimée lors de la convergence des portails :
        // le test verrouillait donc le lien mort au lieu de le détecter.
        expect(String(call.html)).toContain(OWNER_INVOICES_PATH);
    });

    it('joint le PDF quand fourni', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail({ ...base, pdfBuffer: new Uint8Array([1, 2, 3]) });
        expect(sendMock.mock.calls[0][0].attachments?.[0]?.filename).toMatch(/statement/i);
    });

    it('omet la pièce jointe sans PDF', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail(base);
        expect(sendMock.mock.calls[0][0].attachments).toBeUndefined();
    });
});
