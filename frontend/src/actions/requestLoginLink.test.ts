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
    data: { properties: { action_link: 'https://gg/auth/callback?token=abc', email_otp: '123456' }, user: { id: 'u1' } },
    error: null,
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ auth: { admin: { generateLink } } }),
}));

const resolveVessel = vi.fn();
vi.mock('@/services/auth/vesselOwnerLookup', () => ({
    resolveOwnerByVesselIdentifier: (...a: unknown[]) => resolveVessel(...(a as [])),
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
    resolveVessel.mockResolvedValue(null);
});

describe('requestLoginLink', () => {
    it('envoie le lien à l’adresse de la base', async () => {
        resolve.mockResolvedValue(TARGET);
        expect(await requestLoginLink({ query: 'FAROS@farosshipping.example' })).toMatchObject({ ok: true });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({
            to: 'faros@farosshipping.example',
            link: 'https://gg/auth/callback?token=abc',
        }));
    });

    it('répond identiquement sur une adresse inconnue et n’envoie rien', async () => {
        resolve.mockResolvedValue(null);
        expect(await requestLoginLink({ query: 'inconnu@nulle.part' })).toMatchObject({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(generateLink).not.toHaveBeenCalled();
    });

    it('n’envoie jamais à un armateur visé par les Nations unies', async () => {
        resolve.mockResolvedValue({ ...TARGET, isUnProhibited: true });
        expect(await requestLoginLink({ query: 'morgan.navigation@mail.example' })).toMatchObject({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(generateLink).not.toHaveBeenCalled();
    });

    it('n’envoie jamais à un armateur inscrit à l’OFAC', async () => {
        resolve.mockResolvedValue({ ...TARGET, isOfacSdn: true });
        expect(await requestLoginLink({ query: 'info@petrofleetenergy.example' })).toMatchObject({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('diffère les copies de facturation sans rien envoyer', async () => {
        // La portée « lecture seule » exigée par la spec n'est portée nulle
        // part dans la session ; ouvrir le portail complet à un comptable en
        // copie lui donnerait litiges, conformité et moyens de paiement.
        resolve.mockResolvedValue({ ...TARGET, scope: 'BILLING_CC' });
        expect(await requestLoginLink({ query: 'compta@armateur.com' })).toMatchObject({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('envoie bien à un représentant rattaché', async () => {
        resolve.mockResolvedValue({
            ...TARGET, scope: 'REPRESENTATIVE',
            deliveryEmail: 'gavaksh.b@rafflescommercial.com',
        });
        expect(await requestLoginLink({ query: 'gavaksh.b@rafflescommercial.com' })).toMatchObject({ ok: true });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({
            to: 'gavaksh.b@rafflescommercial.com',
        }));
    });

    it('refuse une saisie hors schéma sans la nettoyer', async () => {
        resolve.mockResolvedValue(TARGET);
        // Un champ supplémentaire est le signe d'une tentative de
        // détournement, pas d'une évolution légitime.
        expect(await requestLoginLink({ query: 'faros@farosshipping.example', role: 'SUPERADMIN' }))
            .toMatchObject({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('signale le plafond de débit', async () => {
        enforce.mockResolvedValue({ allowed: false });
        expect(await requestLoginLink({ query: 'faros@farosshipping.example' }))
            .toEqual({ ok: false, reason: 'rate_limited' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('applique un second plafond keyé sur l’armateur', async () => {
        resolve.mockResolvedValue(TARGET);
        await requestLoginLink({ query: 'faros@farosshipping.example' });
        // Sans ce second plafond, faire varier l'IP suffirait à inonder la
        // boîte d'un armateur.
        expect(enforce).toHaveBeenCalledWith('login-link', 'ip-test');
        expect(enforce).toHaveBeenCalledWith('login-link', 'owner:own-1');
    });

    it('reste discret quand l’envoi échoue', async () => {
        resolve.mockResolvedValue(TARGET);
        sendLink.mockResolvedValue({ success: false, error: 'resend down' });
        expect(await requestLoginLink({ query: 'faros@farosshipping.example' })).toMatchObject({ ok: true });
    });

    it('reste discret quand le minage du lien échoue', async () => {
        resolve.mockResolvedValue(TARGET);
        generateLink.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as never);
        expect(await requestLoginLink({ query: 'faros@farosshipping.example' })).toMatchObject({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });
});

describe('requestLoginLink — chemin navire (IMO / MMSI)', () => {
    const OWNER = {
        id: 'own-9', name: 'CORAL TECHNICAL SERVICES',
        officialEmail: 'coral@nets.example', vesselName: 'ALIMAN',
        isOfacSdn: false, isUnProhibited: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        enforce.mockResolvedValue({ allowed: true });
        sendLink.mockResolvedValue({ success: true });
        resolve.mockResolvedValue(null);
    });

    it('accepte un IMO valide et rend l’indice masqué', async () => {
        resolveVessel.mockResolvedValue(OWNER);
        // 9167057 = MAYAR, somme de contrôle valide.
        const r = await requestLoginLink({ query: '9167057' });
        expect(r).toMatchObject({ ok: true, via: 'vessel', vesselName: 'ALIMAN' });
        // L'indice dit quelle boîte surveiller sans livrer l'adresse.
        expect((r as { emailHint: string }).emailHint).toContain('••••');
        expect((r as { emailHint: string }).emailHint).not.toContain('coral@nets.example');
    });

    it('envoie le lien ET le code, avec le nom du navire', async () => {
        resolveVessel.mockResolvedValue(OWNER);
        await requestLoginLink({ query: '9167057' });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({
            to: 'coral@nets.example', code: '123456', vesselName: 'ALIMAN',
            link: 'https://gg/auth/callback?token=abc',
        }));
    });

    it('rejette un IMO à somme de contrôle fausse sans appeler le serveur', async () => {
        // 9167058 : bonne longueur, mauvaise clé — le cas le plus trompeur.
        const r = await requestLoginLink({ query: '9167058' });
        expect(r).toEqual({ ok: true, via: 'vessel-unknown' });
        expect(resolveVessel).not.toHaveBeenCalled();
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('accepte un MMSI de 9 chiffres', async () => {
        resolveVessel.mockResolvedValue(OWNER);
        await requestLoginLink({ query: '341264001' });
        expect(resolveVessel).toHaveBeenCalledWith(
            expect.anything(), { kind: 'MMSI', value: '341264001' },
        );
    });

    it('navire introuvable : même réponse qu’un envoi, sans indice', async () => {
        resolveVessel.mockResolvedValue(null);
        const r = await requestLoginLink({ query: '9167057' });
        expect(r).toEqual({ ok: true, via: 'vessel-unknown' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('armateur sanctionné : indistinguable d’un navire inconnu', async () => {
        resolveVessel.mockResolvedValue({ ...OWNER, isUnProhibited: true });
        const r = await requestLoginLink({ query: '9167057' });
        // Aucun indice, aucun envoi, et surtout aucun signal qu'il est identifié.
        expect(r).toEqual({ ok: true, via: 'vessel-unknown' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('le chemin ADRESSE ne rend jamais d’indice', async () => {
        resolve.mockResolvedValue(TARGET);
        const r = await requestLoginLink({ query: 'faros@farosshipping.example' });
        // La neutralite de l'ecran de connexion tient a cette absence.
        expect(r).toEqual({ ok: true, via: 'email' });
        expect(r).not.toHaveProperty('emailHint');
    });
});
