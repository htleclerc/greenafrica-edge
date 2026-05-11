import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Fake supabase admin client — captures calls + returns scriptable rows.
// ─────────────────────────────────────────────────────────────────────────────

interface UpdateCall {
    table: string;
    payload: Record<string, unknown>;
    matcher?: { column: string; value: unknown };
}

const updateCalls: UpdateCall[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];

// Scriptable mocks (per-test)
let paymentRow: Record<string, unknown> | null = null;
let shipownerRow: Record<string, unknown> | null = null;
let transactionRow: Record<string, unknown> | null = null;
let systemActorRow: Record<string, unknown> | null = null;

function resetMocks() {
    updateCalls.length = 0;
    rpcCalls.length = 0;
    paymentRow = {
        id: 'pay-1',
        status: 'PROCESSING',
        transaction_id: 't-1',
        shipowner_id: 'so-1',
        amount_usd_minor: 50000,
        currency: 'USD',
        rail_details: {},
    };
    shipownerRow = { name: 'Acme Shipping', official_email: 'owner@acme.test' };
    transactionRow = { invoice_ref: 'INV-2026-001', vessel_name: 'MV Test' };
    systemActorRow = { id: 'sys-admin-1' };
}

const fromBuilder = (table: string) => {
    if (table === 'payments') {
        return {
            select: () => ({
                eq: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: paymentRow, error: null }),
                    }),
                }),
            }),
            update: (payload: Record<string, unknown>) => ({
                eq: (column: string, value: unknown) => {
                    updateCalls.push({ table, payload, matcher: { column, value } });
                    return Promise.resolve({ data: null, error: null });
                },
            }),
        };
    }
    if (table === 'shipowners') {
        return {
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: shipownerRow, error: null }),
                }),
            }),
        };
    }
    if (table === 'transactions') {
        return {
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: transactionRow, error: null }),
                }),
            }),
        };
    }
    if (table === 'profiles') {
        return {
            select: () => ({
                eq: () => ({
                    in: () => ({
                        order: () => ({
                            limit: () => ({
                                maybeSingle: async () => ({ data: systemActorRow, error: null }),
                            }),
                        }),
                    }),
                }),
            }),
        };
    }
    return {} as unknown as Record<string, unknown>;
};

const mockSupabase = {
    from: vi.fn(fromBuilder),
    rpc: vi.fn(async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return { data: null, error: null };
    }),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/services/stripeService', () => ({
    verifyWebhookSignature: vi.fn(),
}));

vi.mock('@/services/receiptService', () => ({
    generatePaymentReceipt: vi.fn().mockResolvedValue({
        receiptRef: 'RCT-2026-TEST',
        pdfBuffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }),
}));

vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

function buildReq(body: string, headers: Record<string, string> = {}): NextRequest {
    return new Request('http://x/api/webhooks/stripe', {
        method: 'POST',
        body,
        headers,
    }) as unknown as NextRequest;
}

beforeEach(() => {
    resetMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    vi.clearAllMocks();
});

describe('POST /api/webhooks/stripe', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
        const { POST } = await import('./route');
        const res = await POST(buildReq('{}'));
        expect(res.status).toBe(400);
    });

    it('returns 400 when verifyWebhookSignature throws', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('Invalid signature');
        });
        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'bad' }));
        expect(res.status).toBe(400);
    });

    it('on payment_intent.succeeded: UPDATEs row CONFIRMED + captures rail_details + receipt + email', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_1',
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: 'pi_123',
                    latest_charge: 'ch_456',
                    amount_received: 50000,
                    currency: 'usd',
                    payment_method_types: ['card'],
                },
            },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        const upd = updateCalls.find((c) => c.table === 'payments' && c.payload.status === 'CONFIRMED');
        expect(upd).toBeDefined();
        expect(upd?.payload).toMatchObject({
            status: 'CONFIRMED',
            confirmed_by: 'sys-admin-1',
        });
        const railDetails = upd?.payload.rail_details as Record<string, unknown>;
        expect(railDetails).toMatchObject({
            stripe_charge_id: 'ch_456',
            payment_method_type: 'card',
            fx_rate_source: 'STRIPE_SETTLE',
        });
        expect(upd?.payload.confirmed_at).toBeTruthy();

        // Receipt + email invoked
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        expect(generatePaymentReceipt).toHaveBeenCalledWith(expect.anything(), 'pay-1');
        expect(sendPaymentConfirmationEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'owner@acme.test',
                receiptRef: 'RCT-2026-TEST',
                invoiceRef: 'INV-2026-001',
            }),
        );

        // recompute_transaction_status RPC fired
        expect(rpcCalls.find((c) => c.fn === 'recompute_transaction_status')).toBeDefined();
    });

    it('is idempotent: returns 200 without re-UPDATE when row is already CONFIRMED', async () => {
        paymentRow = { ...(paymentRow as Record<string, unknown>), status: 'CONFIRMED' };

        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_2',
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_123', latest_charge: 'ch_456', payment_method_types: ['card'] } },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        // No UPDATE call against payments
        expect(updateCalls.filter((c) => c.table === 'payments')).toHaveLength(0);

        // No receipt/email triggered for idempotent skip
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        expect(generatePaymentReceipt).not.toHaveBeenCalled();
        expect(sendPaymentConfirmationEmail).not.toHaveBeenCalled();
    });

    it('on payment_intent.payment_failed: UPDATEs row REJECTED with Stripe error message', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_3',
            type: 'payment_intent.payment_failed',
            data: {
                object: {
                    id: 'pi_123',
                    last_payment_error: { message: 'card declined' },
                },
            },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        const upd = updateCalls.find((c) => c.table === 'payments' && c.payload.status === 'REJECTED');
        expect(upd).toBeDefined();
        expect(upd?.payload.rejected_reason).toMatch(/card declined/i);
        expect(upd?.payload.rejected_reason).toMatch(/stripe/i);
    });

    it('on checkout.session.expired: UPDATEs row CANCELLED', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_4',
            type: 'checkout.session.expired',
            data: { object: { payment_intent: 'pi_123' } },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        const upd = updateCalls.find((c) => c.table === 'payments' && c.payload.status === 'CANCELLED');
        expect(upd).toBeDefined();
    });

    it('on unhandled event type: returns 200 without any UPDATE', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_5',
            type: 'invoice.created',
            data: { object: {} },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        expect(updateCalls).toHaveLength(0);
        logSpy.mockRestore();
    });

    it('does not fail when receipt generation throws — payment stays CONFIRMED', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_6',
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: 'pi_123',
                    latest_charge: 'ch_456',
                    payment_method_types: ['card'],
                },
            },
        });
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        (generatePaymentReceipt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('PDF crash'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        // UPDATE to CONFIRMED still happened
        expect(updateCalls.find((c) => c.payload.status === 'CONFIRMED')).toBeDefined();
        errSpy.mockRestore();
    });
});
