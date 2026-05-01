import { describe, it, expect, vi, beforeEach } from 'vitest';

let canConfirmReturn = true;
const updateCalls: any[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];
const auditCalls: any[] = [];

const mockSupabase = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        if (fn === 'can_confirm_payment') return { data: canConfirmReturn, error: null };
        return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            select: () => ({ single: async () => ({ data: { id: 'pay-1' }, error: null }) }),
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

describe('rejectPayment', () => {
    it('requires a non-empty reason with min 3 chars', async () => {
        const { rejectPayment } = await import('./rejectPayment');
        await expect(rejectPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174000', reason: '' }))
            .rejects.toThrow();
        await expect(rejectPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174000', reason: 'ab' }))
            .rejects.toThrow();
    });

    it('rejects when can_confirm_payment returns false', async () => {
        canConfirmReturn = false;
        const { rejectPayment } = await import('./rejectPayment');
        await expect(rejectPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174001', reason: 'Wrong amount' }))
            .rejects.toThrow(/not authorized/i);
    });

    it('sets status=REJECTED and stores reason without calling recompute', async () => {
        const { rejectPayment } = await import('./rejectPayment');
        await rejectPayment({ paymentId: '123e4567-e89b-12d3-a456-426614174002', reason: 'Wrong amount' });
        expect(updateCalls[0]).toMatchObject({ status: 'REJECTED', rejected_reason: 'Wrong amount' });
        expect(rpcCalls.find(c => c.fn === 'recompute_transaction_status')).toBeUndefined();
        expect(auditCalls[0]).toMatchObject({
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Payment',
            entity_id: '123e4567-e89b-12d3-a456-426614174002',
            details_json: { event: 'PAYMENT_REJECTED', reason: 'Wrong amount' },
        });
    });
});
