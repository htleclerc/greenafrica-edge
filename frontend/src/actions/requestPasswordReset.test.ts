import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const enforce = vi.fn(async () => ({ allowed: true }));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: (...a: unknown[]) => enforce(...(a as [])),
    getClientId: () => 'ip-test',
}));

const sendReset = vi.fn<(p: { to: string; recipientName: string; link: string }) =>
    Promise<{ success: boolean; error?: string }>>(async () => ({ success: true }));
vi.mock('@/services/emailService', () => ({
    sendPasswordResetEmail: (p: never) => sendReset(p),
}));

let profileRows: Array<Record<string, unknown>> = [];
const generateLink = vi.fn<(o: { type: string; email: string }) => Promise<{
    data: { properties: { hashed_token: string } } | null;
    error: { message: string } | null;
}>>(async () => ({ data: { properties: { hashed_token: 'th-reset' } }, error: null }));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        auth: { admin: { generateLink } },
        from: () => {
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.eq = () => chain;
            chain.limit = () => Promise.resolve({ data: profileRows, error: null });
            return chain;
        },
    }),
}));

const { requestPasswordReset } = await import('./requestPasswordReset');

const STAFF = { id: 'p1', email: 'admin@greengate.africa', full_name: 'Admin GREENGATE', is_active: true };

beforeEach(() => {
    vi.clearAllMocks();
    enforce.mockResolvedValue({ allowed: true });
    sendReset.mockResolvedValue({ success: true });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'th-reset' } }, error: null });
    profileRows = [STAFF];
    process.env.NEXT_PUBLIC_APP_URL = 'https://greengate.africa';
});

describe('requestPasswordReset', () => {
    it('envoie un lien vers notre callback, jamais vers /auth/v1/verify', async () => {
        const r = await requestPasswordReset({ email: 'admin@greengate.africa' });
        expect(r).toEqual({ ok: true });
        const { link } = sendReset.mock.calls[0][0];
        expect(link).toBe('https://greengate.africa/auth/callback?token_hash=th-reset&type=recovery');
        expect(link).not.toContain('/auth/v1/verify');
    });

    it('normalise la casse et les espaces', async () => {
        await requestPasswordReset({ email: '  ADMIN@GreenGate.africa ' });
        expect(generateLink.mock.calls[0][0].email).toBe('admin@greengate.africa');
    });

    // L'ecran ne doit pas confirmer l'existence d'un compte : une adresse
    // inconnue rend exactement ce que rend une adresse connue.
    it('repond identiquement sur une adresse inconnue, et n’envoie rien', async () => {
        profileRows = [];
        const r = await requestPasswordReset({ email: 'inconnu@example.com' });
        expect(r).toEqual({ ok: true });
        expect(sendReset).not.toHaveBeenCalled();
    });

    it('ne touche pas un compte desactive', async () => {
        // Le filtre is_active est porte par la requete ; le simulacre rend
        // alors zero ligne, comme la base.
        profileRows = [];
        await requestPasswordReset({ email: 'ancien@greengate.africa' });
        expect(sendReset).not.toHaveBeenCalled();
    });

    it('remonte le plafonnement, seul motif d’echec visible', async () => {
        enforce.mockResolvedValue({ allowed: false });
        expect(await requestPasswordReset({ email: 'admin@greengate.africa' }))
            .toEqual({ ok: false, reason: 'rate_limited' });
        expect(sendReset).not.toHaveBeenCalled();
    });

    it('ne produit aucune requete sur une saisie qui n’est pas une adresse', async () => {
        expect(await requestPasswordReset({ email: 'pas-une-adresse' })).toEqual({ ok: true });
        expect(generateLink).not.toHaveBeenCalled();
    });

    // Un echec d'envoi ne doit pas renseigner l'appelant : meme reponse.
    it('reste invariable quand la generation du jeton echoue', async () => {
        generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } });
        expect(await requestPasswordReset({ email: 'admin@greengate.africa' })).toEqual({ ok: true });
        expect(sendReset).not.toHaveBeenCalled();
    });
});
