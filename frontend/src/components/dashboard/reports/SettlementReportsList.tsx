'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import type { SettlementRow } from '@/services/settlementReportService';
import { formatMonth } from '@/services/settlementReportService';
import { settlementExportHref } from './SettlementExportCard';

// ── Pure aggregation (unit-tested) ────────────────────────────────────────────

export interface MonthlySettlement {
    month: string; // YYYY-MM-01 bucket
    txCount: number;
    totalUsd: number;
    concessionaireUsd: number;
    sovereignUsd: number;
}

/** Collapse the per-(jurisdiction, mode) view rows into one row per month, most recent first. */
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

function usd(n: number): string {
    return '$' + Math.round(n).toLocaleString('en-US');
}

// ── Component ─────────────────────────────────────────────────────────────────

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Real monthly settlement reports, replacing the former static mock catalogue.
 * Fetches the live split from /api/admin/reports/settlement (JSON), one
 * downloadable CSV per month. The endpoint is admin-gated + rate-limited, so a
 * non-admin who reaches this gets an error state, not data.
 */
export function SettlementReportsList({ onCount }: { onCount?: (n: number) => void }) {
    const t = useTranslations('GovReportsPage');
    const [state, setState] = React.useState<LoadState>('loading');
    const [months, setMonths] = React.useState<MonthlySettlement[]>([]);

    // Keep the latest callback without making it an effect dependency (an inline
    // parent callback would otherwise re-trigger the fetch on every render).
    const onCountRef = React.useRef(onCount);
    onCountRef.current = onCount;

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/admin/reports/settlement?format=json');
                if (!res.ok) throw new Error(String(res.status));
                const json = await res.json();
                const grouped = groupSettlementByMonth((json.rows ?? []) as SettlementRow[]);
                if (cancelled) return;
                setMonths(grouped);
                setState('ready');
                onCountRef.current?.(grouped.length);
            } catch {
                if (!cancelled) setState('error');
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return (
        <div className="os-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--os-border)]">
                <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('settlement_list_title')}</h3>
                <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{t('settlement_list_desc')}</p>
            </div>

            {state === 'loading' && (
                <p className="px-5 py-6 text-xs text-[var(--os-text-muted)] italic">{t('settlement_list_loading')}</p>
            )}
            {state === 'error' && (
                <p className="px-5 py-6 text-xs text-[#EF4444]">{t('settlement_list_error')}</p>
            )}
            {state === 'ready' && months.length === 0 && (
                <p className="px-5 py-6 text-xs text-[var(--os-text-muted)] italic">{t('settlement_list_empty')}</p>
            )}

            {state === 'ready' && months.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] text-left">
                                <th className="px-5 py-2 font-bold">{t('settlement_col_month')}</th>
                                <th className="px-3 py-2 font-bold text-right">{t('settlement_col_tx')}</th>
                                <th className="px-3 py-2 font-bold text-right">{t('settlement_col_total')}</th>
                                <th className="px-3 py-2 font-bold text-right">{t('settlement_col_concessionaire')}</th>
                                <th className="px-3 py-2 font-bold text-right">{t('settlement_col_sovereign')}</th>
                                <th className="px-5 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--os-border)]">
                            {months.map((m) => (
                                <tr key={m.month} className="hover:bg-[var(--os-surface-2)] transition-colors">
                                    <td className="px-5 py-3 font-semibold text-[var(--os-text-primary)] tabular-nums">{formatMonth(m.month)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-secondary)]">{m.txCount}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-primary)]">{usd(m.totalUsd)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-secondary)]">{usd(m.concessionaireUsd)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-secondary)]">{usd(m.sovereignUsd)}</td>
                                    <td className="px-5 py-3 text-right">
                                        <a
                                            href={settlementExportHref(m.month)}
                                            download
                                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[10px] font-semibold text-[#00D97E] hover:bg-[rgba(0,217,126,0.12)] transition-colors"
                                        >
                                            <Download className="w-3 h-3" />
                                            {t('settlement_download_csv')}
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
