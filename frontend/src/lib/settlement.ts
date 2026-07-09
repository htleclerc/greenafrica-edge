// Client-safe pure aggregation over settlement rows, shared by the reports page
// KPIs, the monthly revenue chart, and the downloadable monthly list. Kept out
// of settlementReportService.ts (server/service-role read path) so client code
// never pulls that in.
import type { SettlementRow } from '@/services/settlementReportService';

export interface MonthlySettlement {
    month: string; // YYYY-MM-01 bucket
    txCount: number;
    totalUsd: number;
    concessionaireUsd: number;
    sovereignUsd: number;
}

export interface SettlementSummary {
    monthCount: number;
    txCount: number;
    totalUsd: number;
    concessionaireUsd: number;
    sovereignUsd: number;
}

/** Collapse per-(jurisdiction, mode) view rows into one row per month, most recent first. */
export function groupSettlementByMonth(rows: SettlementRow[]): MonthlySettlement[] {
    const byMonth = new Map<string, MonthlySettlement>();
    for (const r of rows) {
        const cur = byMonth.get(r.month) ?? {
            month: r.month, txCount: 0, totalUsd: 0, concessionaireUsd: 0, sovereignUsd: 0,
        };
        cur.txCount += Number(r.tx_count ?? 0);
        cur.totalUsd += Number(r.total_usd ?? 0);
        cur.concessionaireUsd += Number(r.concessionaire_usd ?? 0);
        cur.sovereignUsd += Number(r.sovereign_usd ?? 0);
        byMonth.set(r.month, cur);
    }
    return Array.from(byMonth.values()).sort((a, b) => (a.month < b.month ? 1 : -1));
}

/** Totals across all months — powers the reports-page KPI row. */
export function summarizeSettlement(months: MonthlySettlement[]): SettlementSummary {
    return months.reduce<SettlementSummary>(
        (acc, m) => ({
            monthCount: acc.monthCount + 1,
            txCount: acc.txCount + m.txCount,
            totalUsd: acc.totalUsd + m.totalUsd,
            concessionaireUsd: acc.concessionaireUsd + m.concessionaireUsd,
            sovereignUsd: acc.sovereignUsd + m.sovereignUsd,
        }),
        { monthCount: 0, txCount: 0, totalUsd: 0, concessionaireUsd: 0, sovereignUsd: 0 },
    );
}
