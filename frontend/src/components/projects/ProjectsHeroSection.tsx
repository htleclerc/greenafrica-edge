'use client';

import { useTranslations } from 'next-intl';
import { DollarSign, FolderOpen, Leaf, Users } from 'lucide-react';
import { projectsKpis } from '@/mock/datas/projectsMock';

const KPI_ICONS = [DollarSign, FolderOpen, Leaf, Users];
const KPI_COLORS = ['emerald', 'teal', 'cyan', 'green'];

export function ProjectsHeroSection() {
    const t = useTranslations('Projects');

    return (
        <section className="relative pt-28 pb-16 px-6 bg-[#0A1110] overflow-hidden">
            {/* Background gradients */}
            <div className="absolute top-0 left-1/3 w-[700px] h-[450px] bg-emerald-900/15 rounded-full blur-[160px]" />
            <div className="absolute bottom-0 right-1/4 w-[500px] h-[350px] bg-teal-900/10 rounded-full blur-[130px]" />
            <div className="absolute top-1/2 left-0 w-[350px] h-[350px] bg-green-900/8 rounded-full blur-[110px]" />
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
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        {t('hero_badge')}
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
                        {t('hero_title_line1')}{' '}
                        <span className="bg-gradient-to-r from-emerald-400 via-green-300 to-teal-400 bg-clip-text text-transparent">
                            {t('hero_title_line2')}
                        </span>
                    </h1>
                    <p className="text-slate-400 text-base max-w-2xl leading-relaxed">
                        {t('hero_subtitle')}
                    </p>
                </div>

                {/* KPI Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {projectsKpis.map((kpi, i) => {
                        const Icon = KPI_ICONS[i];
                        const color = KPI_COLORS[i];
                        return (
                            <div
                                key={kpi.key}
                                className="bg-[#111C18] rounded-2xl p-6 border border-white/5 hover:border-emerald-500/20 transition-all duration-300 group"
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`w-10 h-10 rounded-xl bg-${color}-500/10 flex items-center justify-center`}>
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
                                <p className="text-2xl font-bold text-white mb-1">{kpi.value}</p>
                                <p className="text-xs text-slate-500 font-medium">{t(kpi.key)}</p>
                                <p className="text-[10px] text-slate-600 mt-1">{kpi.change}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
