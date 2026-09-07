import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

import {
    sendLoginLinkEmail,
    sendStaffInviteEmail,
    sendPasswordResetEmail,
} from './emailService';

beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({ data: { id: 'm1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

const html = () => sendMock.mock.calls[0][0].html as string;

/**
 * Les trois e-mails d'authentification etaient les seuls a ne pas suivre la
 * charte : ils sortaient du rendu maison sombre (`emailLayout`) quand tous les
 * autres transactionnels utilisent les gabarits clairs de Claude Design.
 */
describe("e-mails d'authentification — gabarit clair", () => {
    const SHELL = 'background:#F4F4F1';

    it('le lien de connexion porte le gabarit clair, le lien, le code et le navire', async () => {
        await sendLoginLinkEmail({
            to: 'owner@example.com',
            recipientName: 'Demo Armateur',
            link: 'https://greengate.africa/owner/auth/callback?token_hash=th&type=magiclink',
            code: '504415',
            vesselName: 'GG DEMO STAR',
        });
        const out = html();
        expect(out).toContain(SHELL);
        expect(out).toContain('Your sign-in link');
        expect(out).toContain('504415');
        expect(out).toContain('GG DEMO STAR');
        expect(out).toContain('owner@example.com');
        // Le lien est echappe pour l'attribut : & devient &amp;.
        expect(out).toContain('token_hash=th&amp;type=magiclink');
    });

    // Sans navire, la ligne reste — `renderEmailTemplate` leve sur un marqueur
    // sans valeur, et un tiret vaut mieux qu'un e-mail non parti.
    it('rend un tiret quand aucun navire n’est resolu', async () => {
        await sendLoginLinkEmail({
            to: 'owner@example.com',
            recipientName: 'Demo Armateur',
            link: 'https://greengate.africa/x',
            code: '111111',
            vesselName: null,
        });
        expect(html()).toContain('\u2014');
    });

    it("l'invitation staff porte le gabarit clair, le role, et aucun code", async () => {
        await sendStaffInviteEmail({
            to: 'finadmin@greengate.africa',
            recipientName: 'Admin Financier',
            role: 'FINANCE_ADMIN',
            link: 'https://greengate.africa/auth/callback?token_hash=th',
            code: '999999',
        });
        const out = html();
        expect(out).toContain(SHELL);
        expect(out).toContain('You have been invited to GreenGate');
        expect(out).toContain('FINANCE_ADMIN');
        expect(out).toContain('finadmin@greengate.africa');
        // Le parcours d'invitation passe par le lien : il n'existe aucun ecran
        // ou saisir un code, l'afficher n'aurait servi qu'a semer le doute.
        expect(out).not.toContain('999999');
    });

    it('la reinitialisation porte le gabarit clair et le lien', async () => {
        await sendPasswordResetEmail({
            to: 'admin@greengate.africa',
            recipientName: 'Admin GREENGATE',
            link: 'https://greengate.africa/auth/callback?token_hash=th&type=recovery',
        });
        const out = html();
        expect(out).toContain(SHELL);
        expect(out).toContain('Reset your password');
        expect(out).toContain('admin@greengate.africa');
        expect(out).toContain('type=recovery');
    });

    it('aucun des trois ne retombe sur le rendu sombre', async () => {
        for (const send of [
            () => sendLoginLinkEmail({ to: 'a@b.co', recipientName: 'X', link: 'https://x.io', code: '1', vesselName: null }),
            () => sendStaffInviteEmail({ to: 'a@b.co', recipientName: 'X', role: 'MANAGER', link: 'https://x.io', code: '1' }),
            () => sendPasswordResetEmail({ to: 'a@b.co', recipientName: 'X', link: 'https://x.io' }),
        ]) {
            sendMock.mockClear();
            await send();
            const out = html();
            expect(out).toContain(SHELL);
            // Fond de carte du rendu maison sombre.
            expect(out).not.toContain('#111C18');
        }
    });
});
