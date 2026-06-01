import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UpdateCall {
    table: string;
    values: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
    filters: Array<{ op: string; column: string; value: unknown }>;
}

const updates: UpdateCall[] = [];
let resolvedCount = 3;

function makeUpdateBuilder(table: string, values: Record<string, unknown>, options?: Record<string, unknown>) {
    const call: UpdateCall = { table, values, options, filters: [] };
    updates.push(call);
    const builder: {
        eq: (column: string, value: unknown) => typeof builder;
        is: (column: string, value: unknown) => typeof builder;
        then: (resolve: (r: { error: null; count: number }) => unknown) => Promise<unknown>;
    } = {
        eq(column: string, value: unknown) {
            call.filters.push({ op: 'eq', column, value });
            return builder;
        },
        is(column: string, value: unknown) {
            call.filters.push({ op: 'is', column, value });
            return builder;
        },
        then(resolve) {
            return Promise.resolve(resolve({ error: null, count: resolvedCount }));
        },
    };
    return builder;
}

const mockSupabase = {
    from: vi.fn((table: string) => ({
        update: (values: Record<string, unknown>, options?: Record<string, unknown>) =>
            makeUpdateBuilder(table, values, options),
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
    updates.length = 0;
    resolvedCount = 3;
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

describe('markAllNotificationsRead', () => {
    it('returns count of updated rows', async () => {
        resolvedCount = 7;
        const { markAllNotificationsRead } = await import('./markAllNotificationsRead');
        const result = await markAllNotificationsRead();
        expect(result).toEqual({ count: 7 });
    });

    it('scopes by shipowner_id and is_null read_at and requests exact count', async () => {
        const { markAllNotificationsRead } = await import('./markAllNotificationsRead');
        await markAllNotificationsRead();

        const up = updates.find(u => u.table === 'owner_notifications');
        expect(up).toBeDefined();
        expect(typeof up?.values.read_at).toBe('string');
        expect(up?.options).toEqual({ count: 'exact' });
        expect(up?.filters).toEqual([
            { op: 'eq', column: 'shipowner_id', value: 'so-1' },
            { op: 'is', column: 'read_at', value: null },
        ]);
    });
});
