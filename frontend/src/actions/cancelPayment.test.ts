import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateCalls: any[] = [];

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    select: () => ({ single: async () => ({ data: { id: 'pay-1' }, error: null }) }),
                                }),
                            }),
                        }),
                    };
                },
            };
        }
        return {} as any;
    }),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }));
vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        email: 'owner@test.com',
        shipowner: { id: 'so-1', name: 'T', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    })),
}));

beforeEach(() => {
    updateCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('cancelPayment', () => {
    it('flips status to CANCELLED via owner-scoped UPDATE', async () => {
        const { cancelPayment } = await import('./cancelPayment');
        await cancelPayment({ paymentId: '550e8400-e29b-41d4-a716-446655440000' });
        expect(updateCalls[0]).toMatchObject({ status: 'CANCELLED' });
    });
});
