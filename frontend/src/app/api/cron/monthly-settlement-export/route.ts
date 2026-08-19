import { NextRequest, NextResponse } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import {
    fetchSettlement,
    buildSettlementCsv,
    storeSettlementCsv,
    previousMonthBucket,
} from '@/services/settlementReportService';

/**
 * GET /api/cron/monthly-settlement-export
 *
 * Livrable L8 — génération automatique du rapport mensuel autorité de tutelle.
 * On the 1st of each month, computes the previous month's concessionaire/
 * sovereign settlement (view v_revenue_split_settlement), builds the CSV and
 * archives it to the private `documents` bucket under
 * `settlement-reports/<YYYY-MM>.csv`. The on-demand endpoint
 * (/api/admin/reports/settlement) serves live exports; this cron guarantees a
 * durable, timestamped monthly artifact even if no one downloads it.
 *
 * Auth: `CRON_SECRET` Bearer token (Vercel Cron adds it automatically).
 *
 * Preview without writing: GET ...?dryRun=1
 *
 * Vercel cron (vercel.json): { "path": "/api/cron/monthly-settlement-export", "schedule": "0 6 1 * *" }
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get('Authorization');
    const expected = process.env.CRON_SECRET;
    if (!expected || authHeader !== `Bearer ${expected}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const month = previousMonthBucket(new Date());

    let rows;
    try {
        rows = await fetchSettlement(admin, { from: month, to: month });
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }

    const csv = buildSettlementCsv(rows);

    if (dryRun) {
        return NextResponse.json({ success: true, dryRun: true, month, rowCount: rows.length, bytes: csv.length });
    }

    let storedPath: string;
    try {
        storedPath = await storeSettlementCsv(admin, month, csv);
    } catch (e) {
        return NextResponse.json({ error: `Archive failed: ${(e as Error).message}` }, { status: 500 });
    }

    await admin.from('audit_logs').insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        user_full_name: 'System Cron',
        action: 'REPORT_EXPORTED',
        severity: 'INFO',
        entity_type: 'SettlementReport',
        entity_id: month,
        jurisdiction_id: null, // cross-juridiction (roll-up) — pas de juridiction unique
        details_json: { month, rowCount: rows.length, storedPath, source: 'monthly-cron' },
    });

    return NextResponse.json({ success: true, month, rowCount: rows.length, storedPath });
}
