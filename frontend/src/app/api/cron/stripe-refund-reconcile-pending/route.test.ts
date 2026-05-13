import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/stripeService', () => ({
    retrieveRefund: vi.fn(),
}));

vi.mock('@/lib/system-actor', () => ({
    resolveSystemActor: vi.fn().mockResolvedValue('sys-actor-uuid'),
}));

vi.mock('@/services/notificationService', () => ({
    notifyOwner: vi.fn().mockResolvedValue({ id: 'notif-x' }),
    EMAIL_KINDS: new Set<string>(['REFUND_ISSUED']),
}));

// Hoisted mock state shared between the supabase factory and tests.
const mocks = vi.hoisted(() => ({
    pendingRefunds: [] as Array<Record<string, unknown>>,
    updateCalls: [] as Array<{
        where: Record<string, unknown>;
        guard: Record<string, unknown> | null;
        patch: Record<string, unknown>;
    }>,
    insertedAudits: [] as Record<string, unknown>[],
    updateRowsAffected: 1, // override per-test for race-guard idempotency case
}));

vi.mock('@supabase/supabase-js', () => {
    return {
        createClient: vi.fn(() => ({
            from: vi.fn((table: string) => {
                if (table === 'refunds') {
                    return {
                        // SELECT chain: select().eq().eq().lt().limit()
                        select: vi.fn(() => ({
                            eq: vi.fn(() => ({
                                eq: vi.fn(() => ({
                                    lt: vi.fn(() => ({
                                        limit: vi.fn().mockResolvedValue({
                                            data: mocks.pendingRefunds,
                                            error: null,
                                        }),
                                    })),
                                })),
                            })),
                        })),
                        // UPDATE chain: update().eq('id', x).eq('status', 'APPROVED')
                        update: vi.fn((patch: Record<string, unknown>) => ({
                            eq: vi.fn((col1: string, val1: unknown) => ({
                                eq: vi.fn((col2: string, val2: unknown) => {
                                    mocks.updateCalls.push({
                                        where: { [col1]: val1 },
                                        guard: { [col2]: val2 },
                                        patch,
                                    });
                                    return Promise.resolve({
                                        data: null,
                                        error: null,
                                        count: mocks.updateRowsAffected,
                                    });
                                }),
                            })),
                        })),
                    };
                }
                if (table === 'profiles') {
                    return {
                        select: vi.fn(() => ({
                            eq: vi.fn(() => ({
                                maybeSingle: vi.fn().mockResolvedValue({
                                    data: { full_name: 'System Reconciler' },
                                    error: null,
                                }),
                            })),
                        })),
                    };
                }
                if (table === 'audit_logs') {
                    return {
                        insert: vi.fn((entry: Record<string, unknown>) => {
                            mocks.insertedAudits.push(entry);
                            return Promise.resolve({ data: null, error: null });
                        }),
                    };
                }
                return { select: vi.fn() };
            }),
        })),
    };
});

import { GET } from './route';
import { retrieveRefund } from '@/services/stripeService';
import { notifyOwner } from '@/services/notificationService';

const BASE_REFUND = {
    id: 'refund-1',
    transaction_id: 'txn-1',
    shipowner_id: 'so-1',
    amount_usd_minor: 5000,
    refund_rail: 'STRIPE',
    status: 'APPROVED',
    rail_details: { stripe_refund_id: 're_test_abc' },
};

describe('GET /api/cron/stripe-refund-reconcile-pending', () => {
    beforeEach(() => {
        process.env.CRON_SECRET = 'topsecret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
        mocks.pendingRefunds = [];
        mocks.updateCalls = [];
        mocks.insertedAudits = [];
        mocks.updateRowsAffected = 1;
        vi.clearAllMocks();
    });

    it('returns 401 when authorization header missing', async () => {
        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 401 on wrong secret', async () => {
        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer wrong' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 200 + zero counts when no pending refunds', async () => {
        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ checked: 0, reconciled: 0, skipped: 0, errored: 0 });
    });

    it('Stripe succeeded → EXECUTED + notify dispatched + audit logged', async () => {
        mocks.pendingRefunds = [{ ...BASE_REFUND }];
        (retrieveRefund as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 're_test_abc',
            status: 'succeeded',
            failure_reason: null,
        });

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 1, skipped: 0, errored: 0 });

        const exec = mocks.updateCalls.find((c) => c.patch.status === 'EXECUTED');
        expect(exec).toBeDefined();
        expect(exec!.where.id).toBe('refund-1');
        expect(exec!.guard).toEqual({ status: 'APPROVED' });
        expect(exec!.patch.executed_by).toBe('sys-actor-uuid');
        expect(exec!.patch.executed_at).toBeTypeOf('string');

        expect(notifyOwner).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                kind: 'REFUND_ISSUED',
                shipownerId: 'so-1',
            }),
        );

        expect(mocks.insertedAudits.length).toBeGreaterThanOrEqual(1);
        const audit = mocks.insertedAudits[0] as { details_json: { event: string } };
        expect(audit.details_json.event).toBe('REFUND_RECONCILED_BY_CRON');
    });

    it('Stripe pending → no state change, no notify', async () => {
        mocks.pendingRefunds = [{ ...BASE_REFUND, id: 'refund-2' }];
        (retrieveRefund as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 're_test_abc',
            status: 'pending',
            failure_reason: null,
        });

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 0, skipped: 1, errored: 0 });

        expect(mocks.updateCalls.find((c) => c.patch.status === 'EXECUTED')).toBeUndefined();
        expect(mocks.updateCalls.find((c) => c.patch.status === 'REJECTED')).toBeUndefined();
        expect(notifyOwner).not.toHaveBeenCalled();
    });

    it('Stripe failed → REJECTED, no notify', async () => {
        mocks.pendingRefunds = [{ ...BASE_REFUND, id: 'refund-3' }];
        (retrieveRefund as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 're_test_abc',
            status: 'failed',
            failure_reason: 'insufficient_funds',
        });

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 1, skipped: 0, errored: 0 });

        const rejected = mocks.updateCalls.find((c) => c.patch.status === 'REJECTED');
        expect(rejected).toBeDefined();
        expect(rejected!.where.id).toBe('refund-3');
        expect(rejected!.guard).toEqual({ status: 'APPROVED' });
        expect(String(rejected!.patch.rejection_reason)).toContain('failed');
        expect(String(rejected!.patch.rejection_reason)).toContain('insufficient_funds');
        expect(notifyOwner).not.toHaveBeenCalled();
    });

    it('Stripe canceled → REJECTED', async () => {
        mocks.pendingRefunds = [{ ...BASE_REFUND, id: 'refund-3b' }];
        (retrieveRefund as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 're_test_abc',
            status: 'canceled',
            failure_reason: null,
        });

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 1, skipped: 0, errored: 0 });

        const rejected = mocks.updateCalls.find((c) => c.patch.status === 'REJECTED');
        expect(rejected).toBeDefined();
        expect(String(rejected!.patch.rejection_reason)).toContain('canceled');
    });

    it('Stripe API throw → counter incremented, row untouched', async () => {
        mocks.pendingRefunds = [{ ...BASE_REFUND, id: 'refund-4' }];
        (retrieveRefund as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Stripe 500'));

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 0, skipped: 0, errored: 1 });

        // No status flip
        expect(mocks.updateCalls.find((c) => c.patch.status === 'EXECUTED')).toBeUndefined();
        expect(mocks.updateCalls.find((c) => c.patch.status === 'REJECTED')).toBeUndefined();

        // rail_details patched with incremented counter
        const bump = mocks.updateCalls.find(
            (c) => c.where.id === 'refund-4' && 'rail_details' in c.patch,
        );
        expect(bump).toBeDefined();
        const newRailDetails = bump!.patch.rail_details as { reconcile_attempts: number };
        expect(newRailDetails.reconcile_attempts).toBe(1);
    });

    it('Missing stripe_refund_id → skipped, no Stripe call', async () => {
        mocks.pendingRefunds = [
            {
                ...BASE_REFUND,
                id: 'refund-5',
                rail_details: {}, // no stripe_refund_id
            },
        ];

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 0, skipped: 1, errored: 0 });

        expect(retrieveRefund).not.toHaveBeenCalled();
        // a rail_details write to record the skip reason is fine but not required
    });

    it('Race-guarded UPDATE returns 0 rows (status changed mid-flight) → counted as skipped', async () => {
        mocks.pendingRefunds = [{ ...BASE_REFUND, id: 'refund-6' }];
        (retrieveRefund as ReturnType<typeof vi.fn>).mockResolvedValue({
            id: 're_test_abc',
            status: 'succeeded',
            failure_reason: null,
        });
        mocks.updateRowsAffected = 0; // someone else won the race

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        // The race-loser counts as skipped — the work was already done.
        expect(json.checked).toBe(1);
        expect(json.reconciled).toBe(0);
        expect(json.skipped).toBe(1);
        expect(json.errored).toBe(0);

        // No notify when our UPDATE didn't actually flip the row
        expect(notifyOwner).not.toHaveBeenCalled();
    });

    it('Stripe attempts counter at >= 10 → skipped without Stripe call', async () => {
        mocks.pendingRefunds = [
            {
                ...BASE_REFUND,
                id: 'refund-7',
                rail_details: { stripe_refund_id: 're_test_abc', reconcile_attempts: 10 },
            },
        ];

        const req = new Request('http://x/api/cron/stripe-refund-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ checked: 1, reconciled: 0, skipped: 1, errored: 0 });
        expect(retrieveRefund).not.toHaveBeenCalled();
    });
});
