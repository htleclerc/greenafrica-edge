import { describe, it, expect, vi, beforeEach } from 'vitest';

type ApplyWalletCreditRpcArgs = {
    p_txn_id: string;
    p_shipowner_id: string;
    p_actor_user_id: string;
    p_amount_minor: number;
};

let walletBalance = 500_000;
let txnShipownerId = 'so-1';
const rpcCalls: { fn: string; args: ApplyWalletCreditRpcArgs }[] = [];

const mockSupabase = {
    // applyWalletCredit does everything atomically inside the apply_wallet_credit
    // RPC now — the only remaining `.from()` caller is applyWallet.ts itself,
    // checking the transaction's ownership before delegating to the service.
    from: vi.fn((table: string) => {
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: { id: 't-1', shipowner_id: txnShipownerId, tax_amount_usd: 1000 },
                            error: null,
                        }),
                    }),
                }),
            };
        }
        throw new Error(`mockSupabase.from: unexpected table "${table}"`);
    }),
    rpc: vi.fn(async (fn: string, args: ApplyWalletCreditRpcArgs) => {
        rpcCalls.push({ fn, args });
        if (fn === 'apply_wallet_credit') {
            if (walletBalance < args.p_amount_minor) {
                return { data: null, error: { message: 'insufficient wallet balance' } };
            }
            return { data: [{ payment_id: 'pay-1', wallet_id: 'w-1' }], error: null };
        }
        return { data: null, error: null };
    }),
};

vi.mock('@/lib/supabase/tenant', () => ({ createTenantClient: vi.fn(() => mockSupabase) }));
vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        email: 'owner@test.com',
        shipowner: { id: 'so-1', name: 'T', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    })),
}));

beforeEach(() => {
    walletBalance = 500_000;
    txnShipownerId = 'so-1';
    rpcCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    vi.clearAllMocks();
});

describe('applyWallet', () => {
    it('rejects when wallet has insufficient balance', async () => {
        walletBalance = 1000;
        const { applyWallet } = await import('./applyWallet');
        await expect(applyWallet({
            transactionId: '550e8400-e29b-41d4-a716-446655440000',
            amountMinor: 50000,
        })).rejects.toThrow(/insufficient/i);
    });

    it('rejects when transaction belongs to a different shipowner', async () => {
        txnShipownerId = 'OTHER';
        const { applyWallet } = await import('./applyWallet');
        await expect(applyWallet({
            transactionId: '550e8400-e29b-41d4-a716-446655440000',
            amountMinor: 1000,
        })).rejects.toThrow(/not your transaction/i);
    });

    it('applies via the atomic apply_wallet_credit RPC with correct args', async () => {
        const { applyWallet } = await import('./applyWallet');
        await applyWallet({
            transactionId: '550e8400-e29b-41d4-a716-446655440000',
            amountMinor: 50000,
        });
        const call = rpcCalls.find(c => c.fn === 'apply_wallet_credit');
        expect(call?.args).toMatchObject({
            p_txn_id: '550e8400-e29b-41d4-a716-446655440000',
            p_shipowner_id: 'so-1',
            p_amount_minor: 50000,
        });
    });

    it('emits a structured wallet_applied log event (Plan 7H-3)', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { applyWallet } = await import('./applyWallet');
        await applyWallet({
            transactionId: '550e8400-e29b-41d4-a716-446655440000',
            amountMinor: 50000,
        });
        const calls = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((c) => c.includes('"event":"wallet_applied"'))).toBe(true);
        consoleSpy.mockRestore();
    });
});
