// ─────────────────────────────────────────────────────────────────────────────
// Settlement report service (Livrable L8 — rapport mensuel autorité de tutelle)
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads the read-only aggregate view `v_revenue_split_settlement` (mig 086) and
// turns it into an authority-facing export (CSV). The view is GRANTed to
// service_role only and REVOKEd from anon/authenticated, so every read here must
// go through the UNSCOPED platform client (createPlatformClient) — the calling
// route is responsible for gating access with requireRole([SUPERADMIN,
// FINANCE_ADMIN]) before invoking these helpers.
//
// The view groups PAID transactions by (jurisdiction, month, mode) with the
// concessionaire/sovereign split and the audit buckets (unattributed,
// mismatched). Reconciliation identity (NULLs treated as 0):
//   total_usd = concessionaire_usd + sovereign_usd + unattributed_usd + mismatched_usd
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';

/** One row of the settlement view — (jurisdiction, month, mode) grain. */
export interface SettlementRow {
    jurisdiction_id: string;
    jurisdiction_code: string;
    /** First day of the month bucket, ISO date `YYYY-MM-DD`. */
    month: string;
    mode: string;
    tx_count: number;
    total_usd: number | null;
    concessionaire_usd: number | null;
    sovereign_usd: number | null;
    unattributed_count: number;
    unattributed_usd: number | null;
    mismatched_count: number;
    mismatched_usd: number | null;
}

export interface SettlementFilters {
    /** Inclusive lower bound on the month bucket (`YYYY-MM-01`). */
    from?: string | null;
    /** Inclusive upper bound on the month bucket (`YYYY-MM-01`). */
    to?: string | null;
    /** Filter to a single jurisdiction by code (e.g. `SO`, `DJ`). */
    jurisdictionCode?: string | null;
    /** Filter to a single mode (`MARITIME` | `AVIATION`). */
    mode?: string | null;
}

const VIEW = 'v_revenue_split_settlement';

/**
 * Fetch settlement rows from the view, newest month first. `admin` MUST be a
 * service-role client (createPlatformClient) because the view is service-role
 * only. Throws on a query error so the caller can map it to a 500.
 */
export async function fetchSettlement(
    admin: SupabaseClient,
    filters: SettlementFilters = {},
): Promise<SettlementRow[]> {
    let query = admin
        .from(VIEW)
        .select('*')
        .order('month', { ascending: false })
        .order('jurisdiction_code', { ascending: true })
        .order('mode', { ascending: true });

    if (filters.from) query = query.gte('month', filters.from);
    if (filters.to) query = query.lte('month', filters.to);
    if (filters.jurisdictionCode) query = query.eq('jurisdiction_code', filters.jurisdictionCode);
    if (filters.mode) query = query.eq('mode', filters.mode);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as SettlementRow[];
}

// ── CSV export ────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
    'jurisdiction_code',
    'month',
    'mode',
    'tx_count',
    'total_usd',
    'concessionaire_usd',
    'sovereign_usd',
    'unattributed_count',
    'unattributed_usd',
    'mismatched_count',
    'mismatched_usd',
] as const;

/** RFC-4180 field escaping: quote when the value holds a comma, quote or newline. */
function csvEscape(value: string): string {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

/** Money fields: 2 decimals, NULL treated as 0 (matches the view's reconciliation identity). */
function money(value: number | null | undefined): string {
    return (Number(value ?? 0)).toFixed(2);
}

/** Count fields: integer, NULL treated as 0. */
function count(value: number | null | undefined): string {
    return String(Math.trunc(Number(value ?? 0)));
}

/** Month bucket rendered as `YYYY-MM` for a human-facing report. */
export function formatMonth(isoDate: string): string {
    return isoDate.slice(0, 7);
}

/**
 * Build the authority CSV from settlement rows. Pure and deterministic so it can
 * be unit-tested and reused by both the on-demand export route and the monthly
 * cron. Uses CRLF line endings for spreadsheet compatibility.
 */
export function buildSettlementCsv(rows: SettlementRow[]): string {
    const lines: string[] = [CSV_HEADERS.join(',')];
    for (const r of rows) {
        lines.push([
            csvEscape(r.jurisdiction_code ?? ''),
            csvEscape(formatMonth(r.month)),
            csvEscape(r.mode ?? ''),
            count(r.tx_count),
            money(r.total_usd),
            money(r.concessionaire_usd),
            money(r.sovereign_usd),
            count(r.unattributed_count),
            money(r.unattributed_usd),
            count(r.mismatched_count),
            money(r.mismatched_usd),
        ].join(','));
    }
    return lines.join('\r\n');
}

/**
 * First day of the previous calendar month (UTC), as `YYYY-MM-01`. Matches the
 * view's `date_trunc('month', …)::date` bucket key, so it is usable as both the
 * `from` and `to` filter for a single-month report. Used by the monthly cron.
 */
export function previousMonthBucket(now: Date): string {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based; previous month = month - 1
    const prev = new Date(Date.UTC(year, month - 1, 1));
    const yyyy = prev.getUTCFullYear();
    const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}-01`;
}

/** A stable, human-readable filename for a settlement export. */
export function settlementFilename(filters: SettlementFilters): string {
    const scope = filters.jurisdictionCode ? `-${filters.jurisdictionCode}` : '';
    const period = filters.from ? `-${formatMonth(filters.from)}` : '';
    return `greengate-settlement${scope}${period}.csv`;
}

/**
 * Persist a settlement CSV to the private `documents` bucket under
 * `settlement-reports/<YYYY-MM>.csv`. Returns the storage path on success or
 * throws on upload failure. Used by the monthly cron to leave a durable,
 * timestamped artifact of each ministerial report. `admin` must be a
 * service-role client.
 */
export async function storeSettlementCsv(
    admin: SupabaseClient,
    monthBucket: string,
    csv: string,
): Promise<string> {
    const path = `settlement-reports/${formatMonth(monthBucket)}.csv`;
    const { error } = await admin.storage.from('documents').upload(path, csv, {
        contentType: 'text/csv; charset=utf-8',
        upsert: true,
    });
    if (error) throw new Error(error.message);
    return path;
}
