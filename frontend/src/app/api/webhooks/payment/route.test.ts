import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// Fake supabase admin client — captures calls + returns scriptable rows.
// auditService and system-actor are NOT mocked: audit inserts go through the
// real writeAuditLog so the payload shape is asserted against the real table.
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of public.audit_action (mig 003, extended by mig 016) and
// public.audit_severity (mig 003). An insert with any other value fails at
// the DB level — which is exactly the bug this suite locks down.
const AUDIT_ACTIONS = [
    'LOGIN', 'LOGOUT', 'VESSEL_VIEWED', 'INVOICE_GENERATED',
    'TAX_RATE_UPDATED', 'EXEMPTION_GRANTED', 'REPORT_EXPORTED',
    'USER_CREATED', 'TRANSACTION_UPDATED', 'INVOICE_SENT',
];
const AUDIT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];

const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];

let transactionRows: Record<string, unknown>[] = [];
let systemActorRow: Record<string, unknown> | null = null;

function resetMocks() {
    insertCalls.length = 0;
    transactionRows = [{
        id: 'abcd1234-0000-0000-0000-000000000000',
        vessel_id: 'v-1',
        vessel_name: 'MV Test',
        tax_amount_usd: 1250,
    }];
    systemActorRow = { id: 'sys-admin-1' };
}

const fromBuilder = (table: string) => {
    if (table === 'transactions') {
        return {
            select: () => ({
                ilike: () => ({
                    limit: async () => ({ data: transactionRows, error: null }),
                }),
            }),
        };
    }
    if (table === 'profiles') {
        // resolveSystemActor: select().eq().in().order().limit().maybeSingle()
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

const mockSupabase = { from: vi.fn(fromBuilder) };

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/services/paymentService', () => ({
    confirmPayment: vi.fn().mockResolvedValue(true),
    verifyPaystackSignature: vi.fn().mockResolvedValue(true),
    verifyFlutterwaveSignature: vi.fn().mockReturnValue(true),
    verifyPayoneerSignature: vi.fn().mockResolvedValue(true),
}));

function buildReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
    return new Request('http://x/api/webhooks/payment', {
        method: 'POST',
        body: JSON.stringify(body),
        headers,
    }) as unknown as NextRequest;
}

const paystackSuccess = {
    event: 'charge.success',
    data: { reference: 'INV-2026-ABCD1234', id: 12345 },
};

beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
});

describe('POST /api/webhooks/payment — audit trail', () => {
    it('writes an audit log with valid enum values on Paystack success', async () => {
        const { POST } = await import('./route');
        const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));

        expect(res.status).toBe(200);

        const { confirmPayment } = await import('@/services/paymentService');
        expect(confirmPayment).toHaveBeenCalledWith(
            mockSupabase, 'abcd1234-0000-0000-0000-000000000000', '12345',
        );

        const audit = insertCalls.find((c) => c.table === 'audit_logs');
        expect(audit).toBeDefined();
        const payload = audit!.payload;

        // action/severity must be members of the DB enums — 'PAYMENT_RECEIVED'
        // and lowercase 'info' are rejected by Postgres.
        expect(AUDIT_ACTIONS).toContain(payload.action);
        expect(AUDIT_SEVERITIES).toContain(payload.severity);
        expect(payload.action).toBe('TRANSACTION_UPDATED');
        expect(payload.severity).toBe('INFO');

        // The real event lives in details_json (the column is details_json,
        // not details — an unknown column also fails the insert).
        expect(payload).not.toHaveProperty('details');
        expect(payload.details_json).toMatchObject({
            event: 'PAYMENT_RECEIVED',
            provider: 'paystack',
            provider_ref: '12345',
            amount_usd: 1250,
            vessel: 'MV Test',
        });

        // user_id has an FK to profiles — must be a resolved system actor,
        // not the sentinel zero-UUID. user_full_name is NOT NULL.
        expect(payload.user_id).toBe('sys-admin-1');
        expect(payload.user_id).not.toBe('00000000-0000-0000-0000-000000000000');
        expect(typeof payload.user_full_name).toBe('string');
        expect((payload.user_full_name as string).length).toBeGreaterThan(0);
    });

    it('skips the audit write (fail-soft) when no system actor exists', async () => {
        systemActorRow = null;
        const { POST } = await import('./route');
        const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));

        // Payment confirmation must still succeed — audit is best-effort.
        expect(res.status).toBe(200);
        const { confirmPayment } = await import('@/services/paymentService');
        expect(confirmPayment).toHaveBeenCalled();
        expect(insertCalls.find((c) => c.table === 'audit_logs')).toBeUndefined();
    });

    it('does not confirm or audit on a non-success event', async () => {
        const { POST } = await import('./route');
        const res = await POST(buildReq(
            { event: 'charge.failed', data: { reference: 'INV-2026-ABCD1234', id: 12345 } },
            { 'x-paystack-signature': 'sig' },
        ));

        expect(res.status).toBe(200);
        const { confirmPayment } = await import('@/services/paymentService');
        expect(confirmPayment).not.toHaveBeenCalled();
        expect(insertCalls).toHaveLength(0);
    });

    it('returns 404 when no transaction matches the reference', async () => {
        transactionRows = [];
        const { POST } = await import('./route');
        const res = await POST(buildReq(paystackSuccess, { 'x-paystack-signature': 'sig' }));

        expect(res.status).toBe(404);
        expect(insertCalls).toHaveLength(0);
    });
});
