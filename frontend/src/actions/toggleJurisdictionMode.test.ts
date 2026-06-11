import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = { id: 'admin-1', fullName: 'Test Admin' };

// requireRole mock — success by default
let requireRoleResult: { user: typeof mockUser; error: null } | { user: null; error: { status: number } };
vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => requireRoleResult),
}));

const mockPlatform = { from: vi.fn() };
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockPlatform),
}));

// Chain builder: .select().single() → { data, error }
function chainUpdate(data: unknown, error: unknown = null) {
    return {
        update: () => ({
            eq: () => ({
                eq: () => ({
                    select: () => ({
                        single: async () => ({ data, error }),
                    }),
                }),
            }),
        }),
        select: () => ({
            eq: () => ({
                eq: () => ({
                    single: async () => ({ data: { activated_at: null }, error: null }),
                }),
            }),
        }),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    requireRoleResult = { user: mockUser, error: null };
});

describe('toggleJurisdictionMode', () => {
    it('rejects invalid input (missing field)', async () => {
        const { toggleJurisdictionMode } = await import('./toggleJurisdictionMode');
        const r = await toggleJurisdictionMode({ jurisdictionId: 'not-a-uuid', mode: 'MARITIME', enabled: true });
        expect(r.ok).toBe(false);
    });

    it('rejects forbidden role', async () => {
        requireRoleResult = { user: null, error: { status: 403 } };
        const { toggleJurisdictionMode } = await import('./toggleJurisdictionMode');
        const r = await toggleJurisdictionMode({
            jurisdictionId: '00000000-0000-4000-8000-00000000534f',
            mode: 'MARITIME',
            enabled: true,
        });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('insufficient role');
    });

    it('returns ok:true when DB update succeeds', async () => {
        const jid = '00000000-0000-4000-8000-00000000534f';
        mockPlatform.from.mockReturnValue(chainUpdate({ jurisdiction_id: jid }));
        const { toggleJurisdictionMode } = await import('./toggleJurisdictionMode');
        const r = await toggleJurisdictionMode({ jurisdictionId: jid, mode: 'MARITIME', enabled: false });
        expect(r.ok).toBe(true);
    });

    it('returns ok:false when DB returns no row', async () => {
        const jid = '00000000-0000-4000-8000-00000000534f';
        mockPlatform.from.mockReturnValue(chainUpdate(null, { message: 'not_found' }));
        const { toggleJurisdictionMode } = await import('./toggleJurisdictionMode');
        const r = await toggleJurisdictionMode({ jurisdictionId: jid, mode: 'AIR', enabled: true });
        expect(r.ok).toBe(false);
    });

    it('rejects invalid mode enum', async () => {
        const { toggleJurisdictionMode } = await import('./toggleJurisdictionMode');
        const r = await toggleJurisdictionMode({
            jurisdictionId: '00000000-0000-4000-8000-00000000534f',
            mode: 'ROAD',
            enabled: true,
        });
        expect(r.ok).toBe(false);
    });
});
