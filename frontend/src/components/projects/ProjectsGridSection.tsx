'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Calendar, Users, Leaf, CheckCircle, ArrowRight } from 'lucide-react';
import { greenProjects } from '@/mock/datas/projectsMock';
import {
    ProjectPhase,
    ProjectPhaseLabel,
    ProjectPhaseColor,
    ProjectCategoryLabel,
    ProjectCategoryColor,
    FundingStatusLabel,
    FundingStatusColor,
} from '@/domain/project/projectConstants';

const FILTER_KEYS = [
    { key: 'filter_all', phase: null },
    { key: 'filter_active', phase: ProjectPhase.ACTIVE },
    { key: 'filter_upcoming', phase: ProjectPhase.UPCOMING },
    { key: 'filter_preparation', phase: ProjectPhase.PREPARATION },
    { key: 'filter_completed', phase: ProjectPhase.COMPLETED },
] as const;

function formatUsd(amount: number): string {
    if (amount === 0) return '—';
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
    return `$${amount}`;
}

function formatCo2(tons: number): string {
    if (tons === 0) return '—';
    if (tons >= 1_000_000) return `${(tons / 1_000_000).toFixed(1)}M t`;
    if (tons >= 1_000) return `${(tons / 1_000).toFixed(0)}k t`;
    return `${tons} t`;
}

export function ProjectsGridSection() {
    const t = useTranslations('Projects');
    const [activeFilter, setActiveFilter] = useState<ProjectPhase | null>(null);

    const filtered = activeFilter
        ? greenProjects.filter((p) => p.phase === activeFilter)
        : greenProjects;

    return (
        <section className="py-16 px-6 bg-[#0B1512]">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('grid_badge')}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2">{t('grid_title')}</h2>
                            <p className="text-slate-400 text-sm max-w-2xl">{t('grid_subtitle')}</p>
                        </div>
                        {/* Filter tabs */}
                        <div className="flex flex-wrap gap-2 shrink-0">
                            {FILTER_KEYS.map(({ key, phase }) => (
                                <button
                                    key={key}
                                    onClick={() => setActiveFilter(phase)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${activeFilter === phase
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                        : 'bg-white/5 text-slate-400 border border-white/5 hover:text-white hover:bg-white/8'
                                        }`}
                                >
                                    {t(key)}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Project Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filtered.map((project) => {
                        const phaseColor = ProjectPhaseColor[project.phase];
                        const catColor = ProjectCategoryColor[project.category];
                        const fundColor = FundingStatusColor[project.fundingStatus];
                        const fundPct =
                            project.budgetUsd > 0
                                ? Math.round((project.fundedUsd / project.budgetUsd) * 100)
                                : 0;

                        return (
                            <Link
                                href={`/projects/${project.id}`}
                                key={project.id}
                                className={`bg-[#111C18] rounded-2xl border transition-all duration-300 overflow-hidden flex flex-col group cursor-pointer ${project.isHighlight
                                        ? 'border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.06)]'
                                        : 'border-white/5 hover:border-emerald-500/30'
                                    }`}
                            >
                                {/* Highlight ribbon */}
                                {project.isHighlight && (
                                    <div className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-transparent" />
                                )}

                                <div className="p-5 flex flex-col gap-3 flex-1">
                                    {/* Top row: phase badge + funding badge */}
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${phaseColor.bg} ${phaseColor.text} ${phaseColor.border}`}>
                                            {ProjectPhaseLabel[project.phase]}
                                        </span>
                                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${fundColor.bg} ${fundColor.text} ${fundColor.border}`}>
                                            {FundingStatusLabel[project.fundingStatus]}
                                        </span>
                                    </div>

                                    {/* Name */}
                                    <h3 className="text-sm font-bold text-white leading-snug group-hover:text-emerald-400 transition-colors duration-300 flex justify-between items-start gap-2">
                                        <span>{project.name}</span>
                                        <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-emerald-400 shrink-0 mt-0.5" />
                                    </h3>

                                    {/* Location */}
                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                        <MapPin className="w-3 h-3 shrink-0" />
                                        <span>{project.location}</span>
                                    </div>

                                    {/* Category + Certification badges */}
                                    <div className="flex flex-wrap gap-1.5">
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${catColor.bg} ${catColor.text} ${catColor.border}`}>
                                            {ProjectCategoryLabel[project.category]}
                                        </span>
                                        {project.certificationTarget && (
                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-500/10 text-slate-400 border-slate-500/20">
                                                {project.certificationTarget}
                                            </span>
                                        )}
                                    </div>

                                    {/* Description */}
                                    <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-3">
                                        {project.description}
                                    </p>

                                    {/* Period + CO₂ + Jobs */}
                                    <div className="grid grid-cols-3 gap-1 pt-1">
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                                <Calendar className="w-3 h-3" />
                                                <span className="truncate">{project.startDate.slice(0, 7)}</span>
                                            </div>
                                            <span className="text-[9px] text-slate-600 uppercase tracking-wide">Period</span>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1 text-[10px] text-teal-400">
                                                <Leaf className="w-3 h-3" />
                                                <span>{formatCo2(project.co2ImpactTons)}</span>
                                            </div>
                                            <span className="text-[9px] text-slate-600 uppercase tracking-wide">CO₂</span>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                                                <Users className="w-3 h-3" />
                                                <span>{project.jobsCreated.toLocaleString()}</span>
                                            </div>
                                            <span className="text-[9px] text-slate-600 uppercase tracking-wide">Jobs</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Stats row */}
                                <div className="grid grid-cols-2 border-t border-white/5">
                                    <div className="p-3 text-center border-r border-white/5">
                                        <p className="text-sm font-bold text-white">{formatUsd(project.budgetUsd)}</p>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">{t('project_budget')}</p>
                                    </div>
                                    <div className="p-3 text-center">
                                        <p className="text-sm font-bold text-emerald-400">{formatUsd(project.fundedUsd)}</p>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">{t('project_funded')}</p>
                                    </div>
                                </div>

                                {/* Progress */}
                                <div className="px-5 pb-5 pt-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] text-slate-500">{t('project_progress')}</span>
                                        <span className="text-[10px] font-bold text-white">{project.progressPct}%</span>
                                    </div>
                                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mb-3">
                                        <div
                                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-700"
                                            style={{ width: `${project.progressPct}%` }}
                                        />
                                    </div>
                                    {/* Funding progress */}
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-[10px] text-slate-600">Funding secured</span>
                                        <span className="text-[10px] font-semibold text-slate-400">{fundPct}%</span>
                                    </div>
                                    <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-3">
                                        <div
                                            className="h-full bg-gradient-to-r from-yellow-500 to-emerald-400 rounded-full transition-all duration-700"
                                            style={{ width: `${fundPct}%` }}
                                        />
                                    </div>
                                    {/* SDG Goals */}
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-slate-600">SDG:</span>
                                        {project.sdgGoals.map((sdg) => (
                                            <span
                                                key={sdg}
                                                className="w-5 h-5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 flex items-center justify-center"
                                            >
                                                {sdg}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </Link>
                        );
                    })}
                </div>

                {filtered.length === 0 && (
                    <div className="text-center py-20 text-slate-500">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="text-sm">No projects match this filter.</p>
                    </div>
                )}
            </div>
        </section>
    );
}
