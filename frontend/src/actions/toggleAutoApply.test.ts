import { describe, it, expect, vi, beforeEach } from 'vitest';

const updates: { table: string; values: any; eqCol: string; eqVal: any }[] = [];

const mockSupabase = {
    from: vi.fn((table: string) => ({
        update: (values: any) => ({
            eq: async (col: string, val: any) => {
                updates.push({ table, values, eqCol: col, eqVal: val });
                return { error: null };
            },
        }),
    })),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }));

const requireOwnerMock = vi.fn(async () => ({
    userId: 'u-1',
    email: 'owner@test.com',
    shipowner: { id: 'so-1', name: 'T', account_state: 'ACTIVE' },
    supabase: mockSupabase,
}));

vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: () => requireOwnerMock(),
}));

beforeEach(() => {
    updates.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    vi.clearAllMocks();
    requireOwnerMock.mockImplementation(async () => ({
        userId: 'u-1',
        email: 'owner@test.com',
        shipowner: { id: 'so-1', name: 'T', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    }));
});

describe('toggleAutoApply', () => {
    it('updates wallets.auto_apply_to_proforma for the caller shipowner', async () => {
        const { toggleAutoApply } = await import('./toggleAutoApply');
        await toggleAutoApply({ enabled: false });

        const upd = updates.find(u => u.table === 'wallets');
        expect(upd).toBeDefined();
        expect(upd?.values).toEqual({ auto_apply_to_proforma: false });
        expect(upd?.eqCol).toBe('shipowner_id');
        expect(upd?.eqVal).toBe('so-1');
    });

    it('throws when requireOwner rejects', async () => {
        requireOwnerMock.mockImplementationOnce(async () => {
            throw new Error('NEXT_REDIRECT: /owner/login');
        });
        const { toggleAutoApply } = await import('./toggleAutoApply');
        await expect(toggleAutoApply({ enabled: true })).rejects.toThrow(/NEXT_REDIRECT|owner/i);
    });
});
