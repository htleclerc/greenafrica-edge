'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Download, FileText, BarChart2, Leaf, Shield,
    CheckCircle, Clock, AlertTriangle, TrendingUp,
    Calendar, ChevronRight, Printer,
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { OsButton } from '@/components/ui/OsButton';
import { useKpis } from '@/hooks/useKpis';

// Static chart data — will be replaced by /api/revenue/analytics in V2
const REVENUE_BY_CATEGORY = [
    { category: 'Container',    revenue: 540_200, vessels: 312 },
    { category: 'Cargo',        revenue: 329_800, vessels: 218 },
    { category: 'Tanker',       revenue: 214_500, vessels: 97  },
    { category: 'Bulk Carrier', revenue: 142_000, vessels: 180 },
    { category: 'Other',        revenue: 14_000,  vessels: 35  },
];
import { useVessels } from '@/hooks/useVessels';
import { VesselComplianceStatus } from '@/types/secure';

// ── Static report catalogue ───────────────────────────────────────────────────

interface ReportItem {
    id: string;
    title: string;
    description: string;
    type: 'Revenue' | 'Compliance' | 'Environmental' | 'Audit';
    period: string;
    generatedAt: string;
    status: 'ready' | 'processing' | 'scheduled';
    fileSizeKb: number;
}

const REPORT_CATALOG: ReportItem[] = [
    {
        id: 'rpt-001',
        title: 'Monthly Revenue Summary — March 2025',
        description: 'Aggregated carbon tax revenue by vessel category, port, and jurisdiction zone.',
        type: 'Revenue',
        period: 'March 2025',
        generatedAt: '2025-03-09T10:00:00Z',
        status: 'ready',
        fileSizeKb: 248,
    },
    {
        id: 'rpt-002',
        title: 'Vessel Compliance Report — Q1 2025',
        description: 'Compliance rates, non-compliant vessels, and enforcement actions across all ports.',
        type: 'Compliance',
        period: 'Q1 2025',
        generatedAt: '2025-03-09T08:30:00Z',
        status: 'ready',
        fileSizeKb: 512,
    },
    {
        id: 'rpt-003',
        title: 'CO₂ Emissions & Carbon Credits — Feb 2025',
        description: 'Estimated CO₂ tracked, credits retired, and net environmental offset summary.',
        type: 'Environmental',
        period: 'February 2025',
        generatedAt: '2025-03-01T09:15:00Z',
        status: 'ready',
        fileSizeKb: 192,
    },
    {
        id: 'rpt-004',
        title: 'Audit Trail Export — March 2025',
        description: 'Immutable export of all operator actions and policy events for compliance review.',
        type: 'Audit',
        period: 'March 2025',
        generatedAt: '2025-03-09T10:12:00Z',
        status: 'ready',
        fileSizeKb: 88,
    },
    {
        id: 'rpt-005',
        title: 'Monthly Revenue Summary — April 2025',
        description: 'Scheduled report — will be generated automatically on April 1st.',
        type: 'Revenue',
        period: 'April 2025',
        generatedAt: '—',
        status: 'scheduled',
        fileSizeKb: 0,
    },
    {
        id: 'rpt-006',
        title: 'Exemptions & Bilateral Agreements Log',
        description: 'Active exemptions granted by entity, reason, and ministry approval status.',
        type: 'Compliance',
        period: 'YTD 2025',
        generatedAt: '2025-03-08T16:00:00Z',
        status: 'processing',
        fileSizeKb: 0,
    },
];

const TYPE_COLOR: Record<ReportItem['type'], string> = {
    Revenue:      '#00D97E',
    Compliance:   '#38BDF8',
    Environmental:'#22C55E',
    Audit:        '#F59E0B',
};

const TYPE_ICON: Record<ReportItem['type'], React.ReactNode> = {
    Revenue:      <BarChart2 className="w-3.5 h-3.5" />,
    Compliance:   <Shield className="w-3.5 h-3.5" />,
    Environmental:<Leaf className="w-3.5 h-3.5" />,
    Audit:        <FileText className="w-3.5 h-3.5" />,
};

const STATUS_CONFIG = {
    ready: {
        icon: <CheckCircle className="w-3 h-3" />,
        label: 'Ready',
        color: '#22C55E',
    },
    processing: {
        icon: <Clock className="w-3 h-3 animate-spin" style={{ animationDuration: '2s' }} />,
        label: 'Processing',
        color: '#38BDF8',
    },
    scheduled: {
        icon: <Calendar className="w-3 h-3" />,
        label: 'Scheduled',
        color: '#64748B',
    },
};

// ── Derived compliance data (computed inside component via hooks) ─────────────

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
    const complianceBreakdown = React.useMemo(() => [
        { name: 'Compliant',    value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.COMPLIANT).length,    color: '#22C55E' },
        { name: 'Payment Due',  value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE).length,  color: '#F59E0B' },
        { name: 'Processing',   value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.PROCESSING).length,   color: '#38BDF8' },
        { name: 'Non-Compliant',value: vessels.filter((v) => v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT).length,color: '#EF4444' },
    ], [vessels]);
    const [typeFilter, setTypeFilter] = React.useState<string>('ALL');

    const filteredReports = typeFilter === 'ALL'
        ? REPORT_CATALOG
        : REPORT_CATALOG.filter((r) => r.type === typeFilter);

    return (
        <div className="p-5 flex flex-col gap-5">
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

            {/* KPI row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: t('kpi_revenue_ytd'),       value: `$${(kpis.monthlyRevenueUsd * 3 / 1_000_000).toFixed(2)}M`, delta: `+${kpis.monthlyRevenueDelta}%`, color: '#00D97E' },
                    { label: t('kpi_vessels_processed'), value: kpis.vesselsProcessed.toLocaleString(),                      delta: '+8.2%',                              color: '#38BDF8' },
                    { label: t('kpi_co2_tracked'),       value: `${(kpis.estCo2TrackingTons / 1000).toFixed(1)}kt`,         delta: '+15.1%',                             color: '#F59E0B' },
                    { label: t('kpi_reports_generated'), value: REPORT_CATALOG.filter((r) => r.status === 'ready').length.toString(), delta: t('this_month'),                   color: '#A78BFA' },
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
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
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

            {/* Report catalogue */}
            <div className="os-card overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('report_catalogue')}</h3>
                        <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{t('report_catalogue_desc')}</p>
                    </div>
                    {/* Type filter tabs */}
                    <div className="flex items-center gap-1">
                        {(['ALL', 'Revenue', 'Compliance', 'Environmental', 'Audit'] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTypeFilter(t)}
                                className={`h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-colors ${
                                    typeFilter === t
                                        ? 'bg-[rgba(0,217,126,0.12)] text-[#00D97E]'
                                        : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)]'
                                }`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="divide-y divide-[var(--os-border)]">
                    {filteredReports.map((report) => {
                        const typeColor = TYPE_COLOR[report.type];
                        const status = STATUS_CONFIG[report.status];
                        return (
                            <div key={report.id} className="px-5 py-4 hover:bg-[var(--os-surface-2)] transition-colors flex items-center gap-4">
                                {/* Type icon */}
                                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${typeColor}15`, color: typeColor }}>
                                    {TYPE_ICON[report.type]}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <p className="text-sm font-semibold text-[var(--os-text-primary)] truncate">{report.title}</p>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest flex-shrink-0" style={{ backgroundColor: `${typeColor}15`, color: typeColor }}>
                                            {report.type}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-[var(--os-text-muted)] truncate">{report.description}</p>
                                    <div className="flex items-center gap-3 mt-1.5 text-[9px] text-[var(--os-text-muted)]">
                                        <span className="flex items-center gap-1">
                                            <Calendar className="w-2.5 h-2.5" />
                                            {report.period}
                                        </span>
                                        {report.generatedAt !== '—' && (
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-2.5 h-2.5" />
                                                {report.generatedAt.slice(0, 10)}
                                            </span>
                                        )}
                                        {report.fileSizeKb > 0 && (
                                            <span>{report.fileSizeKb} KB</span>
                                        )}
                                    </div>
                                </div>

                                {/* Status */}
                                <div className="flex items-center gap-1.5 text-[10px] font-semibold flex-shrink-0" style={{ color: status.color }}>
                                    {status.icon}
                                    {status.label}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {report.status === 'ready' ? (
                                        <>
                                            <button className="h-8 px-3 rounded-lg border border-[var(--os-border)] text-[10px] font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] flex items-center gap-1.5 transition-colors">
                                                <Download className="w-3 h-3" />
                                                PDF
                                            </button>
                                            <button className="h-8 px-3 rounded-lg border border-[var(--os-border)] text-[10px] font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] flex items-center gap-1.5 transition-colors">
                                                <Download className="w-3 h-3" />
                                                CSV
                                            </button>
                                        </>
                                    ) : report.status === 'processing' ? (
                                        <span className="text-[10px] text-[var(--os-text-muted)] italic">{t('status_generating')}</span>
                                    ) : (
                                        <span className="text-[10px] text-[var(--os-text-muted)] italic">{t('status_auto_generated')}</span>
                                    )}
                                    <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer with certification notice */}
                <div className="px-5 py-3 border-t border-[var(--os-border)] flex items-center gap-3">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] flex-shrink-0" />
                    <p className="text-[10px] text-[var(--os-text-muted)]">
                        {t('certification_notice')}
                    </p>
                </div>
            </div>
        </div>
    );
}
