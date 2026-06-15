// ─────────────────────────────────────────────────────────────────────────────
// Vision board — aggregation service for MANAGER / ADMIN staff
// ─────────────────────────────────────────────────────────────────────────────
//
// All queries run through the staff RLS client (session-scoped, jurisdiction
// filtered by the existing `gg-active-jurisdiction` cookie at RLS level).
// The service NEVER uses service-role — jurisdiction scope is enforced by RLS.
//
// Amounts: `tax_amount_usd` is stored as raw USD (not cents). We use
// `Number(r.tax_amount_usd ?? 0)` directly, matching ownerPortalService.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';

// Statuses that represent a vessel/aircraft actively approaching the EEZ.
const APPROACHING_STATUSES = [
    'DETECTED',
    'MATCHED_AUTO',
    'UNCLAIMED',
    'CLAIMED',
    'ESCALATED',
    'PROFORMA_SENT',
] as const;

export interface RecentDeparture {
    id: string;
    ref: string | null;
    mode: 'MARITIME' | 'AIR';
    departedAt: string;
}

export interface VisionCounters {
    atPort: number;
    approaching: number;
    recentDepartures: RecentDeparture[];
    paidLast7dCount: number;
    paidLast7dUsd: number;
    unpaidInProgressCount: number;
    unpaidInProgressUsd: number;
}

function sevenDaysAgo(): string {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function sum(rows: { tax_amount_usd: number | string | null }[] | null): number {
    return (rows ?? []).reduce((acc, r) => acc + Number(r.tax_amount_usd ?? 0), 0);
}

/**
 * Aggregate all five vision-board widgets from `arrival_alerts` and
 * `transactions`, optionally scoped to a single transport mode.
 *
 * @param db   Staff SSR Supabase client (RLS-scoped to the active jurisdiction).
 * @param mode 'MARITIME' | 'AIR' → apply `.eq('mode', mode)` on every query.
 *             `null`             → no mode filter (show both).
 */
export async function getVisionCounters(
    db: SupabaseClient,
    { mode }: { mode: 'MARITIME' | 'AIR' | null },
): Promise<VisionCounters> {
    const since7d = sevenDaysAgo();

    // ── arrival_alerts: Au port ──────────────────────────────────────────────
    let atPortQ = db
        .from('arrival_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'ARRIVED');
    if (mode !== null) atPortQ = atPortQ.eq('mode', mode);

    // ── arrival_alerts: En approche ─────────────────────────────────────────
    let approachingQ = db
        .from('arrival_alerts')
        .select('id', { count: 'exact', head: true })
        .in('status', [...APPROACHING_STATUSES]);
    if (mode !== null) approachingQ = approachingQ.eq('mode', mode);

    // ── arrival_alerts: Derniers départs (DEPARTED_EEZ last 7 days) ─────────
    let departuresQ = db
        .from('arrival_alerts')
        .select('id, ref, mode, departed_eez_at')
        .eq('status', 'DEPARTED_EEZ')
        .gte('departed_eez_at', since7d)
        .order('departed_eez_at', { ascending: false })
        .limit(20);
    if (mode !== null) departuresQ = departuresQ.eq('mode', mode);

    // ── transactions: Payées 7j ──────────────────────────────────────────────
    let paidQ = db
        .from('transactions')
        .select('tax_amount_usd')
        .eq('status', 'PAID')
        .gte('paid_at', since7d);
    if (mode !== null) paidQ = paidQ.eq('mode', mode);

    // ── transactions: Impayées en cours ─────────────────────────────────────
    let unpaidQ = db
        .from('transactions')
        .select('tax_amount_usd')
        .eq('status', 'PENDING')
        .in('document_type', ['PROFORMA', 'FINAL']);
    if (mode !== null) unpaidQ = unpaidQ.eq('mode', mode);

    const [atPortRes, approachingRes, departuresRes, paidRes, unpaidRes] =
        await Promise.all([atPortQ, approachingQ, departuresQ, paidQ, unpaidQ]);

    const departures: RecentDeparture[] = (departuresRes.data ?? []).map((r) => ({
        id: r.id as string,
        ref: r.ref as string | null,
        mode: (r.mode as 'MARITIME' | 'AIR') ?? 'MARITIME',
        departedAt: r.departed_eez_at as string,
    }));

    return {
        atPort: atPortRes.count ?? 0,
        approaching: approachingRes.count ?? 0,
        recentDepartures: departures,
        paidLast7dCount: (paidRes.data ?? []).length,
        paidLast7dUsd: sum(paidRes.data),
        unpaidInProgressCount: (unpaidRes.data ?? []).length,
        unpaidInProgressUsd: sum(unpaidRes.data),
    };
}
