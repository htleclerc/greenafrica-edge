'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { formatMonth } from '@/services/settlementReportService';
import type { MonthlySettlement } from '@/lib/settlement';
import type { SettlementLoadState } from '@/hooks/useSettlementSummary';
import { settlementExportHref } from './SettlementExportCard';

function usd(n: number): string {
    return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Real monthly settlement reports (L8), replacing the former static mock
 * catalogue. Presentational — data comes from useSettlementSummary (shared with
 * the KPIs and chart), one downloadable CSV per month.
 */
export function SettlementReportsList({ months, state }: { months: MonthlySettlement[]; state: SettlementLoadState }) {
    const t = useTranslations('GovReportsPage');

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
