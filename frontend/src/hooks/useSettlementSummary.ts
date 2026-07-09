'use client';

import * as React from 'react';
import type { SettlementRow } from '@/services/settlementReportService';
import {
    groupSettlementByMonth,
    summarizeSettlement,
    type MonthlySettlement,
    type SettlementSummary,
} from '@/lib/settlement';

export type SettlementLoadState = 'loading' | 'ready' | 'error';

export interface UseSettlementSummary {
    months: MonthlySettlement[];
    summary: SettlementSummary;
    state: SettlementLoadState;
}

const EMPTY: SettlementSummary = { monthCount: 0, txCount: 0, totalUsd: 0, concessionaireUsd: 0, sovereignUsd: 0 };

/**
 * Single fetch of the live settlement split (/api/admin/reports/settlement),
 * shared by the reports-page KPIs, the monthly revenue chart and the monthly
 * list — so the admin-gated endpoint is hit once per page load, not three times.
 * The endpoint is rate-limited + admin-gated; a non-admin gets 'error'.
 */
export function useSettlementSummary(): UseSettlementSummary {
    const [months, setMonths] = React.useState<MonthlySettlement[]>([]);
    const [state, setState] = React.useState<SettlementLoadState>('loading');

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/admin/reports/settlement?format=json');
                if (!res.ok) throw new Error(String(res.status));
                const json = await res.json();
                if (cancelled) return;
                setMonths(groupSettlementByMonth((json.rows ?? []) as SettlementRow[]));
                setState('ready');
            } catch {
                if (!cancelled) setState('error');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const summary = React.useMemo(() => (months.length ? summarizeSettlement(months) : EMPTY), [months]);
    return { months, summary, state };
}
