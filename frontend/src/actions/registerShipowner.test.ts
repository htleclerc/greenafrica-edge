import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
    auth: { admin: { inviteUserByEmail: vi.fn(), listUsers: vi.fn() } },
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
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

function chainableSelect(value: unknown) {
    return {
        select: () => ({
            eq: (col: string, val: unknown) => ({
                maybeSingle: async () => ({ data: value }),
                single: async () => ({ data: value }),
            }),
        }),
    };
}

const validInput = {
    email: 'a@example.com',
    name: 'Test Co',
    imo_company_no: '1234567',
    country_code: 'SO',
    address: '1 Quay Rd',
    proof_imo_vessel_imo: '7654321',
    proof_doc_storage_path: 'docs/x.pdf',
    proof_doc_type: 'TRADE_REGISTER' as const,
    preferred_language: 'en' as const,
    recaptcha_token: 'tok',
};

describe('registerShipowner decision tree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RECAPTCHA_SECRET_KEY = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
        process.env.NEXT_PUBLIC_BASE_URL = 'http://test';
        vi.stubEnv('NODE_ENV', 'test');
    });

    it('AUTO-CLAIM when vessel→GHOST→imo_company match', async () => {
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: 'so1' });
            if (table === 'shipowners') return {
                ...chainableSelect({ id: 'so1', account_state: 'GHOST', imo_company_no: '1234567' }),
                update: () => ({
                    eq: () => ({
                        eq: () => ({
                            select: async () => ({ data: [{ id: 'so1' }], error: null })
                        })
                    })
                }),
                upsert: async () => ({ error: null }),
                insert: async () => ({ error: null }),
            };
            if (table === 'profiles' || table === 'wallets' || table === 'audit_logs') {
                return { insert: async () => ({ error: null }), upsert: async () => ({ error: null }) };
            }
            return chainableSelect(null);
        });
        mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
            data: { user: { id: 'uid', email: 'a@example.com' } },
            error: null
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe('so1');
        expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalled();
    });

    it('PENDING_REVIEW when vessel→GHOST imo_company mismatch (generic msg)', async () => {
        let pendingInserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: 'so1' });
            if (table === 'shipowners') return {
                ...chainableSelect({ id: 'so1', account_state: 'GHOST', imo_company_no: '9999999' }),
                insert: async () => { pendingInserted = true; return { error: null }; },
            };
            return chainableSelect(null);
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(pendingInserted).toBe(true);
        expect(mockSupabase.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('HARD REJECT (no insert) when vessel→ACTIVE owner', async () => {
        const inserts: string[] = [];
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: 'so1' });
            if (table === 'shipowners') return {
                ...chainableSelect({ id: 'so1', account_state: 'ACTIVE', imo_company_no: '1234567' }),
                insert: async () => { inserts.push('shipowners'); return { error: null }; },
            };
            return chainableSelect(null);
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(inserts).not.toContain('shipowners');
    });

    it('PENDING_REVIEW when vessel exists but no shipowner', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: null });
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            return chainableSelect(null);
        });
        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('PENDING_REVIEW when vessel not found', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect(null);
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            return chainableSelect(null);
        });
        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('rejects when self-service flag is OFF (Plan 7H-1 Task 5.1)', async () => {
        const { readPortalFeatureFlags } = await import('@/lib/feature-flags');
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            portalV1Enabled: true,
            selfServiceEnabled: false,
            onlinePaymentStripeEnabled: true,
            walletTopupEnabled: true,
            notificationSmsEnabled: false,
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
        expect(r.message).toMatch(/not currently enabled/i);
        // No DB writes should have happened.
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('rejects when rate limit hit', async () => {
        const { enforceRateLimit } = await import('@/lib/rateLimit');
        (enforceRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
    });
});
