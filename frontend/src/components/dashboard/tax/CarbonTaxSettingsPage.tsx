'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Download, Plus, AlertTriangle, Eye, Globe2 } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { useTransactions } from '@/hooks/useTransactions';
import { useExemptions } from '@/hooks/useExemptions';
import { useKpis } from '@/hooks/useKpis';
import {
    TransactionType, TransactionStatus,
} from '@/types/secure';
import { transactionVariant } from '@/lib/badgeUtils';
import { useRole } from '@/lib/RoleContext';
import { canEdit } from '@/lib/rbac';

const TX_TYPE_LABEL: Record<TransactionType, string> = {
    [TransactionType.ENTRY_TAX]:   'Entry Tax',
    [TransactionType.TRANSIT_FEE]: 'Transit Fee',
    [TransactionType.PORT_STAY]:   'Port Stay',
};

const TX_STATUS_LABEL: Record<TransactionStatus, string> = {
    [TransactionStatus.PAID]:     'PAID',
    [TransactionStatus.PENDING]:  'PENDING',
    [TransactionStatus.OVERDUE]:  'OVERDUE',
    [TransactionStatus.EXEMPT]:   'EXEMPT',
    [TransactionStatus.DISPUTED]: 'DISPUTED',
};

export function CarbonTaxSettingsPage() {
    const t = useTranslations('TaxSettingsPage');
    const { role } = useRole();
    const isReadOnly = !canEdit('tax-settings', role);
    const { data: transactions } = useTransactions();
    const { data: exemptions } = useExemptions();
    const { data: kpis } = useKpis();

    const totalRevenueMtd = transactions
        .filter((tx) => tx.status === TransactionStatus.PAID)
        .reduce((s, tx) => s + tx.taxAmountUsd, 0);
    const totalPending = transactions
        .filter((tx) => tx.status === TransactionStatus.PENDING || tx.status === TransactionStatus.OVERDUE)
        .reduce((s, tx) => s + tx.taxAmountUsd, 0);
    const vesselsTaxed = Math.round((transactions.filter(tx => tx.status === TransactionStatus.PAID).length / transactions.length) * 100);

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[rgba(0,217,126,0.1)] text-[#00D97E] border border-[#00D97E]/20">
                            LIVE
                        </span>
                        {isReadOnly && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[rgba(56,189,248,0.1)] text-[#38BDF8] border border-[#38BDF8]/20">
                                <Eye className="w-3 h-3" />
                                READ-ONLY
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                        {t('subtitle')}
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                    <OsButton variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5" />}>
                        {t('export_report')}
                    </OsButton>
                    {!isReadOnly && (
                        <OsButton variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />}>
                            {t('new_regulation')}
                        </OsButton>
                    )}
                </div>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label={t('kpi_total_revenue_mtd')} value={`$${(totalRevenueMtd / 1000).toFixed(1)}K`} sub={t('kpi_collection_status')} color="#00D97E" tag={t('kpi_active')} />
                <KpiCard label={t('kpi_vessels_taxed')}     value={`${vesselsTaxed}%`}            sub={t('kpi_on_target')}           color="#38BDF8" tag={t('kpi_on_track')} />
                <KpiCard label={t('kpi_active_exemptions')}   value={String(exemptions.length)} sub={t('kpi_this_quarter')}         color="#F59E0B" tag={t('kpi_pending', { count: kpis.pendingReviewCount })} />
                <KpiCard label={t('kpi_unpaid_obligations')}  value={`$${(totalPending / 1000).toFixed(1)}K`} sub={t('kpi_overdue_pending')} color="#EF4444" tag={t('kpi_urgent')} />
            </div>

            {/* Body: Moved notice + Right panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="xl:col-span-2 flex flex-col gap-5">
                    {/* Tariff rates moved to /admin/jurisdictions (Wedge 2) */}
                    <div className="os-card p-5 flex items-start gap-4">
                        <Globe2 className="w-5 h-5 text-[#00D97E] flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">
                                {t('tax_rate_moved_title')}
                            </p>
                            <p className="text-xs text-[var(--os-text-muted)] mb-3">
                                {t('tax_rate_moved_desc')}
                            </p>
                            <Link
                                href="/admin/jurisdictions"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#00D97E] hover:underline"
                            >
                                <Globe2 className="w-3.5 h-3.5" />
                                {t('tax_rate_moved_link')}
                            </Link>
                        </div>
                    </div>

                    {/* Transaction Log */}
                    <div className="os-card overflow-hidden">
                        <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('transaction_log')}</h3>
                            <div className="flex items-center gap-2">
                                <select className="h-8 px-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-muted)] focus:outline-none">
                                    <option>{t('filter_all_statuses')}</option>
                                    <option>{t('filter_paid')}</option>
                                    <option>{t('filter_pending')}</option>
                                    <option>{t('filter_overdue')}</option>
                                </select>
                                <OsButton variant="secondary" size="sm" icon={<Download className="w-3 h-3" />}>{t('export_csv')}</OsButton>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                                        {[t('col_transaction_id'), t('col_vessel_name'), t('col_type'), t('col_emissions'), t('col_tax_amount'), t('col_status'), t('col_date')].map((h) => (
                                            <th key={h} className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map((tx) => {
                                        const date = new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                                        return (
                                            <tr key={tx.id} className="border-b border-[var(--os-border)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                                                <td className="px-5 py-3 font-mono text-[10px] text-[var(--os-text-muted)]">{tx.id.toUpperCase()}</td>
                                                <td className="px-5 py-3">
                                                    <p className="text-xs font-semibold text-[var(--os-text-primary)]">{tx.vesselName}</p>
                                                    <p className="text-[10px] text-[var(--os-text-muted)]">IMO {tx.vesselImo}</p>
                                                </td>
                                                <td className="px-5 py-3 text-xs text-[var(--os-text-secondary)]">{TX_TYPE_LABEL[tx.transactionType]}</td>
                                                <td className="px-5 py-3 font-mono text-xs text-[var(--os-text-primary)]">{tx.emissionsTco2}</td>
                                                <td className="px-5 py-3 font-bold text-xs tabular-nums text-[var(--os-text-primary)]">
                                                    ${tx.taxAmountUsd.toLocaleString('en-US')}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <OsBadge variant={transactionVariant(tx.status)} label={TX_STATUS_LABEL[tx.status]} />
                                                </td>
                                                <td className="px-5 py-3 text-xs text-[var(--os-text-muted)]">{date}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="px-5 py-2.5 border-t border-[var(--os-border)] text-[10px] text-[var(--os-text-muted)]">
                                {t('showing_transactions', { from: 1, to: transactions.length, total: transactions.length })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right panel */}
                <div className="flex flex-col gap-4">
                    {/* Critical alerts */}
                    <div className="os-card p-5">
                        <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-3">{t('critical_alerts')}</h3>
                        <div className="flex flex-col gap-2">
                            {transactions
                                .filter((tx) => tx.status === TransactionStatus.OVERDUE)
                                .map((tx) => (
                                    <div key={tx.id} className="p-3 rounded-xl bg-[rgba(239,68,68,0.06)] border border-[#EF4444]/20">
                                        <div className="flex items-center gap-2 mb-1">
                                            <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />
                                            <span className="text-[10px] font-bold text-[#EF4444] uppercase tracking-wide">{t('unpaid_tax_obligation')}</span>
                                        </div>
                                        <p className="text-[11px] text-[var(--os-text-muted)]">{tx.vesselName}</p>
                                        <p className="text-xs font-bold text-[#EF4444] mt-0.5">{t('amount_overdue', { amount: `$${tx.taxAmountUsd.toLocaleString()}` })}</p>
                                        <a href={`/dashboard/invoices?tx=${encodeURIComponent(tx.ref)}`} className="text-[10px] text-[#EF4444] hover:underline font-semibold mt-1 inline-block">
                                            {t('generate_invoice')}
                                        </a>
                                    </div>
                                ))}
                            <div className="p-3 rounded-xl bg-[rgba(245,158,11,0.06)] border border-[#F59E0B]/20">
                                <div className="flex items-center gap-2 mb-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B]" />
                                    <span className="text-[10px] font-bold text-[#F59E0B] uppercase tracking-wide">{t('exemption_anomaly')}</span>
                                </div>
                                <p className="text-[11px] text-[var(--os-text-muted)]">{t('exemption_anomaly_desc')}</p>
                            </div>
                        </div>
                    </div>

                    {/* Exemptions */}
                    <div className="os-card p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('exemptions')}</h3>
                            <span className="text-[10px] font-bold text-[var(--os-text-muted)]">{t('exemptions_active', { count: exemptions.length })}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            {exemptions.map((ex) => (
                                <div key={ex.id} className="flex items-start justify-between p-3 rounded-xl border border-[var(--os-border)] hover:border-[var(--os-border-strong)] transition-colors">
                                    <div>
                                        <p className="text-xs font-semibold text-[var(--os-text-primary)]">{ex.vesselName}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">{ex.reason.replace('_', ' ')}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">Until: {ex.validUntil}</p>
                                    </div>
                                    {!isReadOnly && (
                                        <button className="text-[10px] font-semibold text-[#38BDF8] hover:underline mt-0.5">{t('review')}</button>
                                    )}
                                </div>
                            ))}
                            {!isReadOnly && (
                                <OsButton variant="outline" size="sm" icon={<Plus className="w-3 h-3" />} className="w-full">
                                    {t('request_exemption')}
                                </OsButton>
                            )}
                        </div>
                    </div>

                    {/* Revenue trend mini */}
                    <div className="os-card p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('revenue_trend')}</h3>
                            <a href="/admin/revenue" className="text-[10px] text-[#38BDF8] hover:underline">{t('full_report')}</a>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {[
                                { label: 'Jan 2025', amount: 855_000,   color: '#00D97E' },
                                { label: 'Feb 2025', amount: 1_015_000, color: '#00D97E' },
                                { label: 'Mar 2025', amount: 1_240_500, color: '#00D97E' },
                            ].map(({ label, amount, color }) => {
                                const max = 1_400_000;
                                const pct = (amount / max) * 100;
                                return (
                                    <div key={label}>
                                        <div className="flex justify-between text-[10px] text-[var(--os-text-muted)] mb-0.5">
                                            <span>{label}</span>
                                            <span className="font-semibold text-[var(--os-text-primary)]">${(amount / 1000).toFixed(0)}K</span>
                                        </div>
                                        <div className="w-full h-1.5 rounded-full bg-[var(--os-surface-3)]">
                                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function KpiCard({ label, value, sub, color, tag }: { label: string; value: string; sub: string; color: string; tag?: string }) {
    return (
        <div className="os-card p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
            <p className="text-2xl font-bold tabular-nums mb-0.5" style={{ color }}>{value}</p>
            <div className="flex items-center justify-between">
                <p className="text-[10px] text-[var(--os-text-muted)]">{sub}</p>
                {tag && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${color}14`, color }}>
                        {tag}
                    </span>
                )}
            </div>
        </div>
    );
}
