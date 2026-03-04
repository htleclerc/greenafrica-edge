'use client';

import { useTranslations } from 'next-intl';
import { BarChart3 } from 'lucide-react';
import { reportTrends } from '@/mock/datas/reportsMock';

export function ReportsAnalyticsSection() {
    const t = useTranslations('Reports');

    const maxRevenue = Math.max(...reportTrends.map((d) => d.revenue));
    const maxCompliance = 100;

    return (
        <section className="py-20 px-6 bg-[#0D1512] relative overflow-hidden">
            <div className="max-w-7xl mx-auto relative z-10">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-widest uppercase mb-4">
                            <BarChart3 className="w-3 h-3" />
                            {t('analytics_badge')}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">{t('analytics_title')}</h2>
                        <p className="text-slate-400 max-w-xl">{t('analytics_subtitle')}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Revenue Trend Chart */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 backdrop-blur-sm">
                        <h3 className="text-lg font-semibold text-white mb-8 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            Revenue Generation Analytics
                        </h3>
                        <div className="h-64 flex items-end gap-2 md:gap-4 pt-10">
                            {reportTrends.map((d, idx) => (
                                <div key={idx} className="flex-1 flex flex-col items-center group relative cursor-pointer">
                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                                        <div className="bg-[#1A2521] border border-emerald-500/30 rounded-lg px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-2xl">
                                            ${(d.revenue / 1000000).toFixed(1)}M
                                        </div>
                                    </div>
                                    <div
                                        className="w-full bg-gradient-to-t from-emerald-600/40 to-emerald-400 rounded-t-lg transition-all duration-500 group-hover:from-emerald-500/60 group-hover:to-emerald-300"
                                        style={{ height: `${(d.revenue / maxRevenue) * 100}%` }}
                                    />
                                    <span className="mt-4 text-[10px] text-slate-500 font-bold uppercase tracking-tighter">{d.period}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Compliance Trend Chart */}
                    <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-8 backdrop-blur-sm">
                        <h3 className="text-lg font-semibold text-white mb-8 flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-400" />
                            Sectoral Compliance Evolution
                        </h3>
                        <div className="h-64 flex items-end gap-2 md:gap-4 pt-10">
                            {reportTrends.map((d, idx) => (
                                <div key={idx} className="flex-1 flex flex-col items-center group relative cursor-pointer">
                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                                        <div className="bg-[#1A2521] border border-blue-500/30 rounded-lg px-2 py-1 text-[10px] text-white whitespace-nowrap shadow-2xl">
                                            {d.compliance}%
                                        </div>
                                    </div>
                                    <div
                                        className="w-full bg-gradient-to-t from-blue-600/40 to-blue-400 rounded-t-lg transition-all duration-500 group-hover:from-blue-500/60 group-hover:to-blue-300"
                                        style={{ height: `${(d.compliance / maxCompliance) * 100}%` }}
                                    />
                                    <span className="mt-4 text-[10px] text-slate-500 font-bold uppercase tracking-tighter">{d.period}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
