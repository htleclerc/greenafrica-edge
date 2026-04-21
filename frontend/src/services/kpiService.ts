import type { SupabaseClient } from '@supabase/supabase-js';
import type { DashboardKpis, ArmateurKpis } from '@/types/secure';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

interface TxnPartial { tax_amount_usd: number; created_at: string; status?: string }
interface VesselPartial { compliance_status: string; estimated_emissions_tco2: number }
interface ProjectPartial { credits_retired_total: number }

// OVERDUE_DAYS mirrors the NET-30 convention used in the PR-2 design doc and
// in NextPaymentCard. A tx is "overdue" when created_at + 30 days < now AND
// status is still PENDING. When PR-2 lands with a stored due_date + collections_
// status, this constant moves into the schema and this client-side math goes away.
const OVERDUE_DAYS = 30;

/**
 * Compute dashboard KPIs from real data.
 * Aggregates vessel, transaction, and project tables.
 */
export async function getDashboardKpis(client: Client): Promise<DashboardKpis> {
    const [
        { count: totalVessels },
        { data: transactions },
        { data: vessels },
        { data: projects },
        { data: latestPosition },
    ] = await Promise.all([
        client.from('vessels').select('*', { count: 'exact', head: true }),
        client.from('transactions').select('tax_amount_usd, created_at'),
        client.from('vessels').select('compliance_status, estimated_emissions_tco2'),
        client.from('carbon_projects').select('credits_retired_total'),
        client.from('vessel_positions').select('recorded_at').order('recorded_at', { ascending: false }).limit(1),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const txns = (transactions ?? []) as TxnPartial[];
    const monthlyTxns = txns.filter((t) => t.created_at >= monthStart);
    const monthlyRevenueUsd = monthlyTxns.reduce((sum, t) => sum + Number(t.tax_amount_usd), 0);

    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const prevMonthTxns = txns.filter((t) => t.created_at >= prevMonthStart && t.created_at < monthStart);
    const prevMonthRevenue = prevMonthTxns.reduce((sum, t) => sum + Number(t.tax_amount_usd), 0);
    const monthlyRevenueDelta = prevMonthRevenue > 0
        ? ((monthlyRevenueUsd - prevMonthRevenue) / prevMonthRevenue) * 100
        : 0;

    const vesselList = (vessels ?? []) as VesselPartial[];
    const activeVesselsInEez = vesselList.filter((v) => v.compliance_status !== 'EXEMPT').length;
    const pendingReviewCount = vesselList.filter(
        (v) => v.compliance_status === 'PROCESSING' || v.compliance_status === 'APPROACHING',
    ).length;
    const nonCompliantCount = vesselList.filter((v) => v.compliance_status === 'NON_COMPLIANT').length;
    const estCo2TrackingTons = vesselList.reduce((sum, v) => sum + Number(v.estimated_emissions_tco2), 0);

    const creditsRetiredTons = ((projects ?? []) as ProjectPartial[]).reduce(
        (sum, p) => sum + Number(p.credits_retired_total), 0,
    );

    const posArray = (latestPosition ?? []) as { recorded_at: string }[];

    return {
        monthlyRevenueUsd,
        monthlyRevenueDelta: Math.round(monthlyRevenueDelta * 10) / 10,
        vesselsProcessed: totalVessels ?? 0,
        estCo2TrackingTons,
        creditsRetiredTons,
        activeVesselsInEez,
        pendingReviewCount,
        nonCompliantCount,
        systemStatus: 'ONLINE',
        lastAisSyncUtc: posArray[0]?.recorded_at ?? new Date().toISOString(),
    };
}

/**
 * Armateur dashboard KPIs. The SSR-scoped Supabase client enforces RLS:
 * a SHIPPING_AGENT caller only sees rows where vessel.owner_id = auth.uid(),
 * so the raw SELECTs below are already owner-scoped at the DB. No explicit
 * .eq('owner_id', userId) needed.
 *
 * Returns 4 fields:
 *   outstandingTotalUsd — sum of tax_amount_usd on PENDING tx (current debt)
 *   vesselsActive      — count of vessels not in EXEMPT status
 *   taxPaidYtdUsd      — YTD settlement total (status=PAID, created_at ≥ Jan 1)
 *   overdueCount       — count of tx where status=PENDING AND created_at + 30d < now
 */
export async function getArmateurKpis(client: Client): Promise<ArmateurKpis> {
    const [{ data: transactions }, { data: vessels }] = await Promise.all([
        client.from('transactions').select('tax_amount_usd, created_at, status'),
        client.from('vessels').select('compliance_status'),
    ]);

    const txns = (transactions ?? []) as TxnPartial[];
    const vesselList = (vessels ?? []) as VesselPartial[];

    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
    const overdueThreshold = new Date(now.getTime() - OVERDUE_DAYS * 86400000).toISOString();

    const outstandingTotalUsd = txns
        .filter((t) => t.status === 'PENDING')
        .reduce((sum, t) => sum + Number(t.tax_amount_usd), 0);

    const taxPaidYtdUsd = txns
        .filter((t) => t.status === 'PAID' && t.created_at >= yearStart)
        .reduce((sum, t) => sum + Number(t.tax_amount_usd), 0);

    const overdueCount = txns.filter(
        (t) => t.status === 'PENDING' && t.created_at < overdueThreshold,
    ).length;

    const vesselsActive = vesselList.filter((v) => v.compliance_status !== 'EXEMPT').length;

    return {
        outstandingTotalUsd,
        vesselsActive,
        taxPaidYtdUsd,
        overdueCount,
    };
}
