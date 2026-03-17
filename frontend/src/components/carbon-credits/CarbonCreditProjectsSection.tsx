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
        <section className="py-16 px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('projects_badge')}
                    </div>
                    <h2 className="text-3xl font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>{t('projects_title')}</h2>
                    <p className="text-sm max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>{t('projects_subtitle')}</p>
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
                                className="rounded-2xl hover:border-emerald-500/20 transition-all duration-300 overflow-hidden flex flex-col"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
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

                                    <h3 className="text-sm font-bold leading-snug" style={{ color: 'var(--ais-page-text)' }}>
                                        {project.name}
                                    </h3>

                                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ais-page-text-dim)' }}>
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

                                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                                        {project.description}
                                    </p>
                                </div>

                                {/* Stats Row */}
                                <div className="grid grid-cols-3" style={{ borderTop: '1px solid var(--ais-page-border)' }}>
                                    <div className="p-3 text-center" style={{ borderRight: '1px solid var(--ais-page-border)' }}>
                                        <p className="text-sm font-bold" style={{ color: 'var(--ais-page-text)' }}>
                                            {project.areaHa > 0
                                                ? `${(project.areaHa / 1000).toFixed(0)}k ha`
                                                : '—'}
                                        </p>
                                        <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--ais-page-text-dim)' }}>
                                            {t('project_area')}
                                        </p>
                                    </div>
                                    <div className="p-3 text-center" style={{ borderRight: '1px solid var(--ais-page-border)' }}>
                                        <p className="text-sm font-bold" style={{ color: 'var(--ais-page-text)' }}>
                                            {(project.creditsGenerated / 1000).toFixed(0)}k
                                        </p>
                                        <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--ais-page-text-dim)' }}>
                                            {t('project_credits_yr')}
                                        </p>
                                    </div>
                                    <div className="p-3 text-center">
                                        <p className="text-sm font-bold text-teal-400">
                                            ${project.pricePerTon.toFixed(1)}
                                        </p>
                                        <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--ais-page-text-dim)' }}>
                                            {t('project_price')}
                                        </p>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="px-5 pb-5 pt-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px]" style={{ color: 'var(--ais-page-text-dim)' }}>{t('project_progress')}</span>
                                        <span className="text-[10px] font-bold" style={{ color: 'var(--ais-page-text)' }}>{project.progressPct}%</span>
                                    </div>
                                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 rounded-full transition-all duration-700"
                                            style={{ width: `${project.progressPct}%` }}
                                        />
                                    </div>
                                    {/* SDG Goals */}
                                    <div className="flex items-center gap-1.5 mt-3">
                                        <span className="text-[10px]" style={{ color: 'var(--ais-page-text-dim)' }}>SDG:</span>
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
