import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    settlementRows: [] as unknown[],
    fetchError: null as Error | null,
    uploadError: null as { message: string } | null,
    auditInsert: vi.fn(async () => ({ error: null })),
    upload: vi.fn(async () => ({ error: null as { message: string } | null })),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => ({
        from: vi.fn(() => ({ insert: mocks.auditInsert })),
        storage: { from: vi.fn(() => ({ upload: mocks.upload })) },
    })),
}));

vi.mock('@/services/settlementReportService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/settlementReportService')>();
    return {
        ...actual,
        fetchSettlement: vi.fn(async () => {
            if (mocks.fetchError) throw mocks.fetchError;
            return mocks.settlementRows;
        }),
    };
});

import { GET } from './route';

function makeRow() {
    return {
        jurisdiction_id: 'j1', jurisdiction_code: 'SO', month: '2026-06-01', mode: 'MARITIME',
        tx_count: 2, total_usd: 500, concessionaire_usd: 150, sovereign_usd: 350,
        unattributed_count: 0, unattributed_usd: 0, mismatched_count: 0, mismatched_usd: 0,
    };
}

describe('GET /api/cron/monthly-settlement-export', () => {
    beforeEach(() => {
        process.env.CRON_SECRET = 'testsecret';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
        mocks.settlementRows = [makeRow()];
        mocks.fetchError = null;
        mocks.upload = vi.fn(async () => ({ error: null }));
        mocks.auditInsert = vi.fn(async () => ({ error: null }));
        vi.clearAllMocks();
    });

    it('returns 401 without the cron secret', async () => {
        const res = await GET(new Request('http://x/api/cron/monthly-settlement-export') as never);
        expect(res.status).toBe(401);
    });

    it('returns 401 when CRON_SECRET env is unset (no Bearer undefined bypass)', async () => {
        delete process.env.CRON_SECRET;
        const res = await GET(new Request('http://x/api/cron/monthly-settlement-export', {
            headers: { Authorization: 'Bearer undefined' },
        }) as never);
        expect(res.status).toBe(401);
    });

    it('dryRun computes the report without uploading', async () => {
        const res = await GET(new Request('http://x/api/cron/monthly-settlement-export?dryRun=1', {
            headers: { Authorization: 'Bearer testsecret' },
        }) as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json).toMatchObject({ success: true, dryRun: true, rowCount: 1 });
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it('uploads the CSV and writes an audit log on a real run', async () => {
        const res = await GET(new Request('http://x/api/cron/monthly-settlement-export', {
            headers: { Authorization: 'Bearer testsecret' },
        }) as never);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.storedPath).toMatch(/settlement-reports\/\d{4}-\d{2}\.csv/);
        expect(mocks.upload).toHaveBeenCalledOnce();
        expect(mocks.auditInsert).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'REPORT_EXPORTED', entity_type: 'SettlementReport' }),
        );
    });

    it('returns 500 when the archive upload fails', async () => {
        mocks.upload = vi.fn(async () => ({ error: { message: 'no bucket' } }));
        const res = await GET(new Request('http://x/api/cron/monthly-settlement-export', {
            headers: { Authorization: 'Bearer testsecret' },
        }) as never);
        expect(res.status).toBe(500);
    });
});
