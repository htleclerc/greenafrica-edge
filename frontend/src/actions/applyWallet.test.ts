import { describe, it, expect, vi, beforeEach } from 'vitest';

let walletBalance = 500_000;
let walletId: string | null = 'w-1';
let txnShipownerId = 'so-1';
const inserts: { table: string; row: any }[] = [];

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'wallets') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({
                            data: walletId ? { id: walletId, balance_usd_minor: walletBalance } : null,
                            error: null,
                        }),
                    }),
                }),
            };
        }
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
        return {
            insert: (row: any) => {
                inserts.push({ table, row });
                return { select: () => ({ single: async () => ({ data: { id: 'pay-1', ...row }, error: null }) }) };
            },
        };
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
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
    walletBalance = 500_000;
    walletId = 'w-1';
    txnShipownerId = 'so-1';
    inserts.length = 0;
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

    it('inserts WALLET CONFIRMED payment + negative ledger entry', async () => {
        const { applyWallet } = await import('./applyWallet');
        await applyWallet({
            transactionId: '550e8400-e29b-41d4-a716-446655440000',
            amountMinor: 50000,
        });
        const pay = inserts.find(i => i.table === 'payments');
        const ledger = inserts.find(i => i.table === 'wallet_ledger');
        expect(pay?.row).toMatchObject({
            rail: 'WALLET', status: 'CONFIRMED', amount_usd_minor: 50000,
        });
        expect(ledger?.row).toMatchObject({
            kind: 'PROFORMA_APPLY', amount_signed_usd_minor: -50000, wallet_id: 'w-1',
        });
    });
});
