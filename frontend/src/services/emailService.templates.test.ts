import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
    Resend: class { emails = { send: sendMock }; },
}));

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

/** HTML capté par le mock Resend au dernier envoi. */
function sentHtml(): string {
    return sendMock.mock.calls[0][0].html as string;
}

/**
 * Contrat expediteur ↔ gabarit.
 *
 * `templates.test.ts` verifie les gabarits face a des jeux de valeurs ecrits a
 * la main ; ici on verifie que les expediteurs passent REELLEMENT toutes les
 * valeurs attendues. C'est cette moitie-la qui casse quand un marqueur est
 * ajoute au gabarit sans etre cable — et `renderEmailTemplate` leve, donc
 * l'e-mail ne part pas du tout.
 */
describe('expediteurs branches sur les gabarits du projet design', () => {
    it('sendInvoiceEmail rend un pro-forma complet', async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        const r = await sendInvoiceEmail({
            to: 'billing@armateur.test',
            recipientName: 'Demo Armateur',
            vesselName: 'GG DEMO PIONEER',
            invoiceRef: 'PRO-2026-81be7109',
            amountUsd: 11492,
            dueDate: '23 August 2026',
            mode: 'proforma',
            badge: 'TO PAY',
            pdfBuffer: new Uint8Array([1, 2, 3]),
            verifyUrl: 'https://greengate.africa/verify/PRO-2026-81be7109',
            jurisdictionName: 'Republic of Djibouti',
        });

        expect(r.success).toBe(true);
        const html = sentHtml();
        expect(html).not.toMatch(/\{\{/);
        expect(html).toContain('Pro-forma Invoice PRO-2026-81be7109');
        expect(html).toContain('$11,492');
        expect(html).toContain('Republic of Djibouti');
        expect(html).toContain('width:600px;max-width:600px');
    });

    it('sendPaymentConfirmationEmail tolere un recu absent', async () => {
        const { sendPaymentConfirmationEmail } = await import('./emailService');
        await sendPaymentConfirmationEmail({
            to: 'billing@armateur.test',
            recipientName: 'Demo Armateur',
            vesselName: 'GG DEMO PIONEER',
            invoiceRef: 'PRO-2026-81be7109',
            amountUsd: 11492,
            paidAt: '22 August 2026',
        });

        const html = sentHtml();
        expect(html).not.toMatch(/\{\{/);
        // Pas de reference de recu : la ligne reste, avec un tiret cadratin.
        expect(html).toContain('Receipt');
        expect(html).toContain('Republic of Somaliland');
    });

    it('sendOverdueAlertEmail rend la relance', async () => {
        const { sendOverdueAlertEmail } = await import('./emailService');
        await sendOverdueAlertEmail({
            to: 'billing@armateur.test',
            recipientName: 'Demo Armateur',
            vesselName: 'GG DEMO STAR',
            invoiceRef: 'PRO-2026-65e28ceb',
            amountUsd: 16500,
            daysOverdue: 45,
            verifyUrl: 'https://greengate.africa/dashboard/invoices',
        });

        const html = sentHtml();
        expect(html).not.toMatch(/\{\{/);
        expect(html).toContain('Port gate locked');
        expect(html).toContain('45');
    });

    it('sendArmateurInviteEmail rend l invitation sans organisation', async () => {
        const { sendArmateurInviteEmail } = await import('./emailService');
        await sendArmateurInviteEmail({
            to: 'agent@armateur.test',
            recipientName: 'Hassan Mahdi',
            inviterName: 'Operations, GreenGate',
            inviteUrl: 'https://greengate.africa/auth/sl?t=xyz',
            ttlHours: 6,
        });

        const html = sentHtml();
        expect(html).not.toMatch(/\{\{/);
        expect(html).toContain('agent@armateur.test');
        expect(html).toContain('6 hours');
    });

    it('sendVesselAccessCodeEmail rend le code', async () => {
        const { sendVesselAccessCodeEmail } = await import('./emailService');
        await sendVesselAccessCodeEmail({ to: 'owner@armateur.test', code: '482913' });

        const html = sentHtml();
        expect(html).not.toMatch(/\{\{/);
        expect(html).toContain('482913');
        expect(html).toContain('ACCESS CODE');
    });

    it('sendStatementReadyEmail rend le releve mensuel', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail({
            to: 'billing@armateur.test',
            recipientName: 'Demo Armateur',
            periodLabel: 'July 2026',
            totalOutstandingUsd: 27992,
            invoiceCount: 4,
        });

        const html = sentHtml();
        expect(html).not.toMatch(/\{\{/);
        expect(html).toContain('July 2026');
        expect(html).toContain('$27,992');
    });
});
