import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
    Resend: class { emails = { send: sendMock }; },
}));

const params = {
    to: 'billing@armateur.com',
    recipientName: 'Demo Armateur',
    vesselName: 'GG DEMO PIONEER',
    invoiceRef: 'PRO-2026-30-81be71091a2b',
    amountUsd: 11492,
    dueDate: '23 August 2026',
    mode: 'proforma' as const,
    badge: 'TO PAY' as const,
    pdfBuffer: new Uint8Array([1, 2, 3]),
    verifyUrl: 'https://greengate.africa/verify/PRO-2026-30-81be71091a2b',
    jurisdictionName: 'Republic of Djibouti',
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendInvoiceEmail', () => {
    it('transmet les copies à Resend', async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        await sendInvoiceEmail({ ...params, cc: ['agent@port.com', 'finance@dj.gov'] });
        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({ cc: ['agent@port.com', 'finance@dj.gov'] }),
        );
    });

    it("omet le champ cc quand il n'y a aucune copie", async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        await sendInvoiceEmail(params);
        expect(sendMock.mock.calls[0][0].cc).toBeUndefined();
    });

    // RÉGRESSION — le corps annonçait « Republic of Somaliland » en dur, ce qui
    // faisait signer une facture djiboutienne par le mauvais État.
    it("nomme l'État émetteur de la transaction", async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        await sendInvoiceEmail(params);
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).toContain('Republic of Djibouti');
        expect(html).not.toContain('Republic of Somaliland');
    });
});
