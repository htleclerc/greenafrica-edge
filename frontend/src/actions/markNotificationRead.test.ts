import { describe, it, expect, vi, beforeEach } from 'vitest';

interface UpdateCall {
    table: string;
    values: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
    filters: Array<{ op: string; column: string; value: unknown }>;
}

const updates: UpdateCall[] = [];

function makeUpdateBuilder(table: string, values: Record<string, unknown>, options?: Record<string, unknown>) {
    const call: UpdateCall = { table, values, options, filters: [] };
    updates.push(call);
    const builder: {
        eq: (column: string, value: unknown) => typeof builder;
        is: (column: string, value: unknown) => typeof builder;
        then: (resolve: (r: { error: null; count?: number }) => unknown) => Promise<unknown>;
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
            return Promise.resolve(resolve({ error: null, count: 0 }));
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

describe('markNotificationRead', () => {
    it('updates owner_notifications.read_at scoped by id and shipowner_id', async () => {
        const { markNotificationRead } = await import('./markNotificationRead');
        await markNotificationRead({ notificationId: '123e4567-e89b-42d3-a456-426614174000' });

        const up = updates.find(u => u.table === 'owner_notifications');
        expect(up).toBeDefined();
        // read_at should be an ISO timestamp string
        expect(typeof up?.values.read_at).toBe('string');
        // Filters should scope by both id and shipowner_id
        expect(up?.filters).toEqual([
            { op: 'eq', column: 'id', value: '123e4567-e89b-42d3-a456-426614174000' },
            { op: 'eq', column: 'shipowner_id', value: 'so-1' },
        ]);
    });

    it('throws when requireOwner rejects', async () => {
        requireOwnerMock.mockImplementationOnce(async () => {
            throw new Error('NEXT_REDIRECT: /owner/login');
        });
        const { markNotificationRead } = await import('./markNotificationRead');
        await expect(
            markNotificationRead({ notificationId: '123e4567-e89b-42d3-a456-426614174000' }),
        ).rejects.toThrow(/NEXT_REDIRECT|owner/i);
    });
});
