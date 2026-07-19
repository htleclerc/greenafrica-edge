import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
    requireResult: null as unknown,
    settlementRows: [] as unknown[],
    fetchError: null as Error | null,
    auditInsert: vi.fn(async () => ({ error: null })),
    rlAllowed: true,
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => mocks.requireResult),
}));

vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: vi.fn(async () => ({ allowed: mocks.rlAllowed, skipped: true })),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => ({
        from: vi.fn(() => ({ insert: mocks.auditInsert })),
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
import { fetchSettlement } from '@/services/settlementReportService';
import { NextResponse } from 'next/server';

const OK_AUTH = {
    user: { id: 'u1', fullName: 'Fin Admin' },
    supabase: {},
    error: null,
};

function makeRow(over: Record<string, unknown> = {}) {
    return {
        jurisdiction_id: 'j1', jurisdiction_code: 'SO', month: '2026-06-01', mode: 'MARITIME',
        tx_count: 2, total_usd: 500, concessionaire_usd: 150, sovereign_usd: 350,
        unattributed_count: 0, unattributed_usd: 0, mismatched_count: 0, mismatched_usd: 0, ...over,
    };
}

describe('GET /api/admin/reports/settlement', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
        mocks.requireResult = OK_AUTH;
        mocks.settlementRows = [makeRow()];
        mocks.fetchError = null;
        mocks.auditInsert = vi.fn(async () => ({ error: null }));
        mocks.rlAllowed = true;
        vi.clearAllMocks();
    });

    it('returns 429 when the admin export rate limit is exceeded', async () => {
        mocks.rlAllowed = false;
        const res = await GET(new Request('http://x/api/admin/reports/settlement') as never);
        expect(res.status).toBe(429);
    });

    it('returns the 403/401 response from requireRole when unauthorized', async () => {
        mocks.requireResult = { user: null, supabase: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
        const res = await GET(new Request('http://x/api/admin/reports/settlement') as never);
        expect(res.status).toBe(403);
    });

    it('returns CSV with a download filename by default', async () => {
        const res = await GET(new Request('http://x/api/admin/reports/settlement') as never);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/csv');
        expect(res.headers.get('Content-Disposition')).toContain('attachment');
        const body = await res.text();
        expect(body.split('\r\n')[0]).toContain('jurisdiction_code');
        expect(body).toContain('SO,2026-06,MARITIME');
    });

    it('returns JSON when format=json', async () => {
        const res = await GET(new Request('http://x/api/admin/reports/settlement?format=json') as never);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        const json = await res.json();
        expect(json.count).toBe(1);
        expect(json.rows).toHaveLength(1);
    });

    it('forwards validated filters to fetchSettlement and ignores garbage', async () => {
        await GET(new Request('http://x/api/admin/reports/settlement?from=2026-06-01&to=2026-06-01&jurisdiction=so&mode=maritime') as never);
        expect(fetchSettlement).toHaveBeenCalledWith(expect.anything(), {
            from: '2026-06-01', to: '2026-06-01', jurisdictionCode: 'SO', mode: 'MARITIME',
        });
    });

    it('drops malformed date/mode/jurisdiction params to null', async () => {
        await GET(new Request('http://x/api/admin/reports/settlement?from=nope&mode=ROCKET&jurisdiction=12') as never);
        expect(fetchSettlement).toHaveBeenCalledWith(expect.anything(), {
            from: null, to: null, jurisdictionCode: null, mode: null,
        });
    });

    it('writes an audit log for the export', async () => {
        await GET(new Request('http://x/api/admin/reports/settlement') as never);
        expect(mocks.auditInsert).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'REPORT_EXPORTED', entity_type: 'SettlementReport', user_id: 'u1' }),
        );
    });

    it('returns 500 when the data load fails', async () => {
        mocks.fetchError = new Error('db down');
        const res = await GET(new Request('http://x/api/admin/reports/settlement') as never);
        expect(res.status).toBe(500);
    });
});
