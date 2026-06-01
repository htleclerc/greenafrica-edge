import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/services/stripeService', () => ({
    retrievePaymentIntent: vi.fn(),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => ({
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        lt: vi.fn(() => ({
                            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                        })),
                    })),
                })),
            })),
            update: vi.fn(() => ({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
        })),
    })),
}));

describe('GET /api/cron/stripe-reconcile-pending', () => {
    beforeEach(() => {
        process.env.CRON_SECRET = 'topsecret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
    });

    it('returns 401 without CRON_SECRET', async () => {
        const req = new Request('http://x/api/cron/stripe-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer wrong-secret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 401 when authorization header missing', async () => {
        const req = new Request('http://x/api/cron/stripe-reconcile-pending', {
            method: 'GET',
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 200 + empty results when no pending payments', async () => {
        const req = new Request('http://x/api/cron/stripe-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toEqual({ reconciled: 0, results: [] });
    });
});
