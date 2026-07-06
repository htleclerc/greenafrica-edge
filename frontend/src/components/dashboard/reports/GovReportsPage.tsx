'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, Printer } from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { OsButton } from '@/components/ui/OsButton';
import { SettlementExportCard } from './SettlementExportCard';
import { SettlementReportsList } from './SettlementReportsList';
import { useKpis } from '@/hooks/useKpis';
import { useVessels } from '@/hooks/useVessels';
import { VesselComplianceStatus } from '@/types/secure';

// Static chart data — dashboard illustration, replaced by /api/revenue/analytics in V2.
const REVENUE_BY_CATEGORY = [
    { category: 'Container',    revenue: 540_200, vessels: 312 },
    { category: 'Cargo',        revenue: 329_800, vessels: 218 },
    { category: 'Tanker',       revenue: 214_500, vessels: 97  },
    { category: 'Bulk Carrier', revenue: 142_000, vessels: 180 },
    { category: 'Other',        revenue: 14_000,  vessels: 35  },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="os-card p-3 text-xs min-w-[120px]">
            <p className="text-[var(--os-text-muted)] mb-1 font-semibold">{label}</p>
            {payload.map((p) => (
                <div key={p.name} className="flex justify-between gap-4">
                    <span className="text-[var(--os-text-secondary)]">{p.name}</span>
                    <span className="font-bold text-[var(--os-text-primary)]">
                        {p.value > 1000 ? `$${(p.value / 1000).toFixed(0)}K` : p.value}
                    </span>
                </div>
            ))}
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

export function GovReportsPage() {
    const t = useTranslations('GovReportsPage');
    const { data: kpis } = useKpis();
    const { data: vessels } = useVessels();
    const [reportCount, setReportCount] = React.useState(0);

    const complianceBreakdown = React.useMemo(() => [
        { name: 'Compliant',    value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.COMPLIANT).length,    color: '#22C55E' },
        { name: 'Payment Due',  value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE).length,  color: '#F59E0B' },
        { name: 'Processing',   value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PROCESSING).length,   color: '#38BDF8' },
        { name: 'Non-Compliant',value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT).length,color: '#EF4444' },
    ], [vessels]);

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                        {t('subtitle')}
                    </p>
                </div>
                <OsButton variant="secondary" size="sm" icon={<Printer className="w-3.5 h-3.5" />}>
                    {t('print_summary')}
                </OsButton>
            </div>

            {/* Live authority settlement export (L8) — real, downloadable report */}
            <SettlementExportCard />

            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: t('kpi_revenue_ytd'),       value: `$${(kpis.monthlyRevenueUsd * 3 / 1_000_000).toFixed(2)}M`, delta: `+${kpis.monthlyRevenueDelta}%`, color: '#00D97E' },
                    { label: t('kpi_vessels_processed'), value: kpis.vesselsProcessed.toLocaleString(),                      delta: '+8.2%',                              color: '#38BDF8' },
                    { label: t('kpi_co2_tracked'),       value: `${(kpis.estCo2TrackingTons / 1000).toFixed(1)}kt`,         delta: '+15.1%',                             color: '#F59E0B' },
                    { label: t('kpi_reports_generated'), value: reportCount.toString(),                                     delta: t('this_month'),                      color: '#A78BFA' },
                ].map(({ label, value, delta, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums mb-1" style={{ color }}>{value}</p>
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-[#22C55E]">
                            <TrendingUp className="w-3 h-3" />
                            {delta}
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                {/* Revenue by category bar */}
                <div className="xl:col-span-2 os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_revenue_by_category')}</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)] mb-4">{t('chart_revenue_by_category_desc')}</p>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={REVENUE_BY_CATEGORY} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barSize={28}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="category" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="revenue" name="Revenue" fill="#00D97E" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
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

            {/* Real monthly settlement reports (L8) — replaces the former mock catalogue */}
            <SettlementReportsList onCount={setReportCount} />
        </div>
    );
}
