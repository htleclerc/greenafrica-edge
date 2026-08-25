'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Printer } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { OsButton } from '@/components/ui/OsButton';
import { SettlementExportCard } from './SettlementExportCard';
import { SettlementReportsList } from './SettlementReportsList';
import { useSettlementSummary } from '@/hooks/useSettlementSummary';
import { formatMonth } from '@/services/settlementReportService';
import { useVessels } from '@/hooks/useVessels';
import { VesselComplianceStatus } from '@/types/secure';

function usd(n: number): string {
    return '$' + Math.round(n).toLocaleString('en-US');
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="os-card p-3 text-xs min-w-[120px]">
            <p className="text-[var(--os-text-muted)] mb-1 font-semibold">{label}</p>
            {payload.map((p) => (
                <div key={p.name} className="flex justify-between gap-4">
                    <span className="text-[var(--os-text-secondary)]">{p.name}</span>
                    <span className="font-bold text-[var(--os-text-primary)]">
                        {p.value > 1000 ? `$${(p.value / 1000).toFixed(0)}K` : `$${p.value}`}
                    </span>
                </div>
            ))}
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

export function GovReportsPage() {
    const t = useTranslations('GovReportsPage');
    const { months, summary, state } = useSettlementSummary();
    const { data: vessels } = useVessels();
    const ready = state === 'ready';

    const complianceBreakdown = React.useMemo(() => [
        { name: 'Compliant',    value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.COMPLIANT).length,    color: '#22C55E' },
        { name: 'Payment Due',  value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE).length,  color: '#F59E0B' },
        { name: 'Processing',   value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PROCESSING).length,   color: '#38BDF8' },
        { name: 'Non-Compliant',value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT).length,color: '#EF4444' },
    ], [vessels]);

    // Chronological (oldest→newest) for the time-series x-axis.
    const revenueByMonth = React.useMemo(
        () => [...months].reverse().map((m) => ({ month: formatMonth(m.month), revenue: Math.round(m.totalUsd) })),
        [months],
    );

    const kpiCards = [
        { label: t('kpi_total_revenue'),       value: ready ? usd(summary.totalUsd) : '—',                    color: '#00D97E' },
        { label: t('kpi_concessionaire_share'),value: ready ? usd(summary.concessionaireUsd) : '—',           color: '#38BDF8' },
        { label: t('kpi_sovereign_share'),     value: ready ? usd(summary.sovereignUsd) : '—',                color: '#A78BFA' },
        { label: t('kpi_transactions'),        value: ready ? summary.txCount.toLocaleString() : '—',         color: '#F59E0B' },
    ];

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{t('subtitle')}</p>
                </div>
                <OsButton variant="secondary" size="sm" icon={<Printer className="w-3.5 h-3.5" />}>
                    {t('print_summary')}
                </OsButton>
            </div>

            {/* Live authority settlement export (L8) */}
            <SettlementExportCard />

            {/* KPI row — real settlement figures */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kpiCards.map(({ label, value, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                {/* Revenue by month (real) */}
                <div className="xl:col-span-2 os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_revenue_by_month')}</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)] mb-4">{t('chart_revenue_by_month_desc')}</p>
                    {ready && revenueByMonth.length > 0 ? (
                        <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={revenueByMonth} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barSize={28}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="month" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--os-text-muted)', fillOpacity: 0.08 }} />
                                <Bar dataKey="revenue" name="Revenue" fill="#00D97E" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="py-10 text-xs text-[var(--os-text-muted)] italic text-center">
                            {state === 'error' ? t('settlement_list_error') : ready ? t('settlement_list_empty') : t('settlement_list_loading')}
                        </p>
                    )}
                </div>

                {/* Compliance donut */}
                <div className="os-card p-5 flex flex-col">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_compliance_overview')}</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)] mb-3">{t('chart_compliance_overview_desc')}</p>
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <ResponsiveContainer width={140} height={140}>
                            <PieChart>
                                <Pie
                                    data={complianceBreakdown}
                                    cx={65} cy={65}
                                    innerRadius={42} outerRadius={60}
                                    startAngle={90} endAngle={-270}
                                    dataKey="value"
                                    strokeWidth={0}
                                >
                                    {complianceBreakdown.map((d, i) => (
                                        <Cell key={i} fill={d.color} fillOpacity={0.9} />
                                    ))}
                                </Pie>
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 w-full">
                            {complianceBreakdown.map((d) => (
                                <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                                    <span className="text-[var(--os-text-muted)] truncate">{d.name}</span>
                                    <span className="font-bold ml-auto" style={{ color: d.color }}>{d.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Real monthly settlement reports (L8) */}
            <SettlementReportsList months={months} state={state} />
        </div>
    );
}
