'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin, Calendar, Users, Leaf, Target, Building2, CheckCircle, ExternalLink } from 'lucide-react';
import { greenProjects } from '@/mock/datas/projectsMock';
import {
    ProjectPhaseLabel,
    ProjectPhaseColor,
    ProjectCategoryLabel,
    ProjectCategoryColor,
    FundingStatusLabel,
    FundingStatusColor,
} from '@/domain/project/projectConstants';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';

function formatUsd(amount: number): string {
    if (amount === 0) return '—';
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`;
    return `$${amount.toLocaleString()}`;
}

export function ProjectDetailPage({ id }: { id: string }) {
    const t = useTranslations('Projects');
    const project = greenProjects.find((p) => p.id === id);

    if (!project) {
        return (
            <main className="min-h-screen bg-[#0A1110] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-500/10 flex items-center justify-center mb-6">
                    <Target className="w-8 h-8 text-slate-500" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-4">{t('project_not_found')}</h1>
                <Link
                    href="/projects"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                >
                    <ArrowLeft className="w-4 h-4" />
                    {t('back_to_projects')}
                </Link>
            </main>
        );
    }

    const phaseColor = ProjectPhaseColor[project.phase];
    const catColor = ProjectCategoryColor[project.category];
    const fundColor = FundingStatusColor[project.fundingStatus];
    const fundPct = project.budgetUsd > 0 ? Math.round((project.fundedUsd / project.budgetUsd) * 100) : 0;

    return (
        <main className="min-h-screen bg-[#0A1110] flex flex-col">
            <Navbar activePage="projects" />

            {/* Content wrapper */}
            <div className="flex-1 pb-20">
                {/* Header Section */}
                <section className="relative pt-28 pb-12 px-6 bg-[#0B1512] border-b border-white/5 overflow-hidden">
                    <div className="absolute top-0 right-1/4 w-[600px] h-[400px] bg-emerald-900/10 rounded-full blur-[150px] pointer-events-none" />

                    <div className="max-w-4xl mx-auto relative z-10">
                        {/* Back Link */}
                        <Link
                            href="/projects"
                            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400 mb-8 transition-colors group"
                        >
                            <div className="w-8 h-8 rounded-full bg-slate-500/10 group-hover:bg-emerald-500/20 flex items-center justify-center transition-colors">
                                <ArrowLeft className="w-4 h-4" />
                            </div>
                            {t('back_to_projects')}
                        </Link>

                        {/* Title & Badges */}
                        <div className="flex flex-wrap items-center gap-3 mb-6">
                            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${phaseColor.bg} ${phaseColor.text} ${phaseColor.border}`}>
                                {ProjectPhaseLabel[project.phase]}
                            </span>
                            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${catColor.bg} ${catColor.text} ${catColor.border}`}>
                                {ProjectCategoryLabel[project.category]}
                            </span>
                            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${fundColor.bg} ${fundColor.text} ${fundColor.border}`}>
                                {FundingStatusLabel[project.fundingStatus]}
                            </span>
                        </div>

                        <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-6">
                            {project.name}
                        </h1>

                        <div className="flex flex-wrap items-center gap-6 text-sm text-slate-400">
                            <div className="flex items-center gap-2">
                                <MapPin className="w-4 h-4 text-emerald-400" />
                                <span>{project.location}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-teal-400" />
                                <span>{project.startDate} {project.endDate ? `— ${project.endDate}` : '(Ongoing)'}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Details Grid */}
                <section className="px-6 py-12">
                    <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
                        {/* Main Content */}
                        <div className="md:col-span-2 space-y-10">
                            {/* Overview */}
                            <div>
                                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <Target className="w-5 h-5 text-emerald-500" />
                                    {t('project_overview')}
                                </h2>
                                <p className="text-slate-400 text-sm leading-relaxed whitespace-pre-line bg-[#111C18] p-6 rounded-2xl border border-white/5">
                                    {project.description}
                                </p>
                            </div>

                            {/* Impact & KPIs */}
                            <div>
                                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                    <Leaf className="w-5 h-5 text-teal-500" />
                                    {t('project_impact')}
                                </h2>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-[#111C18] p-5 rounded-2xl border border-white/5">
                                        <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center mb-3">
                                            <Leaf className="w-5 h-5 text-teal-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white mb-1">
                                            {project.co2ImpactTons === 0 ? 'TBD' : project.co2ImpactTons.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-slate-500">{t('project_co2')} (tCO₂e)</p>
                                    </div>
                                    <div className="bg-[#111C18] p-5 rounded-2xl border border-white/5">
                                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3">
                                            <Users className="w-5 h-5 text-emerald-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white mb-1">
                                            {project.jobsCreated.toLocaleString()}
                                        </p>
                                        <p className="text-xs text-slate-500">{t('project_jobs')}</p>
                                    </div>
                                    <div className="bg-[#111C18] p-5 rounded-2xl border border-white/5">
                                        <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center mb-3">
                                            <MapPin className="w-5 h-5 text-green-400" />
                                        </div>
                                        <p className="text-2xl font-bold text-white mb-1">
                                            {project.areaHa > 0 ? `${project.areaHa.toLocaleString()} ha` : 'N/A'}
                                        </p>
                                        <p className="text-xs text-slate-500">{t('impact_area_protected')}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-8">
                            {/* Financials & Progress */}
                            <div className="bg-[#111C18] rounded-2xl border border-white/5 p-6">
                                <h3 className="text-sm font-bold text-white mb-5 uppercase tracking-wide">
                                    {t('project_financials')}
                                </h3>

                                <div className="mb-6">
                                    <p className="text-3xl font-bold text-white mb-1">{formatUsd(project.budgetUsd)}</p>
                                    <p className="text-xs text-slate-500">{t('project_budget')}</p>
                                </div>

                                <div className="space-y-5">
                                    {/* Implementation */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs text-slate-400">{t('project_progress')}</span>
                                            <span className="text-xs font-bold text-white">{project.progressPct}%</span>
                                        </div>
                                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                                                style={{ width: `${project.progressPct}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Funding */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs text-slate-400">{t('project_funded')}</span>
                                            <span className="text-xs font-bold text-white">{fundPct}%</span>
                                        </div>
                                        <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-2">
                                            <div
                                                className="h-full bg-gradient-to-r from-yellow-500 to-emerald-400 rounded-full"
                                                style={{ width: `${fundPct}%` }}
                                            />
                                        </div>
                                        <p className="text-[10px] text-right text-emerald-400 font-semibold">
                                            {formatUsd(project.fundedUsd)} / {formatUsd(project.budgetUsd)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Partners & SDGs */}
                            <div className="bg-[#111C18] rounded-2xl border border-white/5 p-6">
                                <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wide">
                                    {t('project_partners')}
                                </h3>
                                <ul className="space-y-3 mb-8">
                                    {project.partners.map((partner, idx) => (
                                        <li key={idx} className="flex items-start gap-3">
                                            <Building2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                            <span className="text-sm text-slate-300">{partner}</span>
                                        </li>
                                    ))}
                                </ul>

                                <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wide">UN SDGs</h3>
                                <div className="flex flex-wrap gap-2 mb-8">
                                    {project.sdgGoals.map((sdg) => (
                                        <span
                                            key={sdg}
                                            className="w-8 h-8 rounded-lg text-sm font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center cursor-help"
                                            title={`Sustainable Development Goal ${sdg}`}
                                        >
                                            {sdg}
                                        </span>
                                    ))}
                                </div>

                                {project.certificationTarget && (
                                    <>
                                        <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-wide">
                                            {t('project_certification')}
                                        </h3>
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                            {project.certificationTarget}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <Footer />
        </main>
    );
}
