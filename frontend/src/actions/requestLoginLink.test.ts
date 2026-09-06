import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const enforce = vi.fn(async () => ({ allowed: true }));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: (...a: unknown[]) => enforce(...(a as [])),
    getClientId: () => 'ip-test',
}));

const resolve = vi.fn();
const resolveStaff = vi.fn();
vi.mock('@/services/auth/loginAllowlist', () => ({
    resolveLoginTarget: (...a: unknown[]) => resolve(...(a as [])),
    resolveStaffLoginTarget: (...a: unknown[]) => resolveStaff(...(a as [])),
}));

const sendLink = vi.fn<(...a: unknown[]) => Promise<{ success: boolean; error?: string }>>(
    async () => ({ success: true }),
);
vi.mock('@/services/emailService', () => ({
    sendLoginLinkEmail: (...a: unknown[]) => sendLink(...a),
}));

// La signature est portée par le générique : sans elle, `vi.fn(async () => …)`
// donne un tuple d'arguments vide et `mock.calls[0][0]` ne compile pas.
type GenerateLinkArgs = { type: string; email: string; options?: { redirectTo?: string } };
const generateLink = vi.fn<(args: GenerateLinkArgs) => Promise<{
    data: { properties: { hashed_token: string; email_otp: string }; user: { id: string } };
    error: null;
}>>(async () => ({
    // `hashed_token` et non `action_link` : le lien envoyé est CONSTRUIT par
    // l'action et pointe sur nos propres routes, pas sur /auth/v1/verify.
    data: { properties: { hashed_token: 'th-abc', email_otp: '123456' }, user: { id: 'u1' } },
    error: null,
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ auth: { admin: { generateLink } } }),
}));

const resolveVessel = vi.fn();
vi.mock('@/services/auth/vesselOwnerLookup', () => ({
    resolveOwnerByVesselIdentifier: (...a: unknown[]) => resolveVessel(...(a as [])),
}));

// Boîtes admises pour le compte : par défaut, la seule adresse officielle.
const listRecipients = vi.fn();
vi.mock('@/services/auth/loginRecipients', () => ({
    listLoginRecipients: (...a: unknown[]) => listRecipients(...(a as [])),
    MAX_LOGIN_RECIPIENTS: 5,
}));

const { requestLoginLink, sendLoginLinkTo } = await import('./requestLoginLink');
const { signRecipientToken } = await import('@/lib/auth/recipientToken');

const TARGET = {
    shipownerId: 'own-1',
    shipownerName: 'FAROS SHIPPING CO SARL',
    deliveryEmail: 'faros@farosshipping.example',
    scope: 'OWNER' as const,
    isOfacSdn: false,
    isUnProhibited: false,
};

const STAFF = {
    profileId: 'prof-1',
    fullName: 'Admin GREENGATE',
    deliveryEmail: 'admin@greengate.africa',
    role: 'SUPERADMIN',
};

beforeEach(() => {
    vi.clearAllMocks();
    resolveStaff.mockResolvedValue(null);
    enforce.mockResolvedValue({ allowed: true });
    sendLink.mockResolvedValue({ success: true });
    resolveVessel.mockResolvedValue(null);
    listRecipients.mockImplementation(async (_db: unknown, o: { officialEmail: string }) => [{ email: o.officialEmail, kind: 'OWNER' }]);
    process.env.LOGIN_RECIPIENT_SECRET = 'test-recipient-secret';
});

describe('requestLoginLink', () => {
    it('envoie le lien à l’adresse de la base', async () => {
        resolve.mockResolvedValue(TARGET);
        expect(await requestLoginLink({ query: 'FAROS@farosshipping.example' })).toMatchObject({ ok: true });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({
            to: 'faros@farosshipping.example',
            link: 'http://localhost:3300/owner/auth/callback?token_hash=th-abc&type=magiclink',
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
            link: 'http://localhost:3300/owner/auth/callback?token_hash=th-abc&type=magiclink',
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

/**
 * Le staff n'avait aucun rail : ses comptes sont créés sans mot de passe, et
 * le formulaire ne servait que les armateurs. Une adresse d'administration y
 * recevait le message neutre — indiscernable d'un mailer en panne.
 */
describe('requestLoginLink — comptes staff', () => {
    it('envoie un lien à un compte staff quand aucun armateur ne correspond', async () => {
        resolve.mockResolvedValue(null);
        resolveStaff.mockResolvedValue(STAFF);

        const r = await requestLoginLink({ query: 'admin@greengate.africa' });

        expect(r).toEqual({ ok: true, via: 'email' });
        expect(sendLink).toHaveBeenCalledTimes(1);
        expect(sendLink.mock.calls[0][0]).toMatchObject({ to: 'admin@greengate.africa' });
    });

    // Le portail armateur refuse un agent : il n'a pas de dossier.
    it('renvoie le staff vers /auth/callback, pas vers le portail armateur', async () => {
        resolve.mockResolvedValue(null);
        resolveStaff.mockResolvedValue(STAFF);

        await requestLoginLink({ query: 'admin@greengate.africa' });

        const { link } = sendLink.mock.calls[0][0] as { link: string };
        expect(link).toContain('/auth/callback?token_hash=');
        expect(link).not.toContain('/owner/auth/callback');
    });

    // Le lien doit frapper NOS routes : `action_link` de GoTrue depose le jeton
    // dans un fragment que le serveur ne voit jamais, et ne redirige que vers
    // une cible declaree dans les « Redirect URLs » du projet.
    it('construit le lien sur token_hash, jamais sur action_link', async () => {
        resolve.mockResolvedValue(TARGET);

        await requestLoginLink({ query: 'faros@farosshipping.example' });

        const { link } = sendLink.mock.calls[0][0] as { link: string };
        expect(link).toContain('/owner/auth/callback?token_hash=th-abc&type=magiclink');
        expect(link).not.toContain('/auth/v1/verify');
    });

    // L'armateur porte la garde des sanctions ; il doit gagner.
    it('ne consulte pas le staff quand un armateur correspond', async () => {
        resolve.mockResolvedValue(TARGET);

        await requestLoginLink({ query: 'faros@farosshipping.example' });

        expect(resolveStaff).not.toHaveBeenCalled();
    });

    it('plafonne par compte staff, pas seulement par IP', async () => {
        resolve.mockResolvedValue(null);
        resolveStaff.mockResolvedValue(STAFF);
        enforce.mockImplementation(async (...a: unknown[]) =>
            (a[1] === 'staff:prof-1' ? { allowed: false } : { allowed: true }));

        const r = await requestLoginLink({ query: 'admin@greengate.africa' });

        expect(r).toEqual({ ok: false, reason: 'rate_limited' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    // L'ouverture au staff ne doit pas transformer le formulaire public en
    // oracle : la réponse reste celle d'une adresse inconnue.
    it('répond identiquement quand aucune cible, staff comprise, ne correspond', async () => {
        resolve.mockResolvedValue(null);
        resolveStaff.mockResolvedValue(null);

        const r = await requestLoginLink({ query: 'inconnu@example.com' });

        expect(r).toEqual({ ok: true, via: 'email' });
        expect(sendLink).not.toHaveBeenCalled();
    });
});

describe('requestLoginLink — chemin navire, plusieurs boîtes', () => {
    const OWNER = {
        id: 'own-2', name: 'CORAL TECHNICAL SERVICES',
        officialEmail: 'coral@nets.example', vesselName: 'ALIMAN',
        isOfacSdn: false, isUnProhibited: false,
    };
    const RECIPIENTS = [
        { email: 'coral@nets.example', kind: 'OWNER' },
        { email: 'compta@coral.example', kind: 'MEMBER' },
        { email: 'agent@berbera.example', kind: 'REPRESENTATIVE' },
    ];

    beforeEach(() => {
        resolveVessel.mockResolvedValue(OWNER);
        listRecipients.mockResolvedValue(RECIPIENTS);
    });

    it('propose les boîtes masquées sous jetons, sans rien envoyer', async () => {
        const r = await requestLoginLink({ query: '9167057' });
        expect(r).toMatchObject({ ok: true, via: 'vessel-choice', vesselName: 'ALIMAN' });
        const choices = (r as { choices: { token: string; hint: string; kind: string }[] }).choices;
        expect(choices.map((c) => c.kind)).toEqual(['OWNER', 'MEMBER', 'REPRESENTATIVE']);
        for (const c of choices) {
            expect(c.hint).toContain('••••');
            expect(c.token).toMatch(/^[0-9a-f]{32}$/);
            expect(JSON.stringify(c)).not.toContain('@nets.example');
        }
        expect(sendLink).not.toHaveBeenCalled();
        // Aucun quota armateur consommé tant que rien ne part.
        expect(enforce).not.toHaveBeenCalledWith('login-link', 'owner:own-2');
    });

    it('envoie à la boîte choisie — un membre ouvre sa propre session', async () => {
        const token = signRecipientToken('own-2', 'compta@coral.example');
        const r = await sendLoginLinkTo({ query: '9167057', recipient: token });
        expect(r).toMatchObject({ ok: true, via: 'vessel', vesselName: 'ALIMAN' });
        expect((r as { emailHint: string }).emailHint).toContain('••••');
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({ to: 'compta@coral.example', vesselName: 'ALIMAN' }));
        expect(enforce).toHaveBeenCalledWith('login-link', 'owner:own-2');
    });

    it('rejette un jeton qui ne désigne aucune boîte admise, comme un navire inconnu', async () => {
        const forged = signRecipientToken('own-2', 'attacker@evil.example');
        const r = await sendLoginLinkTo({ query: '9167057', recipient: forged });
        expect(r).toEqual({ ok: true, via: 'vessel-unknown' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it("rejette un jeton d'un autre compte", async () => {
        const other = signRecipientToken('own-999', 'compta@coral.example');
        const r = await sendLoginLinkTo({ query: '9167057', recipient: other });
        expect(r).toEqual({ ok: true, via: 'vessel-unknown' });
    });

    it('ne propose jamais rien pour un armateur sanctionné', async () => {
        resolveVessel.mockResolvedValue({ ...OWNER, isOfacSdn: true });
        const r = await requestLoginLink({ query: '9167057' });
        expect(r).toEqual({ ok: true, via: 'vessel-unknown' });
        const token = signRecipientToken('own-2', 'compta@coral.example');
        expect(await sendLoginLinkTo({ query: '9167057', recipient: token })).toEqual({ ok: true, via: 'vessel-unknown' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('une seule boîte : envoi direct, comme avant', async () => {
        listRecipients.mockResolvedValue([RECIPIENTS[0]]);
        const r = await requestLoginLink({ query: '9167057' });
        expect(r).toMatchObject({ ok: true, via: 'vessel' });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({ to: 'coral@nets.example' }));
    });
});
