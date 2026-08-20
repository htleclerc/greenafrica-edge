import type { SupabaseClient } from '@supabase/supabase-js';

// La vue n'est pas dans supabase.generated.ts (même patron que collectionAdminService).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export interface Bucket { usd: number; count: number }

export interface ReglementsSummary {
    invoicedToday: Bucket; invoicedWeek: Bucket; invoicedMonth: Bucket;
    collectedToday: Bucket; collectedWeek: Bucket; collectedMonth: Bucket;
    totalOutstandingUsd: number;
    overdueUsd: number;
    overdueCount: number;
}

const ZERO: Bucket = { usd: 0, count: 0 };

/**
 * Agrège les lignes de v_reglements_dashboard visibles par l'appelant.
 * La RLS ne rend que les juridictions autorisées ; un SUPERADMIN multi-pays
 * en voit plusieurs, et le tableau de bord présente leur total.
 */
export async function getReglementsSummary(db: Client): Promise<ReglementsSummary> {
    const { data, error } = await db.from('v_reglements_dashboard').select('*');
    if (error) throw new Error(`getReglementsSummary: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];

    const bucket = (usdKey: string, countKey: string): Bucket => ({
        usd: rows.reduce((s, r) => s + Number(r[usdKey] ?? 0), 0),
        count: rows.reduce((s, r) => s + Number(r[countKey] ?? 0), 0),
    });

    return {
        invoicedToday: rows.length ? bucket('invoiced_today_usd', 'invoiced_today_count') : ZERO,
        invoicedWeek: rows.length ? bucket('invoiced_week_usd', 'invoiced_week_count') : ZERO,
        invoicedMonth: rows.length ? bucket('invoiced_month_usd', 'invoiced_month_count') : ZERO,
        collectedToday: rows.length ? bucket('collected_today_usd', 'collected_today_count') : ZERO,
        collectedWeek: rows.length ? bucket('collected_week_usd', 'collected_week_count') : ZERO,
        collectedMonth: rows.length ? bucket('collected_month_usd', 'collected_month_count') : ZERO,
        totalOutstandingUsd: rows.reduce((s, r) => s + Number(r.total_outstanding_usd ?? 0), 0),
        overdueUsd: rows.reduce((s, r) => s + Number(r.overdue_usd ?? 0), 0),
        overdueCount: rows.reduce((s, r) => s + Number(r.overdue_count ?? 0), 0),
    };
}
