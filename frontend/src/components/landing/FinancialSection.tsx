'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { assetValuationData } from '@/mock/datas';

export function FinancialSection() {
    const t = useTranslations('Landing');
    const c = useTranslations('Common');

    return (
        <section className="py-24 px-6 relative" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">

                {/* Left Text Content */}
                <div>
                    <h2 className="inline-flex px-3 py-1 rounded bg-amber-50 text-amber-600 text-xs font-bold tracking-widest uppercase mb-6">
                        {t('financial_badge')}
                    </h2>
                    <h3 className="text-4xl md:text-5xl font-bold mb-6 leading-tight" style={{ color: 'var(--ais-page-text)' }}>
                        {t('financial_title')}
                    </h3>
                    <p className="text-lg mb-6 leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('financial_desc1')}
                    </p>
                    <p className="text-lg mb-10 leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('financial_desc2')}
                    </p>

                    <button className="px-8 py-3.5 rounded-xl font-semibold transition-all" style={{ backgroundColor: 'var(--ais-page-text)', color: 'var(--ais-page-bg)' }}>
                        {c('explore_financial')}
                    </button>
                </div>

                {/* Right Interactive Chart Mockup */}
                <div className="rounded-2xl p-8 shadow-2xl relative" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>

                    <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-[80px]" />

                    <h4 className="text-xl font-medium mb-8 relative z-10" style={{ color: 'var(--ais-page-text)' }}>Live Asset Valuation</h4>

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
                        <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ais-page-bg)', border: '1px solid var(--ais-page-border)' }}>
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--ais-page-text-muted)' }}>Total Valuation</p>
                            <p className="text-2xl font-bold" style={{ color: 'var(--ais-page-text)' }}>$4.2B</p>
                        </div>
                        <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--ais-page-bg)', border: '1px solid var(--ais-page-border)' }}>
                            <p className="text-xs font-medium mb-1" style={{ color: 'var(--ais-page-text-muted)' }}>YoY Growth</p>
                            <p className="text-2xl text-amber-500 font-bold">+12.5%</p>
                        </div>
                    </div>

                </div>

            </div>
        </section>
    );
}
