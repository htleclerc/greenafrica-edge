import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const ENV_KEYS = [
    'RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_VERIFIED_SENDER_DOMAINS',
    'EMAIL_TRANSPORT', 'EMAIL_SMTP_HOST', 'EMAIL_REDIRECT_TO',
] as const;
const saved: Record<string, string | undefined> = {};

const LINK = { to: 'membre@example.com', recipientName: 'Membre', link: 'https://x.io/l', code: '123456', vesselName: null };

/** Adresse d'expédition réellement passée à l'acheminement. */
async function sentFrom(): Promise<string> {
    const { sendLoginLinkEmail } = await import('./emailService');
    await sendLoginLinkEmail(LINK);
    return sendMock.mock.calls[0][0].from;
}

beforeEach(() => {
    vi.resetModules();
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.RESEND_API_KEY = 'test-key';
    sendMock.mockReset().mockResolvedValue({ data: { id: 'm1' }, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

/**
 * Le 2026-09-04, EMAIL_FROM pointait sur `mail.africgreen.africa` en
 * production : Resend refusait CHAQUE envoi pour domaine non vérifié, et
 * l'avertissement que le code émettait n'a sauvé aucun e-mail. Le repli doit
 * donc agir, pas seulement prévenir.
 */
describe("adresse d'expédition", () => {
    it('garde un EMAIL_FROM sur un domaine vérifié', async () => {
        process.env.EMAIL_FROM = 'facturation@mail.greengate.africa';
        expect(await sentFrom()).toBe('facturation@mail.greengate.africa');
    });

    it('accepte le sous-domaine noreply, vérifié chez Resend', async () => {
        process.env.EMAIL_FROM = 'ops@noreply.greengate.africa';
        expect(await sentFrom()).toBe('ops@noreply.greengate.africa');
    });

    it('remplace un domaine non vérifié par le repli au lieu de laisser partir un envoi condamné', async () => {
        process.env.EMAIL_FROM = 'noreply@mail.africgreen.africa';
        expect(await sentFrom()).toBe('noreply@greengate.africa');
    });

    it('journalise le remplacement en erreur', async () => {
        process.env.EMAIL_FROM = 'noreply@mail.africgreen.africa';
        await sentFrom();
        const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
        expect(logged).toContain('mail.africgreen.africa');
        expect(logged).toContain('noreply@greengate.africa');
    });

    it('retombe sur le repli quand EMAIL_FROM est absent', async () => {
        expect(await sentFrom()).toBe('noreply@greengate.africa');
    });

    it('EMAIL_VERIFIED_SENDER_DOMAINS ouvre un domaine nouvellement vérifié', async () => {
        process.env.EMAIL_FROM = 'ops@nouveau-domaine.africa';
        process.env.EMAIL_VERIFIED_SENDER_DOMAINS = 'nouveau-domaine.africa, greengate.africa';
        expect(await sentFrom()).toBe('ops@nouveau-domaine.africa');
    });

    it('ne substitue rien sous SMTP — le serveur a ses propres règles', async () => {
        delete process.env.RESEND_API_KEY;
        process.env.EMAIL_SMTP_HOST = 'smtp.gmail.com';
        process.env.EMAIL_FROM = 'ops@mail.africgreen.africa';
        const { sendLoginLinkEmail } = await import('./emailService');
        // L'envoi SMTP échoue faute de serveur joignable ; seule compte ici
        // l'absence de substitution, vérifiée par le fait qu'aucun
        // avertissement de domaine n'est émis.
        await sendLoginLinkEmail(LINK).catch(() => undefined);
        const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
        expect(logged).not.toContain('absent des domaines vérifiés');
    });
});
