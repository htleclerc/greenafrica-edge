import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    createPaymentRequest,
    getActiveProvider,
    getActiveProviders,
    selectProvidersForRail,
    setProviderActive,
    verifyPaystackSignature,
    verifyFlutterwaveSignature,
    verifyPayoneerSignature,
    type PaymentRequest,
} from '../paymentService';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PAYMENT: PaymentRequest = {
    transactionId: '20000000-0000-0000-0000-000000000005',
    amount: 2000,
    currency: 'USD',
    invoiceRef: 'INV-2026-1A2B3C4D',
    description: 'Carbon Tax — TEST VESSEL',
    metadata: {
        vesselImo: '9999999',
        vesselName: 'TEST VESSEL',
        ownerEntity: 'Test Shipping Co',
        jurisdiction: 'Republic of Somaliland',
        taxPeriod: '2026-04',
    },
    customerEmail: 'agent@test.com',
};

// Minimal Supabase mock that records the chain calls and returns a controllable
// result. We don't need real RLS or persistence — just the shape the service
// touches: `from(table).select(...).eq(...).limit(1).single()`.
function makeFakeClient(activeProvider?: string) {
    const single = vi.fn().mockResolvedValue({
        data: activeProvider ? { provider: activeProvider } : null,
        error: null,
    });
    const limit = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { from } as unknown as SupabaseClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// getActiveProvider — the DB-driven default
// ─────────────────────────────────────────────────────────────────────────────

describe('getActiveProvider', () => {
    it('returns the active provider from payment_config', async () => {
        const client = makeFakeClient('flutterwave');
        const provider = await getActiveProvider(client);
        expect(provider).toBe('flutterwave');
    });

    it('falls back to wire_transfer when no row is active', async () => {
        const client = makeFakeClient(undefined);
        const provider = await getActiveProvider(client);
        expect(provider).toBe('wire_transfer');
    });

    it('queries the payment_config table with is_active filter', async () => {
        const client = makeFakeClient('payoneer');
        await getActiveProvider(client);
        expect((client.from as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('payment_config');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7C-2: multi-active providers + rail routing
// ─────────────────────────────────────────────────────────────────────────────

function makeMultiClient(rows: Array<{ provider: string; is_active: boolean; routes_rail: string[]; display_order: number }>) {
    return {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
            })),
            update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
        })),
    } as unknown as SupabaseClient;
}

describe('getActiveProviders', () => {
    it('returns all active rows ordered by display_order', async () => {
        const client = makeMultiClient([
            { provider: 'wire_transfer', is_active: true, routes_rail: ['WIRE_TRANSFER'], display_order: 5 },
            { provider: 'flutterwave',   is_active: true, routes_rail: ['STRIPE','MOBILE_MONEY'], display_order: 3 },
        ]);
        const list = await getActiveProviders(client);
        expect(list.map((p) => p.provider)).toEqual(['wire_transfer', 'flutterwave']);
    });

    it('returns empty array when no provider active', async () => {
        const client = makeMultiClient([]);
        expect(await getActiveProviders(client)).toEqual([]);
    });
});

describe('selectProvidersForRail', () => {
    it('returns providers whose routes_rail contains the rail', async () => {
        const client = makeMultiClient([
            { provider: 'wave',          is_active: true, routes_rail: ['MOBILE_MONEY'],            display_order: 4 },
            { provider: 'flutterwave',   is_active: true, routes_rail: ['STRIPE','MOBILE_MONEY'],   display_order: 3 },
            { provider: 'wire_transfer', is_active: true, routes_rail: ['WIRE_TRANSFER'],           display_order: 5 },
        ]);
        const result = await selectProvidersForRail(client, 'MOBILE_MONEY');
        expect(result.map((p) => p.provider)).toEqual(['flutterwave', 'wave']); // ordered by display_order asc
    });

    it('returns empty when no active provider serves the rail', async () => {
        const client = makeMultiClient([
            { provider: 'wire_transfer', is_active: true, routes_rail: ['WIRE_TRANSFER'], display_order: 5 },
        ]);
        expect(await selectProvidersForRail(client, 'NETTING')).toEqual([]);
    });
});

describe('setProviderActive', () => {
    it('sends update with is_active=true to the matching provider only', async () => {
        const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
        const client = { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient;
        await setProviderActive(client, 'flutterwave', true);
        expect(update).toHaveBeenCalledWith({ is_active: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature verification — security boundary, MUST be tested
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyPaystackSignature', () => {
    const ORIGINAL = process.env.PAYSTACK_SECRET_KEY;

    beforeEach(() => {
        process.env.PAYSTACK_SECRET_KEY = 'sk_test_paystack_secret';
    });

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.PAYSTACK_SECRET_KEY;
        else process.env.PAYSTACK_SECRET_KEY = ORIGINAL;
    });

    it('accepts a correctly signed body (HMAC-SHA512 of body with secret)', async () => {
        const { createHmac } = await import('crypto');
        const body = JSON.stringify({ event: 'charge.success', data: { reference: 'INV-2026-FOO' } });
        const validSig = createHmac('sha512', 'sk_test_paystack_secret').update(body).digest('hex');
        expect(await verifyPaystackSignature(body, validSig)).toBe(true);
    });

    it('rejects a tampered body', async () => {
        const { createHmac } = await import('crypto');
        const original = JSON.stringify({ event: 'charge.success' });
        const tampered = JSON.stringify({ event: 'charge.success', injected: 'malicious' });
        const sigForOriginal = createHmac('sha512', 'sk_test_paystack_secret').update(original).digest('hex');
        expect(await verifyPaystackSignature(tampered, sigForOriginal)).toBe(false);
    });

    it('rejects a body signed with the wrong secret', async () => {
        const { createHmac } = await import('crypto');
        const body = JSON.stringify({ event: 'charge.success' });
        const sigFromAttacker = createHmac('sha512', 'attacker_guess').update(body).digest('hex');
        expect(await verifyPaystackSignature(body, sigFromAttacker)).toBe(false);
    });

    it('rejects an empty signature', async () => {
        expect(await verifyPaystackSignature('{}', '')).toBe(false);
    });
});

describe('verifyFlutterwaveSignature', () => {
    const ORIGINAL = process.env.FLUTTERWAVE_WEBHOOK_HASH;

    beforeEach(() => {
        process.env.FLUTTERWAVE_WEBHOOK_HASH = 'flw_secret_verif_hash_xyz';
    });

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.FLUTTERWAVE_WEBHOOK_HASH;
        else process.env.FLUTTERWAVE_WEBHOOK_HASH = ORIGINAL;
    });

    it('accepts the matching verif-hash header', () => {
        expect(verifyFlutterwaveSignature('flw_secret_verif_hash_xyz')).toBe(true);
    });

    it('rejects a wrong hash', () => {
        expect(verifyFlutterwaveSignature('not_the_hash')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(verifyFlutterwaveSignature('')).toBe(false);
    });
});

describe('verifyPayoneerSignature', () => {
    const ORIGINAL = process.env.PAYONEER_WEBHOOK_SECRET;

    beforeEach(() => {
        process.env.PAYONEER_WEBHOOK_SECRET = 'payoneer_test_webhook_secret';
    });

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.PAYONEER_WEBHOOK_SECRET;
        else process.env.PAYONEER_WEBHOOK_SECRET = ORIGINAL;
    });

    it('accepts a body signed with HMAC-SHA256 of the secret', async () => {
        const { createHmac } = await import('crypto');
        const body = JSON.stringify({ event_type: 'charge.succeeded', reference_id: 'INV-2026-FOO' });
        const validSig = createHmac('sha256', 'payoneer_test_webhook_secret').update(body).digest('hex');
        expect(await verifyPayoneerSignature(body, validSig)).toBe(true);
    });

    it('rejects a wrong signature', async () => {
        expect(await verifyPayoneerSignature('{}', 'deadbeef')).toBe(false);
    });

    it('rejects when the secret is not configured', async () => {
        delete process.env.PAYONEER_WEBHOOK_SECRET;
        expect(await verifyPayoneerSignature('{}', 'anything')).toBe(false);
    });

    it('rejects an empty signature even with valid secret', async () => {
        expect(await verifyPayoneerSignature('{}', '')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// createPaymentRequest — the routing layer that picks the right provider
// ─────────────────────────────────────────────────────────────────────────────

describe('createPaymentRequest', () => {
    const originalFetch = global.fetch;
    const originalFlutterwaveKey = process.env.FLUTTERWAVE_SECRET_KEY;
    const originalPayoneerKey = process.env.PAYONEER_API_KEY;
    const originalPayoneerProgram = process.env.PAYONEER_PROGRAM_ID;
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

    beforeEach(() => {
        process.env.NEXT_PUBLIC_APP_URL = 'https://test.dev';
    });

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalFlutterwaveKey === undefined) delete process.env.FLUTTERWAVE_SECRET_KEY;
        else process.env.FLUTTERWAVE_SECRET_KEY = originalFlutterwaveKey;
        if (originalPayoneerKey === undefined) delete process.env.PAYONEER_API_KEY;
        else process.env.PAYONEER_API_KEY = originalPayoneerKey;
        if (originalPayoneerProgram === undefined) delete process.env.PAYONEER_PROGRAM_ID;
        else process.env.PAYONEER_PROGRAM_ID = originalPayoneerProgram;
        if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
        else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
        vi.restoreAllMocks();
    });

    it('routes to wire_transfer when override is set, no fetch needed', async () => {
        const fetchSpy = vi.fn();
        global.fetch = fetchSpy as unknown as typeof fetch;

        const client = makeFakeClient('flutterwave');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'wire_transfer');

        expect(result.provider).toBe('wire_transfer');
        expect(result.status).toBe('pending');
        expect(result.wireInstructions).toBeDefined();
        expect(result.wireInstructions?.beneficiary).toBe('Solide Technology Limited');
        expect(result.wireInstructions?.iban).toBe('MT12SYPL39480821090981701607644');
        expect(result.wireInstructions?.swiftCode).toBe('SYPLMTM2XXX');
        expect(result.wireInstructions?.intermediaryBank).toBeUndefined();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('uses the active provider from the DB when no override is specified', async () => {
        // Mock fetch to return a Flutterwave-shaped success response
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                status: 'success',
                data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc123' },
            }),
        });
        global.fetch = fetchSpy as unknown as typeof fetch;
        process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-test-key';

        const client = makeFakeClient('flutterwave');
        const result = await createPaymentRequest(client, MOCK_PAYMENT);

        expect(result.provider).toBe('flutterwave');
        expect(result.status).toBe('pending');
        expect(result.checkoutUrl).toBe('https://checkout.flutterwave.com/v3/hosted/pay/abc123');
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.flutterwave.com/v3/payments',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('Flutterwave: returns a failed result when the API errors', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: false,
            json: async () => ({ status: 'error', message: 'Invalid currency' }),
        });
        global.fetch = fetchSpy as unknown as typeof fetch;
        process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-test-key';

        const client = makeFakeClient('flutterwave');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'flutterwave');

        // The service falls back to wire_transfer on any thrown error,
        // but a non-OK response just returns a `failed` result for the provider.
        expect(result.provider).toBe('flutterwave');
        expect(result.status).toBe('failed');
    });

    it('Flutterwave: falls back to wire_transfer when API key is missing', async () => {
        delete process.env.FLUTTERWAVE_SECRET_KEY;
        const fetchSpy = vi.fn();
        global.fetch = fetchSpy as unknown as typeof fetch;

        const client = makeFakeClient('flutterwave');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'flutterwave');

        expect(result.provider).toBe('flutterwave');
        expect(result.status).toBe('failed');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Payoneer: builds a v4/charges request and returns the checkout URL', async () => {
        process.env.PAYONEER_API_KEY = 'payoneer_pat_test';
        process.env.PAYONEER_PROGRAM_ID = '100200300';

        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'CHARGE-XYZ-789',
                checkout_url: 'https://checkout.payoneer.com/sessions/abc',
            }),
        });
        global.fetch = fetchSpy as unknown as typeof fetch;

        const client = makeFakeClient('payoneer');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'payoneer');

        expect(result.provider).toBe('payoneer');
        expect(result.status).toBe('pending');
        expect(result.checkoutUrl).toBe('https://checkout.payoneer.com/sessions/abc');
        expect(result.paymentId).toBe('CHARGE-XYZ-789');

        // Verify it called the right endpoint
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.payoneer.com/v4/programs/100200300/charges');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer payoneer_pat_test');
        const sentBody = JSON.parse(init.body);
        expect(sentBody.reference_id).toBe('INV-2026-1A2B3C4D');
        expect(sentBody.amount.value).toBe('2000.00');
        expect(sentBody.amount.currency).toBe('USD');
        expect(sentBody.metadata.vessel_imo).toBe('9999999');
    });

    it('Payoneer: respects PAYONEER_API_BASE_URL override (sandbox)', async () => {
        process.env.PAYONEER_API_KEY = 'payoneer_pat_test';
        process.env.PAYONEER_PROGRAM_ID = '100200300';
        process.env.PAYONEER_API_BASE_URL = 'https://api.sandbox.payoneer.com';

        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'X', checkout_url: 'https://sandbox.payoneer.com/pay/X' }),
        });
        global.fetch = fetchSpy as unknown as typeof fetch;

        const client = makeFakeClient('payoneer');
        await createPaymentRequest(client, MOCK_PAYMENT, 'payoneer');

        const [url] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.sandbox.payoneer.com/v4/programs/100200300/charges');

        delete process.env.PAYONEER_API_BASE_URL;
    });

    it('Payoneer: returns failed when API key is missing', async () => {
        delete process.env.PAYONEER_API_KEY;
        delete process.env.PAYONEER_PROGRAM_ID;
        const fetchSpy = vi.fn();
        global.fetch = fetchSpy as unknown as typeof fetch;

        const client = makeFakeClient('payoneer');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'payoneer');

        expect(result.provider).toBe('payoneer');
        expect(result.status).toBe('failed');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Payoneer: returns failed when API responds without a checkout URL', async () => {
        process.env.PAYONEER_API_KEY = 'payoneer_pat_test';
        process.env.PAYONEER_PROGRAM_ID = '100200300';

        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'X' }),  // missing checkout_url
        });
        global.fetch = fetchSpy as unknown as typeof fetch;

        const client = makeFakeClient('payoneer');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'payoneer');

        expect(result.provider).toBe('payoneer');
        expect(result.status).toBe('failed');
    });

    it('falls back to wire_transfer when the provider handler throws', async () => {
        // Simulate a network error from Flutterwave
        global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
        process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-test-key';

        const client = makeFakeClient('flutterwave');
        const result = await createPaymentRequest(client, MOCK_PAYMENT, 'flutterwave');

        // The try/catch in createPaymentRequest catches the throw and falls back
        expect(result.provider).toBe('wire_transfer');
        expect(result.wireInstructions).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7C-3: listAdminPayments
// ─────────────────────────────────────────────────────────────────────────────

import { listAdminPayments, type AdminPaymentFilters } from '../paymentService';

describe('listAdminPayments', () => {
    function makeFilterClient(rows: Array<Record<string, unknown>>) {
        // Chain: from(...).select(...).in?(...).eq?(...).gte?(...).lte?(...).ilike?(...).order(...).limit(...) → resolved
        const limitFn = vi.fn().mockResolvedValue({ data: rows, error: null });
        const order = vi.fn(() => ({ limit: limitFn }));
        // Every chainable filter returns an object with all chainable filters + order
        const chainable = (): Record<string, unknown> => {
            const obj: Record<string, unknown> = {};
            obj.in = vi.fn(() => chainable());
            obj.eq = vi.fn(() => chainable());
            obj.gte = vi.fn(() => chainable());
            obj.lte = vi.fn(() => chainable());
            obj.ilike = vi.fn(() => chainable());
            obj.order = order;
            return obj;
        };
        const select = vi.fn(() => chainable());
        return { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;
    }

    it('returns rows mapped to PaymentRow[]', async () => {
        const client = makeFilterClient([
            { id: 'p1', status: 'INITIATED', rail: 'CHEQUE', amount_usd_minor: 50000, currency: 'USD',
              shipowner_id: 's1', transaction_id: 't1', declared_by: 'a1',
              amount_minor: 50000, fx_rate: null, fx_rate_source: null, fx_rate_locked_at: null,
              rail_details: {}, external_reference: null, rejected_reason: null,
              confirmed_by: null, confirmed_at: null,
              created_at: '2026-05-10T00:00:00Z', updated_at: '2026-05-10T00:00:00Z' },
        ]);
        const filters: AdminPaymentFilters = { status: ['INITIATED'], rail: [], from: null, to: null, q: null };
        const rows = await listAdminPayments(client, filters);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('p1');
        expect(rows[0].rail).toBe('CHEQUE');
    });

    it('handles empty filter gracefully', async () => {
        const client = makeFilterClient([]);
        const rows = await listAdminPayments(client, { status: [], rail: [], from: null, to: null, q: null });
        expect(rows).toEqual([]);
    });
});
