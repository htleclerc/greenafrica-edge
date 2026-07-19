import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { enforceRateLimit } from '@/lib/rateLimit';
import { createPlatformClient } from '@/lib/supabase/tenant';
import {
    fetchSettlement,
    buildSettlementCsv,
    settlementFilename,
    type SettlementFilters,
} from '@/services/settlementReportService';

/**
 * GET /api/admin/reports/settlement
 *
 * Livrable L8 — rapport mensuel destiné à l'autorité de tutelle.
 * On-demand export of the concessionaire/sovereign revenue split from the
 * `v_revenue_split_settlement` view (mig 086).
 *
 * Auth: SUPERADMIN or FINANCE_ADMIN (requireRole). The view is service-role
 * only, so the read goes through the UNSCOPED platform client AFTER the role
 * gate has passed.
 *
 * Query params (all optional):
 *   from=YYYY-MM-01   inclusive lower bound on the month bucket
 *   to=YYYY-MM-01     inclusive upper bound on the month bucket
 *   jurisdiction=SO   filter to one jurisdiction code
 *   mode=MARITIME     filter to one mode (MARITIME | AVIATION)
 *   format=csv|json   response shape (default csv, downloadable attachment)
 */

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Za-z]{2,8}$/;
const VALID_MODES = new Set(['MARITIME', 'AVIATION']);

function cleanDate(raw: string | null): string | null {
    return raw && DATE_RE.test(raw) ? raw : null;
}

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    // Cap mass export of cross-jurisdiction fiscal data (per-admin).
    const rl = await enforceRateLimit('admin-export', auth.user.id);
    if (!rl.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const url = new URL(req.url);
    const modeRaw = url.searchParams.get('mode');
    const jurRaw = url.searchParams.get('jurisdiction');
    const filters: SettlementFilters = {
        from: cleanDate(url.searchParams.get('from')),
        to: cleanDate(url.searchParams.get('to')),
        jurisdictionCode: jurRaw && CODE_RE.test(jurRaw) ? jurRaw.toUpperCase() : null,
        mode: modeRaw && VALID_MODES.has(modeRaw.toUpperCase()) ? modeRaw.toUpperCase() : null,
    };
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';

    // View is service-role only (REVOKEd from authenticated) → platform client.
    // Legitimately cross-jurisdiction: this is a ministerial roll-up.
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    let rows;
    try {
        rows = await fetchSettlement(admin, filters);
    } catch {
        return NextResponse.json({ error: 'Failed to load settlement data' }, { status: 500 });
    }

    // Audit the export — an authority report leaving the system is a tracked event.
    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'REPORT_EXPORTED',
        severity: 'INFO',
        entity_type: 'SettlementReport',
        entity_id: filters.from ?? 'all',
        details_json: { format, filters, rowCount: rows.length },
    });

    if (format === 'json') {
        return NextResponse.json({ rows, count: rows.length });
    }

    const csv = buildSettlementCsv(rows);
    return new NextResponse(csv, {
        status: 200,
        headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${settlementFilename(filters)}"`,
            'Cache-Control': 'no-store',
        },
    });
}
