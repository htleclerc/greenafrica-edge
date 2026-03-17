'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Download, TrendingUp } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { useKpis } from '@/hooks/useKpis';

// Static chart data — will be replaced by /api/revenue/analytics in V2
const REVENUE_WEEKLY = [
    { week: 'W1 Jan', revenue: 180_000, co2: 9_000 },
    { week: 'W2 Jan', revenue: 220_000, co2: 11_000 },
    { week: 'W3 Jan', revenue: 195_000, co2: 9_750 },
    { week: 'W4 Jan', revenue: 260_000, co2: 13_000 },
    { week: 'W1 Feb', revenue: 310_000, co2: 15_500 },
    { week: 'W2 Feb', revenue: 275_000, co2: 13_750 },
    { week: 'W3 Feb', revenue: 340_000, co2: 17_000 },
    { week: 'W4 Feb', revenue: 390_000, co2: 19_500 },
    { week: 'W1 Mar', revenue: 420_000, co2: 21_000 },
];

const REVENUE_BY_CATEGORY = [
    { category: 'Container',    revenue: 540_200, vessels: 312 },
    { category: 'Cargo',        revenue: 329_800, vessels: 218 },
    { category: 'Tanker',       revenue: 214_500, vessels: 97  },
    { category: 'Bulk Carrier', revenue: 142_000, vessels: 180 },
    { category: 'Other',        revenue: 14_000,  vessels: 35  },
];

const CATEGORY_COLORS = ['#00D97E', '#38BDF8', '#F59E0B', '#A78BFA', '#F97316'];

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
                            : p.value}
                    </span>
                </div>
            ))}
        </div>
    );
};

export function RevenueDashboard() {
    const t = useTranslations('RevenuePage');
    const { data: kpis } = useKpis();
    const totalRevenue = REVENUE_BY_CATEGORY.reduce((s, d) => s + d.revenue, 0);

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
                <OsButton variant="secondary" size="sm" icon={<Download className="w-3.5 h-3.5" />}>
                    {t('export_report')}
                </OsButton>
            </div>

            {/* KPI summary row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: t('kpi_total_revenue_ytd'),    value: `$${(totalRevenue / 1_000_000).toFixed(2)}M`, delta: 12.4, color: '#00D97E' },
                    { label: t('kpi_carbon_offsets_ytd'),   value: `$${(kpis.estCo2TrackingTons * 20 / 1_000).toFixed(1)}K`, delta: 8.1, color: '#38BDF8' },
                    { label: t('kpi_avg_price_vessel'),   value: `$${(totalRevenue / kpis.vesselsProcessed).toFixed(0)}`, delta: 4.2, color: '#A78BFA' },
                    { label: t('kpi_compliance_rate'),      value: '94.2%', delta: 2.0, color: '#22C55E' },
                ].map(({ label, value, delta, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums mb-1" style={{ color }}>{value}</p>
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-[#22C55E]">
                            <TrendingUp className="w-3 h-3" />
                            {t('kpi_delta', { delta })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Charts row 1: Area + Bar */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-4 sm:gap-5">
                {/* Weekly revenue trend */}
                <div className="os-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('chart_revenue_trends')}</h3>
                            <p className="text-[10px] text-[var(--os-text-muted)]">{t('chart_revenue_trends_desc')}</p>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={REVENUE_WEEKLY} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                            <defs>
                                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#00D97E" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#00D97E" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="co2Grad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#38BDF8" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#38BDF8" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis dataKey="week" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#00D97E" strokeWidth={2} fill="url(#revGrad)" />
                            <Area type="monotone" dataKey="co2"     name="CO₂ Credits" stroke="#38BDF8" strokeWidth={2} fill="url(#co2Grad)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Revenue by category bar */}
                <div className="os-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('chart_top_categories')}</h3>
                            <p className="text-[10px] text-[var(--os-text-muted)]">{t('chart_top_categories_desc')}</p>
                        </div>
                        <a href="/admin/tax-settings" className="text-[10px] text-[#38BDF8] hover:underline">{t('view_full_report')}</a>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={REVENUE_BY_CATEGORY} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barSize={20}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="category" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                                {REVENUE_BY_CATEGORY.map((_, i) => (
                                    <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} fillOpacity={0.85} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>

                    {/* Breakdown list */}
                    <div className="mt-3 flex flex-col gap-1">
                        {REVENUE_BY_CATEGORY.map(({ category, revenue }, i) => (
                            <div key={category} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[i] }} />
                                    <span className="text-[var(--os-text-secondary)]">{category}</span>
                                </div>
                                <span className="font-bold tabular-nums text-[var(--os-text-primary)]">
                                    ${(revenue / 1000).toFixed(1)}K
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Charts row 2: Donut + Month comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                {/* Donut */}
                <div className="os-card p-5">
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)] mb-1">{t('chart_co2_impact')}</h3>
                    <p className="text-[10px] text-[var(--os-text-muted)] mb-4">{t('chart_co2_impact_desc')}</p>
                    <div className="flex items-center justify-center">
                        <div className="relative">
                            <ResponsiveContainer width={160} height={160}>
                                <PieChart>
                                    <Pie
                                        data={[
                                            { name: 'Tracked', value: kpis.estCo2TrackingTons },
                                            { name: 'Offset',  value: kpis.creditsRetiredTons },
                                        ]}
                                        cx={75} cy={75}
                                        innerRadius={50} outerRadius={70}
                                        startAngle={90} endAngle={-270}
                                        dataKey="value"
                                        strokeWidth={0}
                                    >
                                        <Cell fill="#00D97E" fillOpacity={0.9} />
                                        <Cell fill="#0B1628" fillOpacity={1} />
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <p className="text-2xl font-bold text-[var(--os-text-primary)]">75%</p>
                                <p className="text-[9px] text-[var(--os-text-muted)]">{t('compliance')}</p>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                        <div className="text-center">
                            <p className="text-[10px] text-[var(--os-text-muted)]">{t('estimated')}</p>
                            <p className="font-bold text-[#00D97E]">{(kpis.estCo2TrackingTons / 1000).toFixed(1)}kt</p>
                        </div>
                        <div className="text-center">
                            <p className="text-[10px] text-[var(--os-text-muted)]">{t('offset_retired')}</p>
                            <p className="font-bold text-[var(--os-text-muted)]">{(kpis.creditsRetiredTons / 1000).toFixed(1)}kt</p>
                        </div>
                    </div>
                </div>

                {/* Month vs month comparison */}
                <div className="xl:col-span-2 os-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('chart_month_comparison')}</h3>
                        <span className="text-[10px] text-[#22C55E] font-bold">+{kpis.monthlyRevenueDelta}% growth</span>
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart
                            data={[
                                { month: 'Jan', current: 855_000,   prev: 720_000 },
                                { month: 'Feb', current: 1_015_000, prev: 855_000 },
                                { month: 'Mar', current: 1_240_500, prev: 1_015_000 },
                            ]}
                            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                            barGap={4}
                            barSize={24}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="month" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 10, color: '#64748B' }} />
                            <Bar dataKey="current" name="This Year"  fill="#00D97E" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                            <Bar dataKey="prev"    name="Last Year"  fill="#1E3A2F"  radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
