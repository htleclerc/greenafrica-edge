import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = { id: 'admin-1', fullName: 'Test Admin', role: 'SUPERADMIN' };

let requireRoleResult: { user: typeof mockUser; error: null } | { user: null; error: { status: number } };
vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => requireRoleResult),
}));

vi.mock('@/lib/auth/adminTenant', () => ({
    assertAdminCanActOn: vi.fn(async (_user: unknown, jid: string) => jid),
}));

const mockPlatform = { from: vi.fn() };
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockPlatform),
    createTenantClient: vi.fn(() => mockPlatform),
}));

// Minimal PostgREST chain helper
function updateChain(error: unknown = null) {
    const chain: Record<string, unknown> = {};
    const end = async () => ({ error });
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.filter = () => chain;
    chain.update = () => chain;
    // Make it thenable so await works
    chain.then = (resolve: (v: unknown) => void) => resolve({ error });
    return {
        update: () => chain,
        from: () => chain,
    };
}

function insertChain(error: unknown = null) {
    return {
        insert: async () => ({ error }),
    };
}

const VALID_JID = '00000000-0000-4000-8000-00000000534f';
const FUTURE = new Date(Date.now() + 86400_000 * 10).toISOString().slice(0, 10);

beforeEach(() => {
    vi.clearAllMocks();
    requireRoleResult = { user: mockUser, error: null };
});

describe('createTariffVersion', () => {
    it('rejects past effectiveFrom', async () => {
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: '2020-01-01',
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('past_date');
    });

    it('rejects non-positive rate', async () => {
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: -5,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
    });

    it('rejects forbidden role', async () => {
        requireRoleResult = { user: null, error: { status: 403 } };
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('forbidden');
    });

    it('returns overlap error on exclusion constraint violation', async () => {
        // Mock: update chain + insert throws 23P01
        let callCount = 0;
        mockPlatform.from.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // close current version — succeeds
                return {
                    update: () => ({
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    is: () => ({
                                        filter: async () => ({ error: null }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                };
            }
            // insert — fails with overlap
            return {
                insert: async () => ({ error: { code: '23P01', message: 'tariffs_no_overlap' } }),
            };
        });

        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('overlap');
    });

    it('returns ok:true on successful insert', async () => {
        let callCount = 0;
        mockPlatform.from.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return {
                    update: () => ({
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    is: () => ({
                                        filter: async () => ({ error: null }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                };
            }
            if (callCount === 2) {
                return { insert: async () => ({ error: null }) };
            }
            // audit log
            return { insert: async () => ({ error: null }) };
        });

        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: VALID_JID,
            mode: 'AIR',
            ratePerTco2: 55,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-AIR-001',
        });
        expect(r.ok).toBe(true);
    });

    it('rejects invalid UUID jurisdictionId', async () => {
        const { createTariffVersion } = await import('./createTariffVersion');
        const r = await createTariffVersion({
            jurisdictionId: 'not-a-uuid',
            mode: 'MARITIME',
            ratePerTco2: 40,
            effectiveFrom: FUTURE,
            decreeRef: 'DEC-001',
        });
        expect(r.ok).toBe(false);
    });
});
