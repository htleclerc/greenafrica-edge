import { describe, it, expect, vi, beforeEach } from 'vitest';

let canConfirmReturn = true;
const updateCalls: any[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];
const auditCalls: any[] = [];

const mockSupabase = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        if (fn === 'can_confirm_payment') return { data: canConfirmReturn, error: null };
        if (fn === 'recompute_transaction_status') return { data: null, error: null };
        return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            select: () => ({ single: async () => ({ data: { id: 'pay-1', transaction_id: 't-1' }, error: null }) }),
                        }),
                    };
                },
            };
        }
        if (table === 'audit_logs') {
            return { insert: async (row: any) => { auditCalls.push(row); return { error: null }; } };
        }
        return {} as any;
    }),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => ({
        user: { id: 'admin-1', fullName: 'Admin' },
        supabase: mockSupabase,
        error: null,
    })),
}));

beforeEach(() => {
    canConfirmReturn = true;
    updateCalls.length = 0;
    rpcCalls.length = 0;
    auditCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    vi.clearAllMocks();
});

describe('confirmPayment', () => {
    it('rejects when can_confirm_payment returns false', async () => {
        canConfirmReturn = false;
        const { confirmPayment } = await import('./confirmPayment');
        await expect(confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174000' }))
            .rejects.toThrow(/not authorized/i);
    });

    it('sets status=CONFIRMED with confirmed_by + confirmed_at and triggers recompute', async () => {
        const { confirmPayment } = await import('./confirmPayment');
        await confirmPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174001' });
        expect(updateCalls[0]).toMatchObject({ status: 'CONFIRMED', confirmed_by: 'admin-1' });
        expect(updateCalls[0].confirmed_at).toBeTruthy();
        expect(rpcCalls.find(c => c.fn === 'recompute_transaction_status')).toBeDefined();
        expect(auditCalls[0]).toMatchObject({
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Payment',
            entity_id: '123e4567-e89b-12d3-a456-426614174001',
        });
    });
});
