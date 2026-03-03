'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { assetValuationData } from '@/mock/datas';

export function FinancialSection() {
    const t = useTranslations('Landing');
    const c = useTranslations('Common');

    return (
        <section className="py-24 px-6 bg-white relative">
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

                {/* Left Text Content */}
                <div>
                    <h2 className="inline-flex px-3 py-1 rounded bg-amber-50 text-amber-600 text-xs font-bold tracking-widest uppercase mb-6">
                        {t('financial_badge')}
                    </h2>
                    <h3 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6 leading-tight">
                        {t('financial_title')}
                    </h3>
                    <p className="text-lg text-slate-600 mb-6 leading-relaxed">
                        {t('financial_desc1')}
                    </p>
                    <p className="text-lg text-slate-600 mb-10 leading-relaxed">
                        {t('financial_desc2')}
                    </p>

                    <button className="px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition-all">
                        {c('explore_financial')}
                    </button>
                </div>

                {/* Right Interactive Chart Mockup */}
                <div className="bg-[#1c2a24] rounded-2xl p-8 shadow-2xl border border-slate-800 relative">

                    <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-[80px]" />

                    <h4 className="text-xl text-white font-medium mb-8 relative z-10">Live Asset Valuation</h4>

                    <div className="h-64 w-full relative z-10 mb-6">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={assetValuationData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                <XAxis dataKey="quarter" stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    cursor={{ fill: '#334155', opacity: 0.2 }}
                                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px' }}
                                />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {assetValuationData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={index === 3 ? '#fbbf24' : '#334155'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-2 gap-4 relative z-10">
                        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800/50">
                            <p className="text-xs text-slate-400 font-medium mb-1">Total Valuation</p>
                            <p className="text-2xl text-white font-bold">$4.2B</p>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800/50">
                            <p className="text-xs text-slate-400 font-medium mb-1">YoY Growth</p>
                            <p className="text-2xl text-amber-500 font-bold">+12.5%</p>
                        </div>
                    </div>

                </div>

            </div>
        </section>
    );
}
