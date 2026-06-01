import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UpsertCall {
    table: string;
    values: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
}

const upserts: UpsertCall[] = [];

const mockSupabase = {
    from: vi.fn((table: string) => ({
        upsert: async (values: Record<string, unknown>, options?: Record<string, unknown>) => {
            upserts.push({ table, values, options });
            return { error: null };
        },
    })),
};

vi.mock('@/lib/supabase/tenant', () => ({ createTenantClient: vi.fn(() => mockSupabase) }));

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
    upserts.length = 0;
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
    it('upserts wallets.auto_apply_to_proforma for the caller shipowner', async () => {
        const { toggleAutoApply } = await import('./toggleAutoApply');
        await toggleAutoApply({ enabled: false });

        const up = upserts.find(u => u.table === 'wallets');
        expect(up).toBeDefined();
        expect(up?.values).toEqual({ shipowner_id: 'so-1', auto_apply_to_proforma: false });
        expect(up?.options).toEqual({ onConflict: 'shipowner_id' });
    });

    it('upserts a wallet row for a fresh shipowner with no prior wallet', async () => {
        // UPSERT covers the create-on-first-toggle case — the same call works
        // whether the row exists or not. Asserting the call shape is identical.
        const { toggleAutoApply } = await import('./toggleAutoApply');
        await toggleAutoApply({ enabled: true });

        const up = upserts.find(u => u.table === 'wallets');
        expect(up?.values).toEqual({ shipowner_id: 'so-1', auto_apply_to_proforma: true });
        expect(up?.options).toEqual({ onConflict: 'shipowner_id' });
    });

    it('throws when requireOwner rejects', async () => {
        requireOwnerMock.mockImplementationOnce(async () => {
            throw new Error('NEXT_REDIRECT: /owner/login');
        });
        const { toggleAutoApply } = await import('./toggleAutoApply');
        await expect(toggleAutoApply({ enabled: true })).rejects.toThrow(/NEXT_REDIRECT|owner/i);
    });
});
