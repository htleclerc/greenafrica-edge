'use client';

import { useTranslations } from 'next-intl';
import { GitCommitHorizontal } from 'lucide-react';
import { projectMilestones } from '@/mock/datas/projectsMock';
import { ProjectCategoryColor, type ProjectCategory } from '@/domain/project/projectConstants';

const CATEGORY_DOT_COLOR: Record<string, string> = {
    CARBON_FORESTRY: 'bg-green-400',
    BLUE_CARBON: 'bg-cyan-400',
    CLEAN_ENERGY: 'bg-orange-400',
    CARBON_TAX_POLICY: 'bg-teal-400',
    ADAPTATION: 'bg-sky-400',
    BIODIVERSITY: 'bg-lime-400',
};

export function ProjectsTimelineSection() {
    const t = useTranslations('Projects');

    // Sort by date (earliest first)
    const sorted = [...projectMilestones].sort((a, b) => {
        // Very basic sort by first 4 chars (year)
        return a.date.slice(-4).localeCompare(b.date.slice(-4)) || a.date.localeCompare(b.date);
    });

    return (
        <section className="py-16 px-6 bg-[#0A1110]">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('timeline_badge')}
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">{t('timeline_title')}</h2>
                    <p className="text-slate-400 text-sm max-w-2xl">{t('timeline_subtitle')}</p>
                </div>

                {/* Timeline */}
                <div className="relative">
                    {/* Vertical spine */}
                    <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-emerald-500/40 via-teal-500/20 to-transparent md:left-1/2 md:-translate-x-0.5" />

                    <div className="flex flex-col gap-0">
                        {sorted.map((milestone, idx) => {
                            const isLeft = idx % 2 === 0;
                            const dotColor = CATEGORY_DOT_COLOR[milestone.categoryKey] ?? 'bg-slate-400';
                            const catColor = ProjectCategoryColor[milestone.categoryKey as ProjectCategory];

                            return (
                                <div key={idx} className={`relative flex items-start gap-4 md:gap-0 ${isLeft ? 'md:flex-row' : 'md:flex-row-reverse'} mb-8`}>
                                    {/* Content */}
                                    <div className={`ml-12 md:ml-0 md:w-[45%] ${isLeft ? 'md:pr-10 md:text-right' : 'md:pl-10'}`}>
                                        <div
                                            className={`inline-block bg-[#111C18] rounded-xl border border-white/5 hover:border-emerald-500/15 transition-all duration-300 p-4 ${isLeft ? 'text-left md:text-right' : 'text-left'
                                                }`}
                                        >
                                            <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase">
                                                {milestone.date}
                                            </span>
                                            <h3 className="text-sm font-bold text-white mt-1 mb-1.5">{milestone.title}</h3>
                                            <p className="text-[11px] text-slate-500 leading-relaxed">{milestone.description}</p>
                                            {catColor && (
                                                <div className={`flex gap-1 mt-2 ${isLeft ? 'justify-start md:justify-end' : 'justify-start'}`}>
                                                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${catColor.bg} ${catColor.text} ${catColor.border}`}>
                                                        {milestone.categoryKey.replace(/_/g, ' ')}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Center dot */}
                                    <div className="absolute left-6 md:left-1/2 md:-translate-x-1/2 flex items-center justify-center">
                                        <div className={`w-3 h-3 rounded-full ${dotColor} ring-4 ring-[#0A1110] shadow-lg z-10`} />
                                    </div>

                                    {/* Spacer for alternating side */}
                                    <div className="hidden md:block md:w-[45%]" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}
