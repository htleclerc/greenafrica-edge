import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
    auth: { admin: { inviteUserByEmail: vi.fn(), listUsers: vi.fn() } },
};

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('@/lib/feature-flags', () => ({
    readPortalFeatureFlags: vi.fn(async () => ({
        portalV1Enabled: true,
        selfServiceEnabled: true,
        onlinePaymentStripeEnabled: true,
        walletTopupEnabled: true,
        notificationSmsEnabled: false,
    })),
    _readPortalFeatureFlagsImpl: vi.fn(),
    isFeatureEnabled: vi.fn(),
}));
vi.mock('@/services/staffNotificationService', () => ({
    notifyStaffSafe: vi.fn(async () => undefined),
}));

/**
 * `insert` qui accepte les deux formes du client réel : `await insert(...)`
 * seul, et `insert(...).select(...).maybeSingle()` quand l'appelant a besoin de
 * la ligne créée (mig 133 : la juridiction, pour router la notification staff).
 */
function insertReturning(row: unknown, onInsert?: (payload: unknown) => void) {
    const result = { data: row, error: null };
    const chain = {
        select: () => ({
            maybeSingle: async () => result,
            single: async () => result,
        }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return (payload: unknown) => { onInsert?.(payload); return chain; };
}

/** Table `vessels` qui répond selon la colonne interrogée — IMO ou MMSI. */
function vesselsBy(rows: { imo_number?: unknown; mmsi?: unknown }, seen?: string[]) {
    return {
        select: () => ({
            eq: (col: string, val: unknown) => {
                seen?.push(`${col}=${String(val)}`);
                const value = col === 'imo_number' ? rows.imo_number : rows.mmsi;
                return { maybeSingle: async () => ({ data: value ?? null }) };
            },
        }),
    };
}

function ownerRow(value: unknown) {
    return {
        select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: value }) }),
        }),
    };
}

const validInput = {
    email: 'a@example.com',
    name: 'Test Co',
    vessel_imo: '7654321',
    recaptcha_token: 'tok',
};

const CREATED = { id: 'new1', jurisdiction_id: 'j1' };

describe('registerShipowner — demande simplifiée', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RECAPTCHA_SECRET_KEY = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
        process.env.NEXT_PUBLIC_BASE_URL = 'http://test';
        vi.stubEnv('NODE_ENV', 'test');
    });

    it('met en service le dossier fantome rattache au navire, et invite le demandeur', async () => {
        // Decision produit : l'IMO du navire suffit. Il est public, donc cette
        // porte est ouverte a qui le connait — c'est assume, et borne par le
        // fait que seuls les dossiers JAMAIS actives sont concernes.
        const updates: unknown[] = [];
        mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
            data: { user: { id: 'u1' } }, error: null,
        });
        mockSupabase.from.mockImplementation((t: string) => {
            if (t === 'vessels') return vesselsBy({ imo_number: { id: 'v1', name: 'MAYAR', shipowner_id: 'so1' } });
            if (t === 'shipowners') {
                return {
                    ...ownerRow({ id: 'so1', account_state: 'GHOST' }),
                    update: (patch: unknown) => {
                        updates.push(patch);
                        return {
                            eq: () => ({
                                eq: () => ({ select: async () => ({ data: [{ id: 'so1', jurisdiction_id: 'j1' }], error: null }) }),
                                select: async () => ({ data: [{ id: 'so1', jurisdiction_id: 'j1' }], error: null }),
                            }),
                        };
                    },
                };
            }
            if (t === 'profiles') return { upsert: async () => ({ error: null }) };
            if (t === 'wallets') return { insert: async () => ({ error: null }) };
            if (t === 'audit_logs') return { insert: async () => ({ error: null }) };
            return {};
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '1.2.3.4');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe('so1');
        expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
            'a@example.com', expect.anything(),
        );

        const mise = updates[0] as Record<string, unknown>;
        expect(mise.account_state).toBe('ACTIVE');
        // L'adresse doit atterrir sur la ligne : le cron de relance resout le
        // destinataire par la, sinon l'armateur ne recoit jamais de pro-forma.
        expect(mise.official_email).toBe('a@example.com');
        // Aucune verification n'a eu lieu : ne rien dater.
        expect(mise).not.toHaveProperty('kyc_level_b_completed_at');
        expect(mise).not.toHaveProperty('imo_company_no_verified_at');
    });

    it("n'écrit rien quand le navire appartient déjà à un compte en service", async () => {
        // Garde anti-usurpation : l'IMO d'un navire est public, il ne doit
        // jamais suffire à s'inviter sur un dossier vivant.
        const inserted: unknown[] = [];
        mockSupabase.from.mockImplementation((t: string) => {
            if (t === 'vessels') return vesselsBy({ imo_number: { id: 'v1', name: 'MAYAR', shipowner_id: 'so1' } });
            if (t === 'shipowners') {
                return {
                    ...ownerRow({ id: 'so1', account_state: 'ACTIVE' }),
                    insert: insertReturning(CREATED, (p) => inserted.push(p)),
                };
            }
            return {};
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '1.2.3.4');

        expect(r.ok).toBe(true);
        expect(inserted).toHaveLength(0);
        // Message strictement identique au cas nominal : l'écran ne dit pas
        // qu'un dossier existe.
        expect(r.message).toMatch(/48h/);
    });

    it('retrouve le navire par son MMSI quand l’IMO ne tombe pas juste', async () => {
        const seen: string[] = [];
        const inserted: unknown[] = [];
        mockSupabase.from.mockImplementation((t: string) => {
            if (t === 'vessels') return vesselsBy({ imo_number: null, mmsi: { id: 'v9', name: 'BRAVE', shipowner_id: null } }, seen);
            if (t === 'shipowners') return { insert: insertReturning(CREATED, (p) => inserted.push(p)) };
            return {};
        });

        const { registerShipowner } = await import('./registerShipowner');
        await registerShipowner({ ...validInput, mmsi: '636012345' }, '1.2.3.4');

        expect(seen).toEqual(['imo_number=7654321', 'mmsi=636012345']);
        expect((inserted[0] as { notes: string }).notes).toContain('BRAVE');
        expect((inserted[0] as { notes: string }).notes).toContain('MMSI');
    });

    it("n'interroge pas le MMSI lorsqu'il n'est pas fourni", async () => {
        const seen: string[] = [];
        mockSupabase.from.mockImplementation((t: string) => {
            if (t === 'vessels') return vesselsBy({ imo_number: null }, seen);
            if (t === 'shipowners') return { insert: insertReturning(CREATED) };
            return {};
        });

        const { registerShipowner } = await import('./registerShipowner');
        await registerShipowner(validInput, '1.2.3.4');

        expect(seen).toEqual(['imo_number=7654321']);
    });

    it('accepte une demande dont aucun navire ne correspond, et le dit à l’agent', async () => {
        const inserted: unknown[] = [];
        mockSupabase.from.mockImplementation((t: string) => {
            if (t === 'vessels') return vesselsBy({ imo_number: null });
            if (t === 'shipowners') return { insert: insertReturning(CREATED, (p) => inserted.push(p)) };
            return {};
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '1.2.3.4');

        expect(r.ok).toBe(true);
        expect((inserted[0] as { notes: string }).notes).toContain('aucun navire correspondant');
    });

    it('ne date pas le KYC niveau B — le formulaire ne le prouve plus', async () => {
        // Adresse, pays et pièce justificative ont disparu du formulaire.
        // Dater le niveau B affirmerait une vérification qui n'a pas eu lieu.
        const inserted: Record<string, unknown>[] = [];
        mockSupabase.from.mockImplementation((t: string) => {
            if (t === 'vessels') return vesselsBy({ imo_number: null });
            if (t === 'shipowners') return { insert: insertReturning(CREATED, (p) => inserted.push(p as Record<string, unknown>)) };
            return {};
        });

        const { registerShipowner } = await import('./registerShipowner');
        await registerShipowner(validInput, '1.2.3.4');

        expect(inserted[0]).not.toHaveProperty('kyc_level_b_completed_at');
        expect(inserted[0].official_email).toBe('a@example.com');
        expect(inserted[0].proof_imo_vessel_imo).toBe('7654321');
    });

    it('refuse un IMO qui n’a pas 7 chiffres et un MMSI qui n’en a pas 9', async () => {
        mockSupabase.from.mockImplementation(() => ({}));
        const { registerShipowner } = await import('./registerShipowner');

        expect((await registerShipowner({ ...validInput, vessel_imo: '123' }, '1.2.3.4')).ok).toBe(false);
        expect((await registerShipowner({ ...validInput, mmsi: '12345' }, '1.2.3.4')).ok).toBe(false);
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('refuse quand le libre-service est désactivé', async () => {
        const { readPortalFeatureFlags } = await import('@/lib/feature-flags');
        vi.mocked(readPortalFeatureFlags).mockResolvedValueOnce({
            portalV1Enabled: true,
            selfServiceEnabled: false,
            onlinePaymentStripeEnabled: true,
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
        } as Awaited<ReturnType<typeof readPortalFeatureFlags>>);

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '1.2.3.4');

        expect(r.ok).toBe(false);
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('refuse quand le plafond de tentatives est atteint', async () => {
        const { enforceRateLimit } = await import('@/lib/rateLimit');
        vi.mocked(enforceRateLimit).mockResolvedValueOnce({ allowed: false });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '1.2.3.4');

        expect(r.ok).toBe(false);
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });
});
