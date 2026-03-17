import type { SupabaseClient } from '@supabase/supabase-js';
import type { DashboardKpis } from '@/types/secure';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

interface TxnPartial { tax_amount_usd: number; created_at: string }
interface VesselPartial { compliance_status: string; estimated_emissions_tco2: number }
interface ProjectPartial { credits_retired_total: number }

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
