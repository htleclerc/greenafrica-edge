import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    precomputeResult: {
        enabled: true,
        dryRun: false,
        scanned: 3,
        generated: 3,
        skipped: 0,
        failed: [] as Array<{ alertId: string; reason: string }>,
    },
    runDailyPrecomputeCalled: false,
    runDailyPrecomputeOpts: null as Record<string, unknown> | null,
}));

vi.mock('@/services/dailyPrecomputeService', () => ({
    runDailyPrecompute: vi.fn(async (opts: Record<string, unknown>) => {
        mocks.runDailyPrecomputeCalled = true;
        mocks.runDailyPrecomputeOpts = opts;
        return mocks.precomputeResult;
    }),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => ({ __mockClient: true })),
}));

import { GET } from './route';
import { runDailyPrecompute } from '@/services/dailyPrecomputeService';

describe('GET /api/cron/daily-precompute', () => {
    beforeEach(() => {
        process.env.CRON_SECRET = 'testsecret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
        process.env.AFRICGREEN_API_URL = 'http://localhost:8080';
        process.env.AFRICGREEN_API_SECRET = 'api-secret';
        mocks.runDailyPrecomputeCalled = false;
        mocks.runDailyPrecomputeOpts = null;
        mocks.precomputeResult = {
            enabled: true,
            dryRun: false,
            scanned: 3,
            generated: 3,
            skipped: 0,
            failed: [],
        };
        vi.clearAllMocks();
    });

    // (a) No Authorization header → 401
    it('returns 401 when Authorization header is missing', async () => {
        const req = new Request('http://x/api/cron/daily-precompute', { method: 'GET' });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    // (b) CRON_SECRET not set → 401 (never "Bearer undefined" bypass)
    it('returns 401 when CRON_SECRET env is not set', async () => {
        delete process.env.CRON_SECRET;
        const req = new Request('http://x/api/cron/daily-precompute', {
            method: 'GET',
            headers: { Authorization: 'Bearer undefined' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    it('returns 401 on wrong secret', async () => {
        const req = new Request('http://x/api/cron/daily-precompute', {
            method: 'GET',
            headers: { Authorization: 'Bearer wrongsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(401);
    });

    // (c) Bearer valid + flag OFF → 200 {enabled:false}
    it('returns 200 with enabled:false when flag is OFF', async () => {
        mocks.precomputeResult = {
            enabled: false,
            dryRun: false,
            scanned: 0,
            generated: 0,
            skipped: 0,
            failed: [],
        };
        const req = new Request('http://x/api/cron/daily-precompute', {
            method: 'GET',
            headers: { Authorization: 'Bearer testsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toMatchObject({ success: true, enabled: false });
    });

    // (d) Bearer valid + ?dryRun=1 → service called with dryRun:true
    it('passes dryRun:true to service when ?dryRun=1', async () => {
        mocks.precomputeResult = {
            enabled: true,
            dryRun: true,
            scanned: 5,
            generated: 0,
            skipped: 0,
            failed: [],
        };
        const req = new Request('http://x/api/cron/daily-precompute?dryRun=1', {
            method: 'GET',
            headers: { Authorization: 'Bearer testsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        expect(runDailyPrecompute).toHaveBeenCalledWith(
            expect.objectContaining({ dryRun: true }),
        );
    });

    // (e) Bearer valid → 200 with full service result
    it('returns 200 with full result spread when flag is ON', async () => {
        const req = new Request('http://x/api/cron/daily-precompute', {
            method: 'GET',
            headers: { Authorization: 'Bearer testsecret' },
        });
        const res = await GET(req as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toMatchObject({
            success: true,
            enabled: true,
            scanned: 3,
            generated: 3,
            skipped: 0,
        });
    });

    it('does not pass dryRun when query param is absent', async () => {
        const req = new Request('http://x/api/cron/daily-precompute', {
            method: 'GET',
            headers: { Authorization: 'Bearer testsecret' },
        });
        await GET(req as never);
        expect(runDailyPrecompute).toHaveBeenCalledWith(
            expect.objectContaining({ dryRun: false }),
        );
    });
});
