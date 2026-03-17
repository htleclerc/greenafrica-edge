'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import { carbonTaxRevenue } from '@/mock/datas/carbonTaxMock';

function formatMillions(value: number): string {
    return `$${(value / 1_000_000).toFixed(2)}M`;
}

const maxTotal = Math.max(...carbonTaxRevenue.map((d) => d.total));

const TYPE_COLORS = {
    cargo: { bar: '#10B981', label: 'Cargo' },
    tanker: { bar: '#EAB308', label: 'Tanker' },
    container: { bar: '#3B82F6', label: 'Container' },
};

export function CarbonTaxRevenueSection() {
    const t = useTranslations('CarbonTax');

    const totalRevenue = carbonTaxRevenue.reduce((acc, d) => acc + d.total, 0);
    const lastMonth = carbonTaxRevenue[carbonTaxRevenue.length - 1];
    const prevMonth = carbonTaxRevenue[carbonTaxRevenue.length - 2];
    const growth = (((lastMonth.total - prevMonth.total) / prevMonth.total) * 100).toFixed(1);

    return (
        <section className="py-16 px-6 relative overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
            <div className="absolute bottom-0 right-0 w-[600px] h-[400px] bg-emerald-900/10 rounded-full blur-[150px] translate-x-1/3" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
                    <div>
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-5">
                            <TrendingUp className="w-3 h-3" />
                            {t('revenue_badge')}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--ais-page-text)' }}>{t('revenue_title')}</h2>
                        <p className="text-sm" style={{ color: 'var(--ais-page-text-muted)' }}>{t('revenue_subtitle')}</p>
                    </div>

                    {/* Summary cards */}
                    <div className="flex gap-4 shrink-0">
                        <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <p className="text-[10px] mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('revenue_annual_total')}</p>
                            <p className="text-xl font-bold" style={{ color: 'var(--ais-page-text)' }}>{formatMillions(totalRevenue)}</p>
                        </div>
                        <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <p className="text-[10px] mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('revenue_mom_growth')}</p>
                            <p className="text-xl font-bold text-emerald-400">+{growth}%</p>
                        </div>
                    </div>
                </div>

                {/* Chart area */}
                <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                    {/* Legend */}
                    <div className="flex flex-wrap items-center gap-4 mb-6">
                        {Object.entries(TYPE_COLORS).map(([key, { bar, label }]) => (
                            <div key={key} className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: bar }} />
                                <span className="text-[11px]" style={{ color: 'var(--ais-page-text-muted)' }}>{label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Bar chart — pure SVG/CSS, no external libs */}
                    <div className="overflow-x-auto">
                        <div className="min-w-[600px]">
                            <div className="flex items-end gap-1.5 h-40">
                                {carbonTaxRevenue.map((d) => {
                                    const cargoH = (d.cargo / maxTotal) * 100;
                                    const tankerH = (d.tanker / maxTotal) * 100;
                                    const containerH = (d.container / maxTotal) * 100;
                                    return (
                                        <div key={d.month} className="flex-1 flex flex-col items-center gap-0 group">
                                            {/* Tooltip */}
                                            <div className="hidden group-hover:flex flex-col items-center mb-1 z-10">
                                                <div className="rounded-lg px-2 py-1 text-[9px] whitespace-nowrap shadow-xl" style={{ backgroundColor: 'var(--ais-page-bg)', border: '1px solid var(--ais-page-border)', color: 'var(--ais-page-text)' }}>
                                                    {formatMillions(d.total)}
                                                </div>
                                            </div>
                                            {/* Stacked bars */}
                                            <div className="w-full flex flex-col-reverse gap-0.5">
                                                <div
                                                    className="w-full rounded-b-sm transition-all duration-500"
                                                    style={{
                                                        height: `${cargoH * 0.6}px`,
                                                        backgroundColor: TYPE_COLORS.cargo.bar,
                                                        opacity: 0.85,
                                                    }}
                                                />
                                                <div
                                                    className="w-full transition-all duration-500"
                                                    style={{
                                                        height: `${tankerH * 0.6}px`,
                                                        backgroundColor: TYPE_COLORS.tanker.bar,
                                                        opacity: 0.85,
                                                    }}
                                                />
                                                <div
                                                    className="w-full rounded-t-sm transition-all duration-500"
                                                    style={{
                                                        height: `${containerH * 0.6}px`,
                                                        backgroundColor: TYPE_COLORS.container.bar,
                                                        opacity: 0.85,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Month labels */}
                            <div className="flex items-center gap-1.5 mt-2">
                                {carbonTaxRevenue.map((d) => (
                                    <div key={d.month} className="flex-1 text-center text-[9px] font-medium" style={{ color: 'var(--ais-page-text-dim)' }}>
                                        {d.month}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
