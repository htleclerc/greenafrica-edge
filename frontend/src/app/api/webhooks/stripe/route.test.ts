import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Fake supabase admin client — captures calls + returns scriptable rows.
// ─────────────────────────────────────────────────────────────────────────────

interface UpdateCall {
    table: string;
    payload: Record<string, unknown>;
    matcher?: { column: string; value: unknown };
    matchers?: { column: string; value: unknown }[];
}

interface InsertCall {
    table: string;
    payload: Record<string, unknown>;
}

const updateCalls: UpdateCall[] = [];
const insertCalls: InsertCall[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];

// Scriptable mocks (per-test)
let paymentRow: Record<string, unknown> | null = null;
let shipownerRow: Record<string, unknown> | null = null;
let transactionRow: Record<string, unknown> | null = null;
let systemActorRow: Record<string, unknown> | null = null;
// Plan 7G Task 8 — charge.refunded reconciliation mocks
let refundRowByStripeId: Record<string, unknown> | null = null;
let refundRowFallback: Record<string, unknown> | null = null;
let refundUpdateRaceTrip = false; // when true, refunds UPDATE .select() returns []

function resetMocks() {
    updateCalls.length = 0;
    insertCalls.length = 0;
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
    refundRowByStripeId = null;
    refundRowFallback = null;
    refundUpdateRaceTrip = false;
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
    if (table === 'refunds') {
        // Primary lookup: select().eq('rail_details->>stripe_refund_id', X).limit(1).maybeSingle()
        //   → returns refundRowByStripeId
        // Fallback lookup: select().eq('transaction_id', X).eq('rail', 'STRIPE').in('status', [...]).limit(2)
        //   → returns refundRowFallback as an array (so dedup logic can verify single match)
        // UPDATE race-guarded: update(payload).eq('id', X).eq('status', expected).select('id, shipowner_id, transaction_id')
        //   → returns [{id}] unless refundUpdateRaceTrip
        return {
            select: () => {
                const chain = {
                    eq: (column: string, value: unknown) => {
                        // Track filter chain
                        const filters: { column: string; value: unknown }[] = [{ column, value }];
                        const innerChain: Record<string, unknown> = {};
                        innerChain.eq = (c2: string, v2: unknown) => {
                            filters.push({ column: c2, value: v2 });
                            return innerChain;
                        };
                        innerChain.in = (_c: string, _vs: unknown) => innerChain;
                        innerChain.limit = (_n: number) => innerChain;
                        innerChain.maybeSingle = async () => {
                            // Primary path: only filter is rail_details->>stripe_refund_id
                            const hasJsonFilter = filters.some((f) =>
                                f.column.includes('stripe_refund_id'),
                            );
                            if (hasJsonFilter) {
                                return { data: refundRowByStripeId, error: null };
                            }
                            return { data: null, error: null };
                        };
                        // Fallback path resolves as a thenable returning array
                        // (when .limit() is the terminal chain in fallback path)
                        Object.defineProperty(innerChain, 'then', {
                            value: (resolve: (v: unknown) => void) => {
                                const arr = refundRowFallback ? [refundRowFallback] : [];
                                resolve({ data: arr, error: null });
                            },
                        });
                        return innerChain;
                    },
                };
                return chain;
            },
            update: (payload: Record<string, unknown>) => {
                const matchers: { column: string; value: unknown }[] = [];
                const chain: Record<string, unknown> = {};
                chain.eq = (column: string, value: unknown) => {
                    matchers.push({ column, value });
                    return chain;
                };
                chain.in = (column: string, values: unknown) => {
                    matchers.push({ column, value: values });
                    return chain;
                };
                chain.select = (_cols: string) => {
                    updateCalls.push({ table, payload, matchers, matcher: matchers[0] });
                    return Promise.resolve({
                        data: refundUpdateRaceTrip ? [] : [{ id: 'refund-1' }],
                        error: null,
                    });
                };
                return chain;
            },
        };
    }
    if (table === 'audit_logs') {
        return {
            insert: (payload: Record<string, unknown>) => {
                insertCalls.push({ table, payload });
                return Promise.resolve({ data: null, error: null });
            },
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

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
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

vi.mock('@/services/notificationService', () => ({
    notifyOwner: vi.fn().mockResolvedValue({ id: 'notif-1' }),
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

        // recompute_transaction_status RPC fired with the mig-051 param name
        const recompute = rpcCalls.find((c) => c.fn === 'recompute_transaction_status');
        expect(recompute).toBeDefined();
        expect(recompute!.args).toEqual({ p_txn_id: 't-1' });
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

    it('emits a structured webhook_payment_succeeded log event (Plan 7H-3)', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_log_1',
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: 'pi_log',
                    latest_charge: 'ch_log',
                    amount_received: 50000,
                    currency: 'usd',
                    payment_method_types: ['card'],
                },
            },
        });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { POST } = await import('./route');
        await POST(buildReq('{}', { 'stripe-signature': 'good' }));
        const calls = consoleSpy.mock.calls.map((c) => String(c[0]));
        expect(calls.some((c) => c.includes('"event":"webhook_event_received"'))).toBe(true);
        expect(calls.some((c) => c.includes('"event":"webhook_payment_succeeded"'))).toBe(true);
        consoleSpy.mockRestore();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Plan 7G — Task 8: charge.refunded handler tests
    // ─────────────────────────────────────────────────────────────────────────

    it('on charge.refunded with APPROVED match: marks EXECUTED + notify + audit', async () => {
        refundRowByStripeId = {
            id: 'refund-1',
            status: 'APPROVED',
            shipowner_id: 'so-1',
            transaction_id: 't-1',
            amount_usd_minor: 25000,
            refund_rail: 'STRIPE',
            rail_details: { stripe_refund_id: 're_abc' },
        };
        transactionRow = { invoice_ref: 'INV-2026-009', vessel_name: 'MV Match' };

        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_refund_1',
            type: 'charge.refunded',
            data: {
                object: {
                    id: 'ch_abc',
                    payment_intent: 'pi_orig',
                    refunds: { data: [{ id: 're_abc' }] },
                },
            },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        const upd = updateCalls.find(
            (c) => c.table === 'refunds' && c.payload.status === 'EXECUTED',
        );
        expect(upd).toBeDefined();
        expect(upd?.payload).toMatchObject({
            status: 'EXECUTED',
            executed_by: 'sys-admin-1',
        });
        const railDetails = upd?.payload.rail_details as Record<string, unknown>;
        expect(railDetails).toMatchObject({
            stripe_refund_id: 're_abc',
            webhook_reconciled: true,
        });
        // Race guard: matcher includes ('status', expected pre-state) — APPROVED OR REQUESTED
        const statusMatcher = upd?.matchers?.find((m) => m.column === 'status');
        expect(statusMatcher).toBeDefined();

        // Notification dispatched
        const { notifyOwner } = await import('@/services/notificationService');
        expect(notifyOwner).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                shipownerId: 'so-1',
                kind: 'REFUND_ISSUED',
            }),
        );

        // Audit log written
        const auditInsert = insertCalls.find(
            (c) =>
                c.table === 'audit_logs' &&
                (c.payload.details_json as Record<string, unknown>)?.event ===
                    'REFUND_RECONCILED_BY_WEBHOOK',
        );
        expect(auditInsert).toBeDefined();
        expect(auditInsert?.payload).toMatchObject({
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Refund',
            entity_id: 'refund-1',
        });
    });

    it('on charge.refunded with EXECUTED match: idempotent no-op (no UPDATE, no notify)', async () => {
        refundRowByStripeId = {
            id: 'refund-1',
            status: 'EXECUTED',
            shipowner_id: 'so-1',
            transaction_id: 't-1',
            amount_usd_minor: 25000,
            refund_rail: 'STRIPE',
            rail_details: { stripe_refund_id: 're_abc' },
        };

        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_refund_2',
            type: 'charge.refunded',
            data: {
                object: {
                    id: 'ch_abc',
                    payment_intent: 'pi_orig',
                    refunds: { data: [{ id: 're_abc' }] },
                },
            },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        expect(updateCalls.filter((c) => c.table === 'refunds')).toHaveLength(0);
        const { notifyOwner } = await import('@/services/notificationService');
        expect(notifyOwner).not.toHaveBeenCalled();
    });

    it('on charge.refunded with no matching refund: logs warning + 200', async () => {
        // refundRowByStripeId and refundRowFallback both null. The handler now
        // emits a structured warn event via the logger (console.log JSON line)
        // rather than a raw console.warn — assert on the structured output.
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_refund_3',
            type: 'charge.refunded',
            data: {
                object: {
                    id: 'ch_xyz',
                    payment_intent: 'pi_unknown',
                    refunds: { data: [{ id: 're_unknown' }] },
                },
            },
        });

        const { POST } = await import('./route');
        const res = await POST(buildReq('{}', { 'stripe-signature': 'good' }));

        expect(res.status).toBe(200);
        expect(updateCalls.filter((c) => c.table === 'refunds')).toHaveLength(0);
        const logLines = logSpy.mock.calls.map((c) => String(c[0]));
        expect(logLines.some((l) => l.includes('"event":"refund_no_match"'))).toBe(true);
        const { notifyOwner } = await import('@/services/notificationService');
        expect(notifyOwner).not.toHaveBeenCalled();
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
