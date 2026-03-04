'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import { portfolioTimeSeries } from '@/mock/datas/carbonCreditMock';

const SERIES_COLORS = {
    issued: { bar: '#14B8A6', label: 'Issued' },
    retired: { bar: '#6366F1', label: 'Retired' },
    available: { bar: '#10B981', label: 'Available' },
};

function formatK(value: number): string {
    return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value);
}

export function CarbonCreditPortfolioSection() {
    const t = useTranslations('CarbonCredit');

    const last = portfolioTimeSeries[portfolioTimeSeries.length - 1];
    const prev = portfolioTimeSeries[portfolioTimeSeries.length - 2];
    const issuedGrowth = (((last.issued - prev.issued) / prev.issued) * 100).toFixed(1);
    const retirementRate = ((last.retired / last.issued) * 100).toFixed(1);
    const maxIssued = Math.max(...portfolioTimeSeries.map((d) => d.issued));

    return (
        <section className="py-16 px-6 bg-[#0D1512] relative overflow-hidden">
            <div className="absolute bottom-0 right-0 w-[600px] h-[400px] bg-teal-900/10 rounded-full blur-[150px] translate-x-1/3" />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
                    <div>
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-bold tracking-[0.15em] uppercase mb-5">
                            <TrendingUp className="w-3 h-3" />
                            {t('portfolio_badge')}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-2">{t('portfolio_title')}</h2>
                        <p className="text-slate-400 text-sm">{t('portfolio_subtitle')}</p>
                    </div>

                    {/* Summary cards */}
                    <div className="flex gap-3 shrink-0 flex-wrap">
                        <div className="bg-[#111C18] rounded-xl p-4 border border-white/5 text-center min-w-[110px]">
                            <p className="text-[10px] text-slate-500 mb-1">{t('portfolio_total_issued')}</p>
                            <p className="text-xl font-bold text-white">{formatK(last.issued)}</p>
                        </div>
                        <div className="bg-[#111C18] rounded-xl p-4 border border-white/5 text-center min-w-[110px]">
                            <p className="text-[10px] text-slate-500 mb-1">{t('portfolio_growth')}</p>
                            <p className="text-xl font-bold text-teal-400">+{issuedGrowth}%</p>
                        </div>
                        <div className="bg-[#111C18] rounded-xl p-4 border border-white/5 text-center min-w-[110px]">
                            <p className="text-[10px] text-slate-500 mb-1">{t('portfolio_retirement_rate')}</p>
                            <p className="text-xl font-bold text-indigo-400">{retirementRate}%</p>
                        </div>
                    </div>
                </div>

                {/* Chart area */}
                <div className="bg-[#111C18] rounded-2xl p-6 border border-white/5">
                    {/* Legend */}
                    <div className="flex flex-wrap items-center gap-4 mb-6">
                        {Object.entries(SERIES_COLORS).map(([key, { bar, label }]) => (
                            <div key={key} className="flex items-center gap-1.5">
                                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: bar }} />
                                <span className="text-[11px] text-slate-400">{label}</span>
                            </div>
                        ))}
                    </div>

                    {/* Stacked area chart — pure CSS/SVG */}
                    <div className="overflow-x-auto">
                        <div className="min-w-[600px]">
                            {/* Bars */}
                            <div className="flex items-end gap-2 h-48">
                                {portfolioTimeSeries.map((d) => {
                                    const issuedH = (d.issued / maxIssued) * 100;
                                    const retiredH = (d.retired / maxIssued) * 100;
                                    const availableH = (d.available / maxIssued) * 100;
                                    return (
                                        <div key={d.month} className="flex-1 flex flex-col items-center gap-0 group relative">
                                            {/* Tooltip */}
                                            <div className="hidden group-hover:flex flex-col items-center mb-1 z-10 absolute bottom-full">
                                                <div className="bg-[#0A1110] border border-white/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white whitespace-nowrap shadow-xl text-left">
                                                    <p className="font-bold mb-0.5">{d.month}</p>
                                                    <p style={{ color: SERIES_COLORS.issued.bar }}>Issued: {formatK(d.issued)}</p>
                                                    <p style={{ color: SERIES_COLORS.retired.bar }}>Retired: {formatK(d.retired)}</p>
                                                    <p style={{ color: SERIES_COLORS.available.bar }}>Available: {formatK(d.available)}</p>
                                                </div>
                                            </div>
                                            {/* Stacked bars */}
                                            <div className="w-full flex flex-col-reverse gap-0.5">
                                                <div
                                                    className="w-full rounded-b-sm transition-all duration-500"
                                                    style={{
                                                        height: `${retiredH * 1.12}px`,
                                                        backgroundColor: SERIES_COLORS.retired.bar,
                                                        opacity: 0.8,
                                                    }}
                                                />
                                                <div
                                                    className="w-full transition-all duration-500"
                                                    style={{
                                                        height: `${availableH * 1.12}px`,
                                                        backgroundColor: SERIES_COLORS.available.bar,
                                                        opacity: 0.8,
                                                    }}
                                                />
                                                <div
                                                    className="w-full rounded-t-sm transition-all duration-500"
                                                    style={{
                                                        height: `${(issuedH - retiredH - availableH > 0 ? issuedH - retiredH - availableH : 2) * 1.12}px`,
                                                        backgroundColor: SERIES_COLORS.issued.bar,
                                                        opacity: 0.7,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Month labels */}
                            <div className="flex items-center gap-2 mt-2">
                                {portfolioTimeSeries.map((d) => (
                                    <div key={d.month} className="flex-1 text-center text-[9px] text-slate-600 font-medium">
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
