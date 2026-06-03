import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
    auth: { admin: { inviteUserByEmail: vi.fn() } },
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
        airSelfServiceEnabled: true,
    })),
    _readPortalFeatureFlagsImpl: vi.fn(),
    isFeatureEnabled: vi.fn(),
}));

// aircraft uses .select().or().limit(); shipowners uses .select().eq().single() + writes.
function aircraftStub(rows: unknown[]) {
    return { select: () => ({ or: () => ({ limit: async () => ({ data: rows }) }) }) };
}
function operatorReadStub(value: unknown) {
    return { select: () => ({ eq: () => ({ single: async () => ({ data: value }) }) }) };
}

const validInput = {
    email: 'pilot@example.com',
    name: 'Air Test Co',
    aoc_number: 'SO-AOC-001',
    aircraft_ident: '6O-ABC',
    country_code: 'SO',
    address: '1 Runway Rd',
    proof_doc_storage_path: 'pending/aoc.pdf',
    preferred_language: 'en' as const,
    recaptcha_token: 'tok',
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env.RECAPTCHA_SECRET_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_BASE_URL = 'http://test';
    vi.stubEnv('NODE_ENV', 'test');
});

describe('registerAirOperator decision tree', () => {
    it('AUTO-CLAIM when aircraft→GHOST→AOC matches (case-insensitive)', async () => {
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }]);
            if (table === 'shipowners') return {
                ...operatorReadStub({ id: 'op1', account_state: 'GHOST', aoc_number: 'so-aoc-001' }),
                update: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'op1' }], error: null }) }) }) }),
            };
            if (table === 'profiles' || table === 'wallets' || table === 'audit_logs') {
                return { insert: async () => ({ error: null }), upsert: async () => ({ error: null }) };
            }
            return operatorReadStub(null);
        });
        mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
            data: { user: { id: 'uid', email: 'pilot@example.com' } }, error: null,
        });

        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe('op1');
        expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalled();
    });

    it('PENDING_REVIEW when GHOST but AOC mismatch', async () => {
        let pendingInserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }]);
            if (table === 'shipowners') return {
                ...operatorReadStub({ id: 'op1', account_state: 'GHOST', aoc_number: 'DIFFERENT' }),
                insert: async () => { pendingInserted = true; return { error: null }; },
            };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(pendingInserted).toBe(true);
        expect(mockSupabase.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('PENDING_REVIEW when aircraft not found (cold signup)', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([]);
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('HARD REJECT (no insert) when operator already ACTIVE', async () => {
        const inserts: string[] = [];
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }]);
            if (table === 'shipowners') return {
                ...operatorReadStub({ id: 'op1', account_state: 'ACTIVE', aoc_number: 'SO-AOC-001' }),
                insert: async () => { inserts.push('shipowners'); return { error: null }; },
            };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(inserts).not.toContain('shipowners');
    });

    it('PENDING_REVIEW when aircraft_ident is ambiguous (2 rows)', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }, { id: 'ac2', operator_id: 'op2' }]);
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('rejects when air flag OFF (defense-in-depth, no DB writes)', async () => {
        const { readPortalFeatureFlags } = await import('@/lib/feature-flags');
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            portalV1Enabled: true, selfServiceEnabled: true, onlinePaymentStripeEnabled: true,
            walletTopupEnabled: true, notificationSmsEnabled: false, airSelfServiceEnabled: false,
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('rejects when rate limit hit', async () => {
        const { enforceRateLimit } = await import('@/lib/rateLimit');
        (enforceRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
    });
});
