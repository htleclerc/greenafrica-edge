'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Download, TrendingUp } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { useRole } from '@/lib/RoleContext';
import { useTco } from '@/hooks/useTco';
import { UserRole } from '@/types/secure';

// ── Constants ────────────────────────────────────────────────────────────────

const ZONE_COLORS = ['#00D97E', '#38BDF8', '#F59E0B'];
const CATEGORY_COLORS = ['#00D97E', '#38BDF8', '#F59E0B', '#A78BFA', '#F97316'];

type Period = 'month' | 'quarter' | 'year';

// ── Custom tooltip (matches RevenueDashboard) ────────────────────────────────

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="os-card p-3 text-xs min-w-[120px]">
            <p className="text-[var(--os-text-muted)] mb-1 font-semibold">{label}</p>
            {payload.map((p) => (
                <div key={p.name} className="flex justify-between gap-4">
                    <span className="text-[var(--os-text-secondary)]">{p.name}</span>
                    <span className="font-bold text-[var(--os-text-primary)]">
                        {typeof p.value === 'number' && p.value > 1000
                            ? `$${(p.value / 1000).toFixed(0)}K`
                            : typeof p.value === 'number'
                                ? p.value.toFixed(1)
                                : p.value}
                    </span>
                </div>
            ))}
        </div>
    );
};

// ── Shipping Agent View ──────────────────────────────────────────────────────

export function ShippingAgentView() {
    const t = useTranslations('TCO');
    const { data } = useTco();
    const [period, setPeriod] = React.useState<Period>('month');

    const kpis = [
        { label: t('kpi_total_tax'),      value: `$${(data.totalTax / 1_000).toFixed(1)}K`, color: '#00D97E' },
        { label: t('kpi_total_emissions'), value: `${data.totalEmissions.toFixed(0)} tCO\u2082`, color: '#38BDF8' },
        { label: t('kpi_fleet_size'),      value: `${data.fleetSize}`, color: '#A78BFA' },
        { label: t('kpi_avg_cost'),        value: `$${data.avgCostPerVessel.toFixed(0)}`, color: '#F59E0B' },
    ];

    return (
        <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map(({ label, value, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums mb-1" style={{ color }}>{value}</p>
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-[#22C55E]">
                            <TrendingUp className="w-3 h-3" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Period Filter */}
            <div className="flex gap-2">
                {(['month', 'quarter', 'year'] as Period[]).map((p) => (
                    <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{
                            backgroundColor: period === p ? 'color-mix(in srgb, var(--os-brand-green) 15%, transparent)' : 'transparent',
                            color: period === p ? 'var(--os-brand-green)' : 'var(--os-text-muted)',
                            border: `1px solid ${period === p ? 'color-mix(in srgb, var(--os-brand-green) 30%, transparent)' : 'var(--os-border)'}`,
                        }}
                    >
                        {t(`period_${p}`)}
                    </button>
                ))}
            </div>

            {/* Charts row: Cost by Vessel + Cost Trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                {/* Chart 1: Cost by Vessel (horizontal bar) */}
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_cost_by_vessel')}</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data.costByVessel} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                            <XAxis type="number" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                            <YAxis type="category" dataKey="vesselName" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} width={120} />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--os-text-muted)', fillOpacity: 0.08 }} />
                            <Bar dataKey="taxAmount" name="Tax (USD)" fill="#00D97E" fillOpacity={0.85} radius={[0, 4, 4, 0]} barSize={18} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Chart 2: Cost Trend (line chart) */}
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_cost_trend')}</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={data.costTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis dataKey="month" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Line type="monotone" dataKey="cost" name="Cost" stroke="#00D97E" strokeWidth={2} dot={{ r: 3, fill: '#00D97E' }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Chart 3: Cost by Zone (donut) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_cost_by_zone')}</h3>
                    <div className="flex items-center justify-center">
                        <div className="relative">
                            <ResponsiveContainer width={180} height={180}>
                                <PieChart>
                                    <Pie
                                        data={data.costByZone}
                                        cx={85}
                                        cy={85}
                                        innerRadius={50}
                                        outerRadius={75}
                                        startAngle={90}
                                        endAngle={-270}
                                        dataKey="value"
                                        nameKey="zone"
                                        strokeWidth={0}
                                    >
                                        {data.costByZone.map((_, i) => (
                                            <Cell key={i} fill={ZONE_COLORS[i % ZONE_COLORS.length]} fillOpacity={0.85} />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <p className="text-lg font-bold text-[var(--os-text-primary)]">${(data.totalTax / 1_000).toFixed(1)}K</p>
                                <p className="text-[9px] text-[var(--os-text-muted)]">{t('kpi_total_tax')}</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1 mt-3">
                        {data.costByZone.map((z, i) => (
                            <div key={z.zone} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ZONE_COLORS[i] }} />
                                    <span className="text-[var(--os-text-secondary)]">{z.zone}</span>
                                </div>
                                <span className="font-bold tabular-nums text-[var(--os-text-primary)]">${(z.value / 1000).toFixed(1)}K</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Table: Cost breakdown per vessel */}
                <div className="os-card p-5 overflow-x-auto">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-3">{t('chart_cost_by_vessel')}</h3>
                    {data.costByVessel.length === 0 ? (
                        <p className="text-xs text-[var(--os-text-muted)] py-8 text-center">{t('no_data')}</p>
                    ) : (
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b" style={{ borderColor: 'var(--os-border)' }}>
                                    <th className="text-left py-2 font-semibold text-[var(--os-text-muted)]">{t('table_vessel')}</th>
                                    <th className="text-right py-2 font-semibold text-[var(--os-text-muted)]">{t('table_emissions')}</th>
                                    <th className="text-right py-2 font-semibold text-[var(--os-text-muted)]">{t('table_tax')}</th>
                                    <th className="text-right py-2 font-semibold text-[var(--os-text-muted)]">{t('table_status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.costByVessel.map((v) => (
                                    <tr key={v.vesselId} className="border-b" style={{ borderColor: 'var(--os-border)' }}>
                                        <td className="py-2 text-[var(--os-text-primary)] font-medium">{v.vesselName}</td>
                                        <td className="py-2 text-right tabular-nums text-[var(--os-text-secondary)]">{v.emissions.toFixed(1)}</td>
                                        <td className="py-2 text-right tabular-nums text-[#00D97E] font-semibold">${v.taxAmount.toLocaleString()}</td>
                                        <td className="py-2 text-right">
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{
                                                backgroundColor: v.status === 'COMPLIANT' || v.status === 'PAID' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                                                color: v.status === 'COMPLIANT' || v.status === 'PAID' ? '#22C55E' : '#F59E0B',
                                            }}>
                                                {v.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </>
    );
}

// ── Finance / Admin View ─────────────────────────────────────────────────────

function FinanceAdminView() {
    const t = useTranslations('TCO');
    const { data } = useTco();

    const kpis = [
        { label: t('kpi_revenue'),          value: `$${(data.totalRevenue / 1_000).toFixed(1)}K`, color: '#00D97E' },
        { label: t('kpi_avg_cost'),         value: `$${data.avgTaxPerVessel.toFixed(0)}`, color: '#38BDF8' },
        { label: t('kpi_collection_rate'),  value: `${data.collectionRate.toFixed(1)}%`, color: '#A78BFA' },
        { label: t('kpi_active_configs'),   value: `${data.activeConfigs}`, color: '#F59E0B' },
    ];

    return (
        <>
            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map(({ label, value, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums mb-1" style={{ color }}>{value}</p>
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-[#22C55E]">
                            <TrendingUp className="w-3 h-3" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts row: Revenue Trend + Revenue by Category */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                {/* Chart 1: Revenue Trend (line chart) */}
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_revenue_trend')}</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={data.revenueTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis dataKey="month" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#00D97E" strokeWidth={2} dot={{ r: 3, fill: '#00D97E' }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* Chart 2: Revenue by Category (bar chart) */}
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_revenue_by_category')}</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data.revenueByCategory} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barSize={24}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="category" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--os-text-muted)', fillOpacity: 0.08 }} />
                            <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                                {data.revenueByCategory.map((_, i) => (
                                    <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} fillOpacity={0.85} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Chart 3: Top Contributing Vessels (horizontal bars) + Revenue by Zone table */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_top_vessels')}</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data.topVessels} layout="vertical" margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                            <XAxis type="number" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                            <YAxis type="category" dataKey="vesselName" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} width={120} />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--os-text-muted)', fillOpacity: 0.08 }} />
                            <Bar dataKey="revenue" name="Revenue" fill="#38BDF8" fillOpacity={0.85} radius={[0, 4, 4, 0]} barSize={18} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Revenue by Zone table */}
                <div className="os-card p-5 overflow-x-auto">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-3">{t('chart_cost_by_zone')}</h3>
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b" style={{ borderColor: 'var(--os-border)' }}>
                                <th className="text-left py-2 font-semibold text-[var(--os-text-muted)]">{t('table_zone')}</th>
                                <th className="text-right py-2 font-semibold text-[var(--os-text-muted)]">{t('table_tax')}</th>
                                <th className="text-right py-2 font-semibold text-[var(--os-text-muted)]">{t('table_vessel')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.revenueByZone.map((z, i) => (
                                <tr key={z.zone} className="border-b" style={{ borderColor: 'var(--os-border)' }}>
                                    <td className="py-2 text-[var(--os-text-primary)] font-medium">
                                        <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ZONE_COLORS[i] }} />
                                            {z.zone}
                                        </div>
                                    </td>
                                    <td className="py-2 text-right tabular-nums text-[#00D97E] font-semibold">${z.revenue.toLocaleString()}</td>
                                    <td className="py-2 text-right tabular-nums text-[var(--os-text-secondary)]">{z.vessels}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}

// ── Main TCO Dashboard ───────────────────────────────────────────────────────

export default function TcoDashboard() {
    const t = useTranslations('TCO');
    const { role } = useRole();

    const isShippingAgent = role === UserRole.SHIPPING_AGENT;

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{t('subtitle')}</p>
                </div>
                <OsButton
                    variant="secondary"
                    size="sm"
                    icon={<Download className="w-3.5 h-3.5" />}
                    onClick={() => alert('CSV export coming soon')}
                >
                    {t('export_csv')}
                </OsButton>
            </div>

            {/* Role-based content */}
            {isShippingAgent ? <ShippingAgentView /> : <FinanceAdminView />}
        </div>
    );
}
