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
                maybeSingle: async () => ({ data: transactionRow, error: null }),
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

let transactionRow: { invoice_ref: string | null } | null = { invoice_ref: 'INV-2026-abc' };
const createPaypalOrderMock = vi.fn();
const paypalConfiguredMock = vi.fn(() => true);

vi.mock('@/services/paypalService', () => ({
    createOrder: (...a: unknown[]) => createPaypalOrderMock(...a),
    paypalConfigured: () => paypalConfiguredMock(),
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
    transactionRow = { invoice_ref: 'INV-2026-abc' };
    createPaypalOrderMock.mockReset().mockResolvedValue({ orderId: 'ORDER-1', approveUrl: 'https://paypal.com/approve/ORDER-1' });
    paypalConfiguredMock.mockReset().mockReturnValue(true);
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

// ─────────────────────────────────────────────────────────────────────────────
// Rail PAYPAL — jumeau de STRIPE : ordre cree AVANT l'INSERT, ligne PROCESSING,
// checkoutUrl renvoyee au dialogue.
// ─────────────────────────────────────────────────────────────────────────────

describe('initiatePayment — rail PAYPAL', () => {
    const TX_ID = '123e4567-e89b-12d3-a456-426614174010';

    it('cree un ordre PayPal et insere une ligne PROCESSING', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        const out = await initiatePayment({
            transactionId: TX_ID,
            amount: '1250.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: {},
        });

        const row = inserted[0];
        expect(row.rail).toBe('PAYPAL');
        expect(row.status).toBe('PROCESSING');
        expect(row.external_reference).toBe('ORDER-1');
        expect(row.amount_usd_minor).toBe(125000);
        expect(row.rail_details.paypal_order_id).toBe('ORDER-1');
        expect(out.checkoutUrl).toBe('https://paypal.com/approve/ORDER-1');
    });

    it('passe montant, reference de facture et URLs de retour a PayPal', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await initiatePayment({
            transactionId: TX_ID,
            amount: '1250.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: {},
        });

        const arg = createPaypalOrderMock.mock.calls[0][0];
        expect(arg.amountUsdMinor).toBe(125000);
        expect(arg.transactionId).toBe(TX_ID);
        expect(arg.invoiceRef).toBe('INV-2026-abc');
        expect(arg.returnUrl).toContain('/api/payments/paypal/return');
        expect(arg.cancelUrl).toContain('/dashboard/invoices?paypal=cancel');
    });

    it('retombe sur l id de transaction si la facture n a pas de reference', async () => {
        transactionRow = { invoice_ref: null };
        const { initiatePayment } = await import('./initiatePayment');
        await initiatePayment({
            transactionId: TX_ID,
            amount: '10.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: {},
        });
        expect(createPaypalOrderMock.mock.calls[0][0].invoiceRef).toBe(TX_ID);
    });

    it('refuse si les credentials PayPal manquent, sans creer de ligne', async () => {
        paypalConfiguredMock.mockReturnValue(false);
        const { initiatePayment } = await import('./initiatePayment');
        await expect(initiatePayment({
            transactionId: TX_ID,
            amount: '10.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: {},
        })).rejects.toThrow(/paypal/i);
        expect(inserted).toEqual([]);
        expect(createPaypalOrderMock).not.toHaveBeenCalled();
    });

    it('ne cree aucune ligne si createOrder echoue', async () => {
        createPaypalOrderMock.mockRejectedValue(new Error('PayPal 422'));
        const { initiatePayment } = await import('./initiatePayment');
        await expect(initiatePayment({
            transactionId: TX_ID,
            amount: '10.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: {},
        })).rejects.toThrow('PayPal 422');
        expect(inserted).toEqual([]);
    });

    it('fonctionne en top-up (transactionId null)', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await initiatePayment({
            transactionId: null,
            amount: '500.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: {},
        });
        expect(inserted[0].transaction_id).toBeNull();
        expect(createPaypalOrderMock.mock.calls[0][0].transactionId).toBeNull();
        expect(createPaypalOrderMock.mock.calls[0][0].invoiceRef).toBe('TOPUP');
    });

    it('preserve les railDetails fournis par le dialogue', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await initiatePayment({
            transactionId: TX_ID,
            amount: '10.00', currency: 'USD', rail: 'PAYPAL',
            railDetails: { source: 'owner_initiated' },
        });
        expect(inserted[0].rail_details).toEqual({
            source: 'owner_initiated',
            paypal_order_id: 'ORDER-1',
        });
    });
});
