import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const enforce = vi.fn(async () => ({ allowed: true }));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: (...a: unknown[]) => enforce(...(a as [])),
    getClientId: () => 'ip-test',
}));

const resolve = vi.fn();
vi.mock('@/services/auth/loginAllowlist', () => ({
    resolveLoginTarget: (...a: unknown[]) => resolve(...(a as [])),
}));

const sendLink = vi.fn<(...a: unknown[]) => Promise<{ success: boolean; error?: string }>>(
    async () => ({ success: true }),
);
vi.mock('@/services/emailService', () => ({
    sendLoginLinkEmail: (...a: unknown[]) => sendLink(...a),
}));

const generateLink = vi.fn(async () => ({
    data: { properties: { action_link: 'https://gg/auth/callback?token=abc' }, user: { id: 'u1' } },
    error: null,
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ auth: { admin: { generateLink } } }),
}));

const { requestLoginLink } = await import('./requestLoginLink');

const TARGET = {
    shipownerId: 'own-1',
    shipownerName: 'FAROS SHIPPING CO SARL',
    deliveryEmail: 'faros@farosshipping.example',
    scope: 'OWNER' as const,
    isOfacSdn: false,
    isUnProhibited: false,
};

beforeEach(() => {
    vi.clearAllMocks();
    enforce.mockResolvedValue({ allowed: true });
    sendLink.mockResolvedValue({ success: true });
});

describe('requestLoginLink', () => {
    it('envoie le lien à l’adresse de la base', async () => {
        resolve.mockResolvedValue(TARGET);
        expect(await requestLoginLink({ email: 'FAROS@farosshipping.example' })).toEqual({ ok: true });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({
            to: 'faros@farosshipping.example',
            link: 'https://gg/auth/callback?token=abc',
        }));
    });

    it('répond identiquement sur une adresse inconnue et n’envoie rien', async () => {
        resolve.mockResolvedValue(null);
        expect(await requestLoginLink({ email: 'inconnu@nulle.part' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(generateLink).not.toHaveBeenCalled();
    });

    it('n’envoie jamais à un armateur visé par les Nations unies', async () => {
        resolve.mockResolvedValue({ ...TARGET, isUnProhibited: true });
        expect(await requestLoginLink({ email: 'morgan.navigation@mail.example' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(generateLink).not.toHaveBeenCalled();
    });

    it('n’envoie jamais à un armateur inscrit à l’OFAC', async () => {
        resolve.mockResolvedValue({ ...TARGET, isOfacSdn: true });
        expect(await requestLoginLink({ email: 'info@petrofleetenergy.example' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('diffère les copies de facturation sans rien envoyer', async () => {
        // La portée « lecture seule » exigée par la spec n'est portée nulle
        // part dans la session ; ouvrir le portail complet à un comptable en
        // copie lui donnerait litiges, conformité et moyens de paiement.
        resolve.mockResolvedValue({ ...TARGET, scope: 'BILLING_CC' });
        expect(await requestLoginLink({ email: 'compta@armateur.com' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('envoie bien à un représentant rattaché', async () => {
        resolve.mockResolvedValue({
            ...TARGET, scope: 'REPRESENTATIVE',
            deliveryEmail: 'gavaksh.b@rafflescommercial.com',
        });
        expect(await requestLoginLink({ email: 'gavaksh.b@rafflescommercial.com' })).toEqual({ ok: true });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({
            to: 'gavaksh.b@rafflescommercial.com',
        }));
    });

    it('refuse une saisie hors schéma sans la nettoyer', async () => {
        resolve.mockResolvedValue(TARGET);
        // Un champ supplémentaire est le signe d'une tentative de
        // détournement, pas d'une évolution légitime.
        expect(await requestLoginLink({ email: 'faros@farosshipping.example', role: 'SUPERADMIN' }))
            .toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('signale le plafond de débit', async () => {
        enforce.mockResolvedValue({ allowed: false });
        expect(await requestLoginLink({ email: 'faros@farosshipping.example' }))
            .toEqual({ ok: false, reason: 'rate_limited' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('applique un second plafond keyé sur l’armateur', async () => {
        resolve.mockResolvedValue(TARGET);
        await requestLoginLink({ email: 'faros@farosshipping.example' });
        // Sans ce second plafond, faire varier l'IP suffirait à inonder la
        // boîte d'un armateur.
        expect(enforce).toHaveBeenCalledWith('login-link', 'ip-test');
        expect(enforce).toHaveBeenCalledWith('login-link', 'owner:own-1');
    });

    it('reste discret quand l’envoi échoue', async () => {
        resolve.mockResolvedValue(TARGET);
        sendLink.mockResolvedValue({ success: false, error: 'resend down' });
        expect(await requestLoginLink({ email: 'faros@farosshipping.example' })).toEqual({ ok: true });
    });

    it('reste discret quand le minage du lien échoue', async () => {
        resolve.mockResolvedValue(TARGET);
        generateLink.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never);
        expect(await requestLoginLink({ email: 'faros@farosshipping.example' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });
});
