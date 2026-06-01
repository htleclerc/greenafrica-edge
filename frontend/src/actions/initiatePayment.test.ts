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

vi.mock('@/lib/supabase/tenant', () => ({
    createTenantClient: vi.fn(() => mockSupabase),
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
        jurisdictionId: '00000000-0000-4000-8000-00000000534f',
        supabase: mockSupabase,
    })),
}));

vi.mock('@/services/stripeService', () => ({
    createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/c/cs_test_123',
        stripePaymentIntentId: 'pi_test_123',
        stripeSessionId: 'cs_test_123',
    }),
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

describe('initiatePayment — STRIPE rail', () => {
    it('creates Checkout session, inserts PROCESSING, returns checkoutUrl', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        const result = await initiatePayment({
            transactionId: '123e4567-e89b-42d3-a456-426614174000',
            amount: '100.00',
            currency: 'USD',
            rail: 'STRIPE',
            railDetails: {},
        });

        const { createCheckoutSession } = await import('@/services/stripeService');
        expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
            amountUsdMinor: 10000,
            shipownerId: 'so-1',
            invoiceId: '123e4567-e89b-42d3-a456-426614174000',
        }));
        expect(result).toEqual(expect.objectContaining({
            status: 'PROCESSING',
            checkoutUrl: 'https://checkout.stripe.com/c/cs_test_123',
        }));

        expect(inserted[0]).toMatchObject({
            rail: 'STRIPE',
            status: 'PROCESSING',
            external_reference: 'pi_test_123',
            rail_details: {
                stripe_session_id: 'cs_test_123',
                stripe_payment_intent_id: 'pi_test_123',
            },
        });
    });

    it('throws if Stripe SDK throws', async () => {
        const { createCheckoutSession } = await import('@/services/stripeService');
        (createCheckoutSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Stripe API error'));
        const { initiatePayment } = await import('./initiatePayment');
        await expect(initiatePayment({
            transactionId: '123e4567-e89b-42d3-a456-426614174000',
            amount: '100.00', currency: 'USD', rail: 'STRIPE', railDetails: {},
        })).rejects.toThrow(/Stripe API error/);
    });
});
