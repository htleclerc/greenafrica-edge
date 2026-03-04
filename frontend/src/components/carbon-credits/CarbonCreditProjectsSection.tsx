'use client';

import { useTranslations } from 'next-intl';
import { MapPin, TreePine, Droplets, Flame, Zap, TreeDeciduous } from 'lucide-react';
import { carbonProjects } from '@/mock/datas/carbonCreditMock';
import {
    ProjectTypeLabel,
    ProjectTypeColor,
    CreditStandardLabel,
    CreditStandardColor,
    CreditStatusLabel,
    CreditStatusColor,
} from '@/domain/carbonCredit/carbonCreditConstants';

const PROJECT_TYPE_ICONS = {
    REFORESTATION: TreePine,
    MANGROVE: Droplets,
    CLEAN_COOKING: Flame,
    BLUE_CARBON: Droplets,
    RENEWABLE_ENERGY: Zap,
    AVOIDED_DEFORESTATION: TreeDeciduous,
};

export function CarbonCreditProjectsSection() {
    const t = useTranslations('CarbonCredit');

    return (
        <section className="py-16 px-6 bg-[#0A1110]">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('projects_badge')}
                    </div>
                    <h2 className="text-3xl font-bold text-white mb-3">{t('projects_title')}</h2>
                    <p className="text-slate-400 text-sm max-w-2xl">{t('projects_subtitle')}</p>
                </div>

                {/* Projects Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
                    {carbonProjects.map((project) => {
                        const typeColor = ProjectTypeColor[project.type];
                        const stdColor = CreditStandardColor[project.standard];
                        const statusColor = CreditStatusColor[project.status];
                        const TypeIcon = PROJECT_TYPE_ICONS[project.type] ?? TreePine;

                        return (
                            <div
                                key={project.id}
                                className="bg-[#111C18] rounded-2xl border border-white/5 hover:border-emerald-500/20 transition-all duration-300 overflow-hidden flex flex-col"
                            >
                                {/* Card header */}
                                <div className="p-5 flex flex-col gap-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div
                                            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${typeColor.bg} border ${typeColor.border}`}
                                        >
                                            <TypeIcon className={`w-4.5 h-4.5 w-[18px] h-[18px] ${typeColor.text}`} />
                                        </div>
                                        <span
                                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${statusColor.bg} ${statusColor.text} ${statusColor.border}`}
                                        >
                                            {CreditStatusLabel[project.status]}
                                        </span>
                                    </div>

                                    <h3 className="text-sm font-bold text-white leading-snug">
                                        {project.name}
                                    </h3>

                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                        <MapPin className="w-3 h-3 shrink-0" />
                                        <span>{project.location}</span>
                                    </div>

                                    {/* Standards badges */}
                                    <div className="flex flex-wrap gap-2">
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${typeColor.bg} ${typeColor.text} ${typeColor.border}`}>
                                            {ProjectTypeLabel[project.type]}
                                        </span>
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${stdColor.bg} ${stdColor.text} ${stdColor.border}`}>
                                            {CreditStandardLabel[project.standard]}
                                        </span>
                                    </div>

                                    <p className="text-[11px] text-slate-500 leading-relaxed">
                                        {project.description}
                                    </p>
                                </div>

                                {/* Stats Row */}
                                <div className="grid grid-cols-3 border-t border-white/5">
                                    <div className="p-3 text-center border-r border-white/5">
                                        <p className="text-sm font-bold text-white">
                                            {project.areaHa > 0
                                                ? `${(project.areaHa / 1000).toFixed(0)}k ha`
                                                : '—'}
                                        </p>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">
                                            {t('project_area')}
                                        </p>
                                    </div>
                                    <div className="p-3 text-center border-r border-white/5">
                                        <p className="text-sm font-bold text-white">
                                            {(project.creditsGenerated / 1000).toFixed(0)}k
                                        </p>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">
                                            {t('project_credits_yr')}
                                        </p>
                                    </div>
                                    <div className="p-3 text-center">
                                        <p className="text-sm font-bold text-teal-400">
                                            ${project.pricePerTon.toFixed(1)}
                                        </p>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">
                                            {t('project_price')}
                                        </p>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="px-5 pb-5 pt-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] text-slate-500">{t('project_progress')}</span>
                                        <span className="text-[10px] font-bold text-white">{project.progressPct}%</span>
                                    </div>
                                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-700"
                                            style={{ width: `${project.progressPct}%` }}
                                        />
                                    </div>
                                    {/* SDG Goals */}
                                    <div className="flex items-center gap-1.5 mt-3">
                                        <span className="text-[10px] text-slate-600">SDG:</span>
                                        {project.sdgGoals.map((sdg) => (
                                            <span
                                                key={sdg}
                                                className="w-5 h-5 rounded text-[9px] font-bold bg-teal-500/20 text-teal-400 flex items-center justify-center"
                                            >
                                                {sdg}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
