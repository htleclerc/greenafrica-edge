import { describe, it, expect, vi, beforeEach } from 'vitest';

let aal: { currentLevel: string | null; nextLevel: string | null } = { currentLevel: 'aal1', nextLevel: 'aal1' };
let profileRow: Record<string, unknown> | null = {
    id: 'u-1', email: 'a@b.com', full_name: 'A', role: 'FINANCE_ADMIN',
    operational_site: null, country_code: 'SO', timezone: null, preferred_language: 'en',
    is_active: true, ip_address: null, can_settle_payments: true, payments_only: false,
};

const supabase = {
    auth: {
        getUser: async () => ({ data: { user: { id: 'u-1', last_sign_in_at: '' } }, error: null }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal, error: null }) },
    },
    from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: profileRow, error: null }) }) }),
    }),
};

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabase) }));

beforeEach(() => {
    aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
    profileRow = {
        id: 'u-1', email: 'a@b.com', full_name: 'A', role: 'FINANCE_ADMIN',
        operational_site: null, country_code: 'SO', timezone: null, preferred_language: 'en',
        is_active: true, ip_address: null, can_settle_payments: true, payments_only: false,
    };
    vi.clearAllMocks();
});

describe('requireRole AAL gate', () => {
    it('rejects an AAL1 session when a factor is enrolled (nextLevel aal2)', async () => {
        aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
        const { requireRole } = await import('./requireRole');
        const { UserRole } = await import('@/types/secure');
        const res = await requireRole([UserRole.FINANCE_ADMIN]);
        expect(res.error).not.toBeNull();
        expect(res.error?.status).toBe(403);
    });

    it('allows a user with no enrolled factor (nextLevel aal1)', async () => {
        aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
        const { requireRole } = await import('./requireRole');
        const { UserRole } = await import('@/types/secure');
        const res = await requireRole([UserRole.FINANCE_ADMIN]);
        expect(res.error).toBeNull();
        expect(res.user?.role).toBe(UserRole.FINANCE_ADMIN);
    });

    it('allows an already-elevated AAL2 session', async () => {
        aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
        const { requireRole } = await import('./requireRole');
        const { UserRole } = await import('@/types/secure');
        const res = await requireRole([UserRole.FINANCE_ADMIN]);
        expect(res.error).toBeNull();
    });
});
