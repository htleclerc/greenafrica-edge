'use client';

import { useTranslations } from 'next-intl';
import { Leaf, DollarSign, Wind, FolderOpen } from 'lucide-react';
import { carbonCreditKpis } from '@/mock/datas/carbonCreditMock';

const KPI_ICONS = [Leaf, DollarSign, Wind, FolderOpen];
const KPI_COLORS = ['emerald', 'teal', 'cyan', 'green'];

export function CarbonCreditHeroSection() {
    const t = useTranslations('CarbonCredit');

    return (
        <section className="relative pt-24 sm:pt-28 md:pt-32 pb-12 sm:pb-16 md:pb-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            {/* Background gradients */}
            <div className="absolute top-0 left-1/4 w-[300px] sm:w-[500px] lg:w-[600px] h-[400px] bg-emerald-900/15 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 right-1/4 w-[300px] sm:w-[400px] h-[300px] bg-teal-900/10 rounded-full blur-[120px]" />
            <div className="absolute top-1/2 left-0 w-[300px] h-[300px] bg-cyan-900/8 rounded-full blur-[100px]" />
            {/* Grid pattern */}
            <div
                className="absolute inset-0 opacity-[0.025]"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                }}
            />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" />
                        </span>
                        {t('hero_badge')}
                    </div>
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 leading-tight" style={{ color: 'var(--ais-page-text)' }}>
                        {t('hero_title_line1')}{' '}
                        <span className="bg-gradient-to-r from-teal-400 via-emerald-300 to-cyan-400 bg-clip-text text-transparent">
                            {t('hero_title_line2')}
                        </span>
                    </h1>
                    <p className="text-sm sm:text-base max-w-2xl leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('hero_subtitle')}
                    </p>
                </div>

                {/* KPI Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {carbonCreditKpis.map((kpi, i) => {
                        const Icon = KPI_ICONS[i];
                        const color = KPI_COLORS[i];
                        return (
                            <div
                                key={kpi.key}
                                className="rounded-2xl p-6 hover:border-teal-500/20 transition-all duration-300 group"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div
                                        className={`w-10 h-10 rounded-xl bg-${color}-500/10 flex items-center justify-center`}
                                    >
                                        <Icon className={`w-5 h-5 text-${color}-400`} />
                                    </div>
                                    <span
                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${kpi.positive
                                                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                                                : 'text-red-400 bg-red-500/10 border-red-500/20'
                                            }`}
                                    >
                                        {kpi.positive ? '▲' : '▼'} {kpi.change.split(' ')[0]}
                                    </span>
                                </div>
                                <p className="text-2xl font-bold mb-1" style={{ color: 'var(--ais-page-text)' }}>{kpi.value}</p>
                                <p className="text-xs font-medium" style={{ color: 'var(--ais-page-text-dim)' }}>{t(kpi.key)}</p>
                                <p className="text-[10px] mt-1" style={{ color: 'var(--ais-page-text-dim)' }}>{kpi.change}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
