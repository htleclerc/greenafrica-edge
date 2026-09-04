import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resendSend = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

const ENV_KEYS = [
    'RESEND_API_KEY', 'EMAIL_TRANSPORT', 'EMAIL_SMTP_HOST', 'EMAIL_SMTP_PORT',
    'EMAIL_SMTP_SECURE', 'EMAIL_SMTP_USER', 'EMAIL_SMTP_PASSWORD',
] as const;

const saved: Record<string, string | undefined> = {};

const message = {
    from: 'noreply@greengate.africa',
    to: ['armateur@example.com'],
    subject: 'Sujet',
    html: '<p>corps</p>',
};

beforeEach(() => {
    vi.resetModules();
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    resendSend.mockReset().mockResolvedValue({ data: { id: 'resend-1' }, error: null });
    sendMail.mockReset().mockResolvedValue({ messageId: 'smtp-1' });
    createTransport.mockClear();
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('selectedTransport', () => {
    it('ne retient rien quand aucun fournisseur n\'est configure', async () => {
        const { selectedTransport } = await import('./transport');
        expect(selectedTransport()).toBeNull();
    });

    it('retient resend des que la cle est posee', async () => {
        process.env.RESEND_API_KEY = 'k';
        const { selectedTransport } = await import('./transport');
        expect(selectedTransport()).toBe('resend');
    });

    it('retient smtp quand seul l\'hote est pose — aucune variable supplementaire requise', async () => {
        process.env.EMAIL_SMTP_HOST = 'smtp.gmail.com';
        const { selectedTransport } = await import('./transport');
        expect(selectedTransport()).toBe('smtp');
    });

    it('EMAIL_TRANSPORT tranche quand les deux sont configures', async () => {
        process.env.RESEND_API_KEY = 'k';
        process.env.EMAIL_SMTP_HOST = 'smtp.gmail.com';
        process.env.EMAIL_TRANSPORT = 'smtp';
        const { selectedTransport } = await import('./transport');
        expect(selectedTransport()).toBe('smtp');
    });

    it('un EMAIL_TRANSPORT qui designe un fournisseur non configure ne retient rien', async () => {
        process.env.RESEND_API_KEY = 'k';
        process.env.EMAIL_TRANSPORT = 'smtp';
        const { selectedTransport } = await import('./transport');
        expect(selectedTransport()).toBeNull();
    });
});

describe('deliver', () => {
    it('rend une erreur explicite, jamais une exception, sans configuration', async () => {
        const { deliver } = await import('./transport');
        const r = await deliver(message);
        expect(r.id).toBeUndefined();
        expect(r.error).toMatch(/RESEND_API_KEY|EMAIL_SMTP_HOST/);
    });

    it('passe par Resend et remonte son identifiant', async () => {
        process.env.RESEND_API_KEY = 'k';
        const { deliver } = await import('./transport');
        const r = await deliver({ ...message, cc: ['copie@example.com'], replyTo: 'ops@x.io' });
        expect(r.id).toBe('resend-1');
        const sent = resendSend.mock.calls[0][0];
        expect(sent.to).toEqual(['armateur@example.com']);
        expect(sent.cc).toEqual(['copie@example.com']);
        expect(sent.replyTo).toBe('ops@x.io');
    });

    it('omet cc quand la liste est vide — Resend rejette un tableau vide', async () => {
        process.env.RESEND_API_KEY = 'k';
        const { deliver } = await import('./transport');
        await deliver({ ...message, cc: [] });
        expect('cc' in resendSend.mock.calls[0][0]).toBe(false);
    });

    it('remonte l\'erreur Resend sans lever', async () => {
        process.env.RESEND_API_KEY = 'k';
        resendSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });
        const { deliver } = await import('./transport');
        expect(await deliver(message)).toEqual({ error: 'domain not verified' });
    });

    it('passe par SMTP et remonte le messageId', async () => {
        process.env.EMAIL_SMTP_HOST = 'smtp.gmail.com';
        process.env.EMAIL_SMTP_USER = 'ops@greengate.africa';
        process.env.EMAIL_SMTP_PASSWORD = 'mdp-application';
        const { deliver } = await import('./transport');
        const r = await deliver(message);
        expect(r.id).toBe('smtp-1');
        expect(sendMail.mock.calls[0][0]).toMatchObject({
            from: 'noreply@greengate.africa',
            to: ['armateur@example.com'],
            subject: 'Sujet',
        });
    });

    it('monte en STARTTLS sur 587 et en SMTPS sur 465', async () => {
        process.env.EMAIL_SMTP_HOST = 'smtp.gmail.com';
        const { deliver } = await import('./transport');
        await deliver(message);
        expect(createTransport.mock.calls[0][0]).toMatchObject({ port: 587, secure: false });

        vi.resetModules();
        createTransport.mockClear();
        process.env.EMAIL_SMTP_PORT = '465';
        const mod = await import('./transport');
        await mod.deliver(message);
        expect(createTransport.mock.calls[0][0]).toMatchObject({ port: 465, secure: true });
    });

    it('n\'ouvre pas de session authentifiee quand aucun utilisateur n\'est pose', async () => {
        process.env.EMAIL_SMTP_HOST = 'localhost';
        const { deliver } = await import('./transport');
        await deliver(message);
        expect('auth' in createTransport.mock.calls[0][0]).toBe(false);
    });
});
