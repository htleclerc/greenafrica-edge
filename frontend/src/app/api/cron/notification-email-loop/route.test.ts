import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/notificationEmailDispatch', () => ({
    dispatchNotificationEmail: vi.fn(),
}));

// Hoisted mock state shared between vi.mock factory and test bodies.
const mocks = vi.hoisted(() => ({
    pendingRows: [] as Array<Record<string, unknown>>,
    ownersByShipownerId: {} as Record<string, { official_email: string | null; name: string }>,
    updateCalls: [] as Array<{
        where: Record<string, unknown>;
        guard: Record<string, unknown> | null;
        patch: Record<string, unknown>;
    }>,
}));

vi.mock('@supabase/supabase-js', () => {
    // Thenable helper — returns the data when awaited at the end of a chain.
    const thenable = <T>(value: T) =>
        ({ then: (resolve: (v: T) => void) => resolve(value) }) as PromiseLike<T>;

    return {
        createClient: vi.fn(() => ({
            from: vi.fn((table: string) => {
                if (table === 'owner_notifications') {
                    return {
                        select: vi.fn(() => ({
                            in: vi.fn(() => ({
                                is: vi.fn(() => ({
                                    gt: vi.fn(() => ({
                                        limit: vi.fn().mockResolvedValue({
                                            data: mocks.pendingRows,
                                            error: null,
                                        }),
                                    })),
                                })),
                            })),
                        })),
                        update: vi.fn((patch: Record<string, unknown>) => ({
                            eq: vi.fn((col1: string, val1: unknown) => ({
                                is: vi.fn((col2: string, val2: unknown) => {
                                    mocks.updateCalls.push({
                                        where: { [col1]: val1 },
                                        guard: { [col2]: val2 },
                                        patch,
                                    });
                                    return thenable({ data: null, error: null, count: 1 });
                                }),
                                // Bare update().eq() (no guard) — used for attempt counter writes.
                                then: (resolve: (v: unknown) => void) => {
                                    mocks.updateCalls.push({
                                        where: { [col1]: val1 },
                                        guard: null,
                                        patch,
                                    });
                                    resolve({ data: null, error: null });
                                },
                            })),
                        })),
                    };
                }
                if (table === 'shipowners') {
                    return {
                        select: vi.fn(() => ({
                            in: vi.fn((_col: string, ids: string[]) => {
                                const rows = ids.map((id) => ({
                                    id,
                                    official_email: mocks.ownersByShipownerId[id]?.official_email ?? null,
                                    name: mocks.ownersByShipownerId[id]?.name ?? 'Unknown',
                                }));
                                return Promise.resolve({ data: rows, error: null });
                            }),
                        })),
                    };
                }
                return { select: vi.fn() };
            }),
        })),
    };
});

import { GET } from './route';
import { dispatchNotificationEmail } from '@/services/notificationEmailDispatch';

describe('GET /api/cron/notification-email-loop', () => {
    beforeEach(() => {
        process.env.CRON_SECRET = 'topsecret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
        mocks.pendingRows = [];
        mocks.ownersByShipownerId = {};
        mocks.updateCalls = [];
        vi.clearAllMocks();
    });

    it('returns 401 when authorization header missing', async () => {
        const req = new Request('http://x/api/cron/notification-email-loop', { method: 'GET' });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 401 on wrong secret', async () => {
        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer wrong' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 200 + zero counts when no pending notifications', async () => {
        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
    });

    it('dispatches email and marks emailed_at on PROFORMA_REMINDER', async () => {
        mocks.pendingRows = [
            {
                id: 'notif-1',
                shipowner_id: 'so-1',
                kind: 'PROFORMA_REMINDER',
                body_params: { invoice_ref: 'INV-1', amount_usd: 100, age_days: 3 },
            },
        ];
        mocks.ownersByShipownerId = {
            'so-1': { official_email: 'owner@test', name: 'AcmeCo' },
        };
        (dispatchNotificationEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });

        expect(dispatchNotificationEmail).toHaveBeenCalledWith({
            kind: 'PROFORMA_REMINDER',
            ownerEmail: 'owner@test',
            ownerName: 'AcmeCo',
            bodyParams: { invoice_ref: 'INV-1', amount_usd: 100, age_days: 3 },
        });

        // emailed_at set with race-guard on emailed_at IS NULL
        const setEmailedAt = mocks.updateCalls.find(
            (c) => typeof c.patch.emailed_at === 'string' && c.where.id === 'notif-1',
        );
        expect(setEmailedAt).toBeDefined();
        expect(setEmailedAt!.guard).toEqual({ emailed_at: null });
    });

    it('skips row when owner has no email on file', async () => {
        mocks.pendingRows = [
            {
                id: 'notif-2',
                shipowner_id: 'so-2',
                kind: 'PROFORMA_REMINDER',
                body_params: { invoice_ref: 'INV-2', amount_usd: 50, age_days: 7 },
            },
        ];
        mocks.ownersByShipownerId = {
            'so-2': { official_email: null, name: 'EmptyCo' },
        };

        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });
        expect(dispatchNotificationEmail).not.toHaveBeenCalled();
    });

    it('skips row at max attempts (5)', async () => {
        mocks.pendingRows = [
            {
                id: 'notif-3',
                shipowner_id: 'so-3',
                kind: 'PROFORMA_REMINDER',
                body_params: { invoice_ref: 'INV-3', amount_usd: 50, age_days: 7, email_attempts: 5 },
            },
        ];
        mocks.ownersByShipownerId = {
            'so-3': { official_email: 'owner@test', name: 'AcmeCo' },
        };

        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });
        expect(dispatchNotificationEmail).not.toHaveBeenCalled();
    });

    it('counts a failed dispatch, increments attempts, no emailed_at', async () => {
        mocks.pendingRows = [
            {
                id: 'notif-4',
                shipowner_id: 'so-4',
                kind: 'PROFORMA_REMINDER',
                body_params: { invoice_ref: 'INV-4', amount_usd: 50, age_days: 3 },
            },
        ];
        mocks.ownersByShipownerId = {
            'so-4': { official_email: 'owner@test', name: 'AcmeCo' },
        };
        (dispatchNotificationEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: false,
            error: 'Resend 5xx',
        });

        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        const json = await res.json();
        expect(json).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });

        // emailed_at must NOT have been set on notif-4
        const setEmailedAt = mocks.updateCalls.find(
            (c) => typeof c.patch.emailed_at === 'string' && c.where.id === 'notif-4',
        );
        expect(setEmailedAt).toBeUndefined();

        // body_params (attempts++) must have been written
        const bumpedAttempts = mocks.updateCalls.find(
            (c) => c.where.id === 'notif-4' && 'body_params' in c.patch,
        );
        expect(bumpedAttempts).toBeDefined();
        const newParams = bumpedAttempts!.patch.body_params as { email_attempts: number };
        expect(newParams.email_attempts).toBe(1);
    });

    it('counts a thrown dispatch as failed (fail-soft)', async () => {
        mocks.pendingRows = [
            {
                id: 'notif-5',
                shipowner_id: 'so-5',
                kind: 'PROFORMA_REMINDER',
                body_params: { invoice_ref: 'INV-5', amount_usd: 50, age_days: 3 },
            },
        ];
        mocks.ownersByShipownerId = {
            'so-5': { official_email: 'owner@test', name: 'AcmeCo' },
        };
        (dispatchNotificationEmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SMTP down'));

        const req = new Request('http://x/api/cron/notification-email-loop', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });
    });
});
