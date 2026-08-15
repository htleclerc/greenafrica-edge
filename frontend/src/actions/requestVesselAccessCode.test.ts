import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    mockAdminFrom,
    mockGenerateLink,
    mockEnforce,
    mockSendCodeEmail,
    mockTxnNot,
    mockProfileUpdate,
    mockProfileEq,
} = vi.hoisted(() => ({
    mockAdminFrom: vi.fn(),
    mockGenerateLink: vi.fn(),
    mockEnforce: vi.fn(),
    mockSendCodeEmail: vi.fn(),
    mockTxnNot: vi.fn(),
    mockProfileUpdate: vi.fn(),
    mockProfileEq: vi.fn(),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: mockAdminFrom,
        auth: { admin: { generateLink: mockGenerateLink } },
    }),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: mockEnforce,
    getClientId: () => 'test-client',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/services/emailService', () => ({ sendVesselAccessCodeEmail: mockSendCodeEmail }));

import { requestVesselAccessCode } from './requestVesselAccessCode';

/** Chaîne de résolution : transactions → shipowners. */
function ownerRow(over: Record<string, unknown> = {}) {
    return {
        id: 'owner-1',
        name: 'Horn Shipping SA',
        official_email: 'contact@hornshipping.com',
        official_email_source: 'EQUASIS_VERIFIED',
        is_placeholder: false,
        ...over,
    };
}

let ownerFixture = ownerRow();

/**
 * Chaîne mockée de `transactions` : select().eq().in().not().order().limit().maybeSingle().
 * `txnRows` porte, en principe, la ligne la plus récente en tête — les tests
 * G2 (Finding 2) la remplacent par une liste où l'appel réel filtrerait la
 * première ligne s'il oubliait `.not('shipowner_id', 'is', null)`.
 */
let txnResult: { shipowner_id: string | null } | null = { shipowner_id: 'owner-1' };

/** Erreur renvoyée par l'UPDATE d'activation du profil (mig 120). */
let profileUpdateError: { message: string } | null = null;

/**
 * Chaîne mockée de l'UPDATE sur `profiles` :
 * update().eq('id', …).eq('role', 'SHIPOWNER'), attendue en fin de chaîne.
 * Chaque `.eq()` renvoie la même chaîne, elle-même « thenable » pour que
 * `await` la résolve comme le ferait PostgREST.
 */
type UpdateChain = PromiseLike<{ error: { message: string } | null }> & {
    eq: (column: string, value: unknown) => UpdateChain;
};

function makeUpdateChain(): UpdateChain {
    const chain: UpdateChain = {
        eq: (column: string, value: unknown) => {
            mockProfileEq(column, value);
            return chain;
        },
        then: (onfulfilled) => Promise.resolve({ error: profileUpdateError }).then(onfulfilled),
    };
    return chain;
}

beforeEach(() => {
    vi.clearAllMocks();
    ownerFixture = ownerRow();
    txnResult = { shipowner_id: 'owner-1' };
    profileUpdateError = null;
    mockEnforce.mockResolvedValue({ allowed: true });
    mockGenerateLink.mockResolvedValue({
        // `user` est renvoyé par generateLink (GenerateLinkResponse) : c'est
        // par lui que l'action retrouve le compte que le trigger vient de
        // créer, pour le réactiver.
        data: { properties: { email_otp: '654321' }, user: { id: 'user-1' } },
        error: null,
    });
    mockSendCodeEmail.mockResolvedValue({ success: true, id: 'email-1' });
    mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        in: () => ({
                            not: (...args: unknown[]) => {
                                mockTxnNot(...args);
                                return {
                                    order: () => ({
                                        limit: () => ({
                                            maybeSingle: async () => ({ data: txnResult, error: null }),
                                        }),
                                    }),
                                };
                            },
                        }),
                    }),
                }),
            };
        }
        if (table === 'vessels') {
            return {
                select: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: { imo_number: '9424223' }, error: null }) }),
                }),
            };
        }
        if (table === 'profiles') {
            return {
                update: (patch: Record<string, unknown>) => {
                    mockProfileUpdate(patch);
                    return makeUpdateChain();
                },
            };
        }
        // shipowners
        return {
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: ownerFixture, error: null }),
                }),
            }),
        };
    });
});

describe('requestVesselAccessCode', () => {
    it("mine un token via generateLink et envoie le code (email_otp) par e-mail, à l'adresse enregistrée", async () => {
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: true, emailHint: 'c••••t@h••••g.com' });
        expect(mockGenerateLink).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'magiclink', email: 'contact@hornshipping.com' }),
        );
        expect(mockSendCodeEmail).toHaveBeenCalledWith(
            expect.objectContaining({ to: 'contact@hornshipping.com', code: '654321' }),
        );
    });

    it("ne délivre jamais le code via le lien GoTrue par défaut : signInWithOtp n'est plus appelé", async () => {
        await requestVesselAccessCode({ identifier: '9424223' });
        // La régression visée par Finding 1 : GoTrue enverrait son propre
        // template (lien seul, sans {{ .Token }}) si ce chemin repassait par
        // signInWithOtp. On s'assure que seul le pattern generateLink+e-mail
        // maison est utilisé — la seule surface auth exercée ici est
        // `auth.admin.generateLink`, exposée par le mock du client platform.
        expect(mockGenerateLink).toHaveBeenCalledTimes(1);
    });

    it('passe role SHIPOWNER à la création pour ne pas hériter du repli du trigger (migs 001/120)', async () => {
        // 'SHIPOWNER' est le seul rôle de l'allowlist du canal client de la
        // mig 120 : le retirer d'ici ferait retomber le compte sur le repli du
        // trigger. Historiquement ce repli était PORT_OFFICER, ce qui ouvrait
        // les audit_logs non tagués (RLS mig 100) à un armateur auto-rattaché.
        await requestVesselAccessCode({ identifier: '9424223' });
        expect(mockGenerateLink).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({ data: { role: 'SHIPOWNER' } }),
            }),
        );
    });

    it("n'envoie plus is_active dans les métadonnées generateLink : la mig 120 ne l'accepte que du canal serveur", async () => {
        // generateLink n'écrit que raw_user_meta_data (options typées
        // Pick<GenerateLinkOptions, 'data' | 'redirectTo'>). Depuis la mig 120
        // is_active n'y est plus lu du tout ; l'y laisser donnerait la fausse
        // impression que ce chemin active encore le compte par métadonnées.
        await requestVesselAccessCode({ identifier: '9424223' });
        const arg = mockGenerateLink.mock.calls[0][0] as { options: { data: Record<string, unknown> } };
        expect(arg.options.data).not.toHaveProperty('is_active');
    });

    it('active le profil créé inactif par le trigger, en bornant l\'écriture aux lignes déjà SHIPOWNER', async () => {
        await requestVesselAccessCode({ identifier: '9424223' });
        expect(mockProfileUpdate).toHaveBeenCalledWith({ is_active: true });
        expect(mockProfileEq).toHaveBeenNthCalledWith(1, 'id', 'user-1');
        // Le second filtre est la garde : generateLink renvoie le compte
        // EXISTANT quand l'adresse en a déjà un. Sans `.eq('role','SHIPOWNER')`,
        // un compte staff partageant l'adresse d'un armateur serait activé par
        // un appel public à cette action.
        expect(mockProfileEq).toHaveBeenNthCalledWith(2, 'role', 'SHIPOWNER');
    });

    it("n'active aucun profil quand generateLink ne renvoie pas d'utilisateur", async () => {
        mockGenerateLink.mockResolvedValue({
            data: { properties: { email_otp: '654321' } },
            error: null,
        });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r.ok).toBe(true);
        expect(mockProfileUpdate).not.toHaveBeenCalled();
    });

    it("envoie le code même si l'activation du profil échoue (non bloquant)", async () => {
        // Le code est déjà miné : refuser l'envoi ici priverait l'armateur de
        // son accès pour une écriture qui n'est qu'un confort d'affichage —
        // après rattachement, requirePrincipal résout l'armateur par la branche
        // opérateur, qui ne lit pas profiles.is_active.
        profileUpdateError = { message: 'db down' };
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: true, emailHint: 'c••••t@h••••g.com' });
        expect(mockSendCodeEmail).toHaveBeenCalled();
    });

    it("ouvre l'accès direct pour AGENT_CLAIM (décision PO 2026-08-12)", async () => {
        ownerFixture = ownerRow({ official_email_source: 'AGENT_CLAIM' });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r.ok).toBe(true);
    });

    it("G2 — n'envoie jamais de code pour un armateur de regroupement", async () => {
        ownerFixture = ownerRow({ is_placeholder: true });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockGenerateLink).not.toHaveBeenCalled();
        expect(mockSendCodeEmail).not.toHaveBeenCalled();
    });

    it("refuse un payload portant une adresse fournie par l'appelant (G4)", async () => {
        const r = await requestVesselAccessCode({
            identifier: '9424223',
            email: 'attaquant@example.com',
        });
        expect(r).toEqual({ ok: false, reason: 'invalid_identifier' });
        expect(mockGenerateLink).not.toHaveBeenCalled();
    });

    it("G4 — l'adresse envoyée au service d'e-mail vient toujours de la base, jamais de l'entrée", async () => {
        // Même en forçant explicitement une adresse dans le payload (rejetée
        // par ailleurs par .strict()), aucune valeur autre que
        // owner.official_email ne doit jamais atteindre generateLink ou
        // sendVesselAccessCodeEmail.
        await requestVesselAccessCode({ identifier: '9424223' });
        const generateLinkArg = mockGenerateLink.mock.calls[0][0] as { email: string };
        const sendEmailArg = mockSendCodeEmail.mock.calls[0][0] as { to: string };
        expect(generateLinkArg.email).toBe(ownerFixture.official_email);
        expect(sendEmailArg.to).toBe(ownerFixture.official_email);
    });

    it("G3 — refuse au-delà du plafond par armateur, même quand l'IP passe", async () => {
        // Premier appel : quota IP OK, quota armateur OK.
        // Second : le quota IP passe encore, mais celui de l'armateur est épuisé.
        mockEnforce
            .mockResolvedValueOnce({ allowed: true })   // IP
            .mockResolvedValueOnce({ allowed: true })   // armateur
            .mockResolvedValueOnce({ allowed: true })   // IP
            .mockResolvedValueOnce({ allowed: false, reason: 'rate_limited_per_hour' }); // armateur

        expect((await requestVesselAccessCode({ identifier: '9424223' })).ok).toBe(true);
        const second = await requestVesselAccessCode({ identifier: '9424223' });
        expect(second).toEqual({ ok: false, reason: 'rate_limited' });
        expect(mockGenerateLink).toHaveBeenCalledTimes(1);

        // Les deux plafonds ne doivent pas pouvoir entrer en collision : le
        // premier appel est keyé sur l'IP, le second sur l'armateur. Sans
        // cette distinction, faire varier l'IP suffirait à contourner le
        // second plafond — c'est exactement la faille que G3 doit fermer.
        expect(mockEnforce).toHaveBeenNthCalledWith(1, 'vessel-claim', 'test-client');
        expect(mockEnforce).toHaveBeenNthCalledWith(2, 'vessel-claim', 'owner:owner-1');
        expect(mockEnforce).toHaveBeenNthCalledWith(3, 'vessel-claim', 'test-client');
        expect(mockEnforce).toHaveBeenNthCalledWith(4, 'vessel-claim', 'owner:owner-1');
    });

    it('refuse un identifiant invalide sans toucher la base', async () => {
        const r = await requestVesselAccessCode({ identifier: '123' });
        expect(r).toEqual({ ok: false, reason: 'invalid_identifier' });
        expect(mockAdminFrom).not.toHaveBeenCalled();
    });

    it("remonte send_failed quand generateLink échoue à minter un token", async () => {
        mockGenerateLink.mockResolvedValue({ data: null, error: { message: 'admin api down' } });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'send_failed' });
        expect(mockSendCodeEmail).not.toHaveBeenCalled();
    });

    it("remonte send_failed quand generateLink réussit mais ne porte pas d'email_otp", async () => {
        mockGenerateLink.mockResolvedValue({ data: { properties: {} }, error: null });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'send_failed' });
        expect(mockSendCodeEmail).not.toHaveBeenCalled();
    });

    it("remonte send_failed quand l'envoi de l'e-mail échoue (Resend)", async () => {
        mockSendCodeEmail.mockResolvedValue({ success: false, error: 'resend down' });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'send_failed' });
    });

    it("résout un MMSI en IMO avant de chercher l'avis", async () => {
        const r = await requestVesselAccessCode({ identifier: '341581000' });
        expect(r.ok).toBe(true);
    });

    it("Finding 2 — filtre shipowner_id NULL dans la requête transactions (accord avec le RPC vessel_payment_teaser)", async () => {
        // La chaîne réelle doit appeler .not('shipowner_id', 'is', null)
        // entre .in(status) et .order(created_at) — exactement le filtre que
        // porte déjà le JOIN shipowners du RPC (mig 118). Si ce filtre est
        // retiré, cet appel disparaît et l'assertion échoue ; la requête
        // reviendrait alors à prendre la transaction la plus récente sans
        // égard à shipowner_id, exposant à nouveau la divergence RPC/action
        // que Finding 2 corrige.
        await requestVesselAccessCode({ identifier: '9424223' });
        expect(mockTxnNot).toHaveBeenCalledWith('shipowner_id', 'is', null);
    });

    it('Finding 2 — bail not_claimable quand la transaction outstanding résolue a shipowner_id NULL', async () => {
        // Représente ce qui arriverait si le filtre .not(...) était retiré et
        // que la transaction la plus récente (non attribuée) remontait ici :
        // l'action doit refuser proprement, jamais tenter d'envoyer un code
        // pour un shipowner_id nul.
        txnResult = { shipowner_id: null };
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockGenerateLink).not.toHaveBeenCalled();
    });
});
