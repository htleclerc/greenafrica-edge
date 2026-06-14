import { NextRequest, NextResponse } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { runDailyPrecompute } from '@/services/dailyPrecomputeService';

/**
 * GET /api/cron/daily-precompute
 *
 * Daily Vercel Cron (05:00 UTC via vercel.json) that scans arrival_alerts with
 * status IN (MATCHED_AUTO, CLAIMED, ESCALATED) and proforma_transaction_id IS NULL,
 * scoped to jurisdictions/modes currently active, and calls the proforma pipeline
 * for each — idempotently. Delivered DISABLED by default: the flag
 * `feature.daily_precompute_enabled` in app_config must be set to TRUE to activate.
 *
 * Query param `?dryRun=1`: reports `scanned` count without triggering any pipeline.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Everything else
 * returns 401. Same convention as overdue-alerts/route.ts.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    // Guard against unset CRON_SECRET: if env is undefined the literal string
    // "Bearer undefined" would trivially match — reject immediately.
    const expected = process.env.CRON_SECRET;
    const authHeader = request.headers.get('Authorization');
    if (!expected || authHeader !== `Bearer ${expected}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = new URL(request.url).searchParams.get('dryRun') === '1';
    const admin = createPlatformClient();

    const result = await runDailyPrecompute({
        admin,
        taxApiUrl: process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080',
        taxApiSecret:
            process.env.AFRICGREEN_API_SECRET ??
            process.env.AIS_INGEST_SECRET ??
            process.env.API_SECRET,
        dryRun,
    });

    return NextResponse.json({ success: true, ...result });
}
