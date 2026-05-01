import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: any[] = [];
const mockSupabase = {
    from: vi.fn(() => ({
        insert: vi.fn((row: any) => {
            inserted.push(row);
            return {
                select: () => ({
                    single: async () => ({ data: { id: 'pay-1', ...row }, error: null }),
                }),
            };
        }),
        select: vi.fn(() => ({
            eq: () => ({
                order: () => ({
                    limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                }),
            }),
        })),
    })),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/services/fxRateService', () => ({
    lockRate: vi.fn(async (_db, ccy: string) =>
        ccy === 'USD'
            ? { rate: 1, source: 'IDENTITY', lockedAt: '2026-05-01T00:00:00Z' }
            : { rate: 0.92, source: 'OPENEXCHANGERATES', lockedAt: '2026-05-01T00:00:00Z' },
    ),
}));

vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        email: 'owner@test.com',
        shipowner: { id: 'so-1', name: 'Test', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    })),
}));

beforeEach(() => {
    inserted.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    vi.clearAllMocks();
});

describe('initiatePayment', () => {
    it('rejects unsupported rail for owner caller', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await expect(initiatePayment({
            transactionId: '123e4567-e89b-12d3-a456-426614174000',
            amount: '100.00', currency: 'USD', rail: 'CASH',
            railDetails: {},
        })).rejects.toThrow(/owner cannot initiate/i);
    });

    it('inserts USD payment with amount_minor === amount_usd_minor and fx_rate NULL', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        const r = await initiatePayment({
            transactionId: '123e4567-e89b-12d3-a456-426614174001',
            amount: '250.00', currency: 'USD', rail: 'WIRE_TRANSFER',
            railDetails: { swift_ref: 'X' },
        });
        expect(r.id).toBe('pay-1');
        expect(inserted[0]).toMatchObject({
            amount_minor: 25000,
            currency: 'USD',
            amount_usd_minor: 25000,
            fx_rate: null,
            rail: 'WIRE_TRANSFER',
            status: 'INITIATED',
        });
    });

    it('locks FX rate for non-USD and computes amount_usd_minor', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await initiatePayment({
            transactionId: '123e4567-e89b-12d3-a456-426614174002',
            amount: '100.00', currency: 'EUR', rail: 'WIRE_TRANSFER',
            railDetails: {},
        });
        expect(inserted[0]).toMatchObject({
            amount_minor: 10000,
            currency: 'EUR',
            // 10000 EUR-minor / 0.92 = 10869.57 → rounded to 10870 USD-minor
            amount_usd_minor: 10870,
            fx_rate: 0.92,
            fx_rate_source: 'OPENEXCHANGERATES',
        });
    });
});
