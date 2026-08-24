import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Doublures ────────────────────────────────────────────────────────────────

let user: { id: string; email: string } | null = { id: 'u1', email: 'agent@greengate.africa' };
const updateUser = vi.fn(async () => ({ error: null }));
let sessionRows: { id: string; is_current: boolean }[] = [];
const rpc = vi.fn(async (fn: string) =>
    fn === 'current_user_sessions'
        ? { data: sessionRows, error: null }
        : { data: revokeReturns, error: null });
let revokeReturns: boolean = true;

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user } }), updateUser: (...a: unknown[]) => updateUser(...(a as [])) },
        rpc: (...a: unknown[]) => rpc(...(a as [string])),
    }),
}));

// Le client « sonde » : il sert à vérifier l'ancien mot de passe sans toucher
// à la session de l'appelant.
const probeSignIn = vi.fn(async () => ({ error: null as { message: string } | null }));
const probeSignOut = vi.fn(async () => ({ error: null }));
let probeOptions: Record<string, unknown> | undefined;
vi.mock('@supabase/supabase-js', () => ({
    createClient: (_url: string, _key: string, options?: Record<string, unknown>) => {
        probeOptions = options;
        return { auth: { signInWithPassword: probeSignIn, signOut: probeSignOut } };
    },
}));

const audit = vi.fn(async () => undefined);
vi.mock('@/services/auditService', () => ({ writeAuditLog: (...a: unknown[]) => audit(...(a as [])) }));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
    vi.clearAllMocks();
    user = { id: 'u1', email: 'agent@greengate.africa' };
    sessionRows = [];
    revokeReturns = true;
    probeOptions = undefined;
    probeSignIn.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ error: null });
});

const STRONG = 'un-mot-de-passe-assez-long';

describe('changePassword — prouver l’ancien avant d’écrire le nouveau', () => {
    /**
     * Supabase n'exige pas l'ancien mot de passe : `updateUser` suffit à qui
     * tient la session. Un poste laissé déverrouillé permettrait donc de
     * verrouiller le compte de son titulaire. C'est la raison de ce contrôle.
     */
    it('refuse sans écrire quand l’ancien mot de passe est faux', async () => {
        probeSignIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
        const { changePassword } = await import('./changePassword');
        const r = await changePassword({ currentPassword: 'faux', newPassword: STRONG });
        expect(r).toEqual({ ok: false, reason: 'wrong_current_password' });
        expect(updateUser).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
    });

    it('vérifie sur un client SANS état — la session de l’appelant n’est pas touchée', async () => {
        const { changePassword } = await import('./changePassword');
        await changePassword({ currentPassword: 'actuel', newPassword: STRONG });
        // Sans persistSession:false, signInWithPassword écraserait la session en
        // cours par une session neuve, au passage rétrogradée en AAL1.
        expect(probeOptions?.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
        expect(probeSignOut).toHaveBeenCalled();
    });

    it('refuse un mot de passe identique à l’actuel', async () => {
        const { changePassword } = await import('./changePassword');
        const r = await changePassword({ currentPassword: STRONG, newPassword: STRONG });
        expect(r).toEqual({ ok: false, reason: 'unchanged' });
        expect(probeSignIn).not.toHaveBeenCalled();
    });

    it('refuse un mot de passe trop court avant tout appel réseau', async () => {
        const { changePassword } = await import('./changePassword');
        const r = await changePassword({ currentPassword: 'actuel', newPassword: 'court' });
        expect(r).toEqual({ ok: false, reason: 'too_short' });
        expect(probeSignIn).not.toHaveBeenCalled();
    });

    it('journalise le changement sans jamais consigner le mot de passe', async () => {
        const { changePassword } = await import('./changePassword');
        expect(await changePassword({ currentPassword: 'actuel', newPassword: STRONG })).toEqual({ ok: true });
        const [, entry] = audit.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
        expect(entry.action).toBe('PASSWORD_CHANGED');
        expect(JSON.stringify(entry)).not.toContain(STRONG);
    });
});

describe('revokeSession — fermer les autres, pas la sienne', () => {
    it('refuse de fermer la session courante', async () => {
        // La faire disparaître ferait s'évanouir l'écran sous les doigts ; le
        // geste attendu s'appelle se déconnecter et vit ailleurs.
        sessionRows = [{ id: '11111111-1111-4111-8111-111111111111', is_current: true }];
        const { revokeSession } = await import('./revokeSession');
        const r = await revokeSession({ sessionId: '11111111-1111-4111-8111-111111111111' });
        expect(r).toEqual({ ok: false, reason: 'is_current' });
        expect(rpc).not.toHaveBeenCalledWith('revoke_user_session', expect.anything());
    });

    it('refuse un identifiant qui n’est pas dans les siennes', async () => {
        sessionRows = [{ id: '11111111-1111-4111-8111-111111111111', is_current: true }];
        const { revokeSession } = await import('./revokeSession');
        const r = await revokeSession({ sessionId: '22222222-2222-4222-8222-222222222222' });
        expect(r).toEqual({ ok: false, reason: 'not_found' });
    });

    it('ferme une autre session et le journalise', async () => {
        sessionRows = [
            { id: '11111111-1111-4111-8111-111111111111', is_current: true },
            { id: '22222222-2222-4222-8222-222222222222', is_current: false },
        ];
        const { revokeSession } = await import('./revokeSession');
        expect(await revokeSession({ sessionId: '22222222-2222-4222-8222-222222222222' })).toEqual({ ok: true });
        expect(rpc).toHaveBeenCalledWith('revoke_user_session', {
            p_session_id: '22222222-2222-4222-8222-222222222222',
        });
        const [, entry] = audit.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
        expect(entry.action).toBe('SESSION_REVOKED');
    });

    it('rapporte l’échec quand la base n’a rien supprimé', async () => {
        sessionRows = [{ id: '22222222-2222-4222-8222-222222222222', is_current: false }];
        revokeReturns = false;
        const { revokeSession } = await import('./revokeSession');
        expect(await revokeSession({ sessionId: '22222222-2222-4222-8222-222222222222' }))
            .toEqual({ ok: false, reason: 'not_found' });
    });
});
