import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from './walletService';

function makeClient(opts: {
    wallet?: Record<string, unknown> | null;
    ledger?: Array<Record<string, unknown>>;
    alerts?: Array<Record<string, unknown>>;
} = {}) {
    const single = (data: unknown) => vi.fn().mockResolvedValue({ data, error: null });
    return {
        from: vi.fn((table: string) => {
            if (table === 'wallets') {
                return {
                    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: single(opts.wallet ?? null) })) })),
                };
            }
            if (table === 'wallet_ledger') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            order: vi.fn(() => ({
                                range: vi.fn().mockResolvedValue({ data: opts.ledger ?? [], error: null }),
                                limit: vi.fn().mockResolvedValue({ data: opts.ledger ?? [], error: null }),
                            })),
                        })),
                    })),
                };
            }
            if (table === 'transactions') {
                // predictNextTax chains: .select().eq().in().gte().order()
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            in: vi.fn(() => ({
                                gte: vi.fn(() => ({
                                    order: vi.fn().mockResolvedValue({ data: opts.alerts ?? [], error: null }),
                                })),
                            })),
                        })),
                    })),
                };
            }
            return { select: vi.fn() };
        }),
    } as unknown as SupabaseClient;
}

describe('getWalletForOwner', () => {
    it('returns wallet row when found', async () => {
        const client = makeClient({ wallet: { id: 'w1', balance_usd_minor: 50000, auto_apply_to_proforma: true } });
        const w = await getWalletForOwner(client, 'own-1');
        expect(w?.id).toBe('w1');
        expect(w?.balance_usd_minor).toBe(50000);
    });

    it('returns null when no wallet', async () => {
        const client = makeClient({ wallet: null });
        const w = await getWalletForOwner(client, 'own-1');
        expect(w).toBeNull();
    });
});

describe('listLedgerEntries', () => {
    it('returns ledger entries ordered desc', async () => {
        const client = makeClient({
            ledger: [
                { id: 'l1', amount_signed_usd_minor: 500000, kind: 'TOPUP', created_at: '2026-05-10T00:00:00Z' },
                { id: 'l2', amount_signed_usd_minor: -100000, kind: 'PROFORMA_APPLY', created_at: '2026-05-09T00:00:00Z' },
            ],
        });
        const rows = await listLedgerEntries(client, 'w1', { kinds: [], offset: 0, limit: 50 });
        expect(rows).toHaveLength(2);
        expect(rows[0].kind).toBe('TOPUP');
    });
});

describe('predictNextTax', () => {
    it('returns confidence=low when fewer than 5 alerts', async () => {
        const client = makeClient({ alerts: [
            { tax_amount_usd: 100, created_at: '2026-05-01' },
            { tax_amount_usd: 120, created_at: '2026-05-05' },
        ] });
        const p = await predictNextTax(client, 'own-1');
        expect(p.confidence).toBe('low');
    });

    it('returns prediction with median × frequency when enough alerts', async () => {
        const baseDate = new Date('2026-03-01');
        const alerts = Array.from({ length: 30 }, (_, i) => ({
            tax_amount_usd: 100 + i * 10,
            created_at: new Date(baseDate.getTime() + i * 86400000).toISOString(),
        }));
        const client = makeClient({ alerts });
        const p = await predictNextTax(client, 'own-1');
        expect(p.confidence).toBe('high');
        expect(p.estimated_count_30d).toBeGreaterThan(0);
        expect(p.estimated_amount_30d_usd).toBeGreaterThan(0);
    });

    it('returns confidence=medium for 5-14 alerts', async () => {
        const baseDate = new Date('2026-04-01');
        const alerts = Array.from({ length: 10 }, (_, i) => ({
            tax_amount_usd: 200 + i * 5,
            created_at: new Date(baseDate.getTime() + i * 86400000).toISOString(),
        }));
        const client = makeClient({ alerts });
        const p = await predictNextTax(client, 'own-1');
        expect(p.confidence).toBe('medium');
        expect(p.estimated_count_30d).toBeGreaterThan(0);
        expect(p.estimated_amount_30d_usd).toBeGreaterThan(0);
    });
});
