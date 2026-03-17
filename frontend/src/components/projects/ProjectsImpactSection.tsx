'use client';

import { useTranslations } from 'next-intl';
import { Leaf, MapPin, Home, TreePine, Zap, Droplets, ChevronRight } from 'lucide-react';
import { greenProjects } from '@/mock/datas/projectsMock';
import { ProjectCategory, ProjectCategoryLabel, ProjectCategoryColor } from '@/domain/project/projectConstants';

// ── Aggregate totals ──────────────────────────────────────────────────────
const totalCo2 = greenProjects.reduce((sum, p) => sum + p.co2ImpactTons, 0);
const totalHa = greenProjects.reduce((sum, p) => sum + p.areaHa, 0);
const totalJobs = greenProjects.reduce((sum, p) => sum + p.jobsCreated, 0);

// Unique SDGs across all projects
const allSdgs = Array.from(new Set(greenProjects.flatMap((p) => p.sdgGoals))).sort((a, b) => a - b);

// CO₂ per category
const CO2_BY_CATEGORY: { category: ProjectCategory; tons: number }[] = [
    ProjectCategory.CARBON_FORESTRY,
    ProjectCategory.BLUE_CARBON,
    ProjectCategory.CLEAN_ENERGY,
    ProjectCategory.CARBON_TAX_POLICY,
    ProjectCategory.ADAPTATION,
].map((category) => ({
    category,
    tons: greenProjects.filter((p) => p.category === category).reduce((s, p) => s + p.co2ImpactTons, 0),
})).filter((c) => c.tons > 0);

const maxCo2 = Math.max(...CO2_BY_CATEGORY.map((c) => c.tons));

const IMPACT_STATS = [
    {
        key: 'impact_co2_sequestered',
        value: `${(totalCo2 / 1_000_000).toFixed(1)}M tCO₂e`,
        icon: Leaf,
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
    },
    {
        key: 'impact_area_protected',
        value: `${(totalHa / 1_000).toFixed(0)}k ha`,
        icon: MapPin,
        color: 'text-teal-400',
        bg: 'bg-teal-500/10',
    },
    {
        key: 'impact_households',
        value: '28,500',
        icon: Home,
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
    },
    {
        key: 'impact_species',
        value: '6',
        icon: TreePine,
        color: 'text-green-400',
        bg: 'bg-green-500/10',
    },
];

export function ProjectsImpactSection() {
    const t = useTranslations('Projects');

    return (
        <section className="py-16 px-6" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-4">
                        {t('impact_badge')}
                    </div>
                    <h2 className="text-3xl font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>{t('impact_title')}</h2>
                    <p className="text-sm max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>{t('impact_subtitle')}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Impact KPI cards */}
                    <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            {IMPACT_STATS.map(({ key, value, icon: Icon, color, bg }) => (
                                <div
                                    key={key}
                                    className="rounded-2xl p-5 hover:border-emerald-500/15 transition-all duration-300"
                                    style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                                >
                                    <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                                        <Icon className={`w-5 h-5 ${color}`} />
                                    </div>
                                    <p className={`text-2xl font-bold ${color} mb-1`}>{value}</p>
                                    <p className="text-xs" style={{ color: 'var(--ais-page-text-dim)' }}>{t(key)}</p>
                                </div>
                            ))}
                        </div>

                        {/* SDG Goals covered */}
                        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <p className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>UN SDGs Covered</p>
                            <div className="flex flex-wrap gap-2">
                                {allSdgs.map((sdg) => (
                                    <span
                                        key={sdg}
                                        className="w-8 h-8 rounded-lg text-sm font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center"
                                    >
                                        {sdg}
                                    </span>
                                ))}
                            </div>
                            <p className="text-[11px] mt-3" style={{ color: 'var(--ais-page-text-dim)' }}>
                                {allSdgs.length} Sustainable Development Goals addressed across the sovereign project portfolio.
                            </p>
                        </div>
                    </div>

                    {/* Right: CO₂ by category bar chart */}
                    <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                        <p className="text-sm font-bold mb-6" style={{ color: 'var(--ais-page-text)' }}>{t('by_category_title')}</p>
                        <div className="flex flex-col gap-5">
                            {CO2_BY_CATEGORY.map(({ category, tons }) => {
                                const catColor = ProjectCategoryColor[category];
                                const pct = maxCo2 > 0 ? Math.round((tons / maxCo2) * 100) : 0;
                                const label = tons >= 1_000_000
                                    ? `${(tons / 1_000_000).toFixed(1)}M t`
                                    : `${(tons / 1_000).toFixed(0)}k t`;

                                return (
                                    <div key={category}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${catColor.bg} border ${catColor.border}`} />
                                                <span className="text-xs" style={{ color: 'var(--ais-page-text-muted)' }}>{ProjectCategoryLabel[category]}</span>
                                            </div>
                                            <span className={`text-xs font-bold ${catColor.text}`}>{label}</span>
                                        </div>
                                        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-700 ${catColor.bg} border-0`}
                                                style={{
                                                    width: `${pct}%`,
                                                    background: `linear-gradient(to right, var(--tw-gradient-from, rgba(16,185,129,0.6)), var(--tw-gradient-to, rgba(20,184,166,0.4)))`,
                                                }}
                                            >
                                                <div
                                                    className={`h-full w-full rounded-full ${catColor.bg.replace('/15', '/50')}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--ais-page-border)' }}>
                            <div className="flex items-center justify-between">
                                <span className="text-xs" style={{ color: 'var(--ais-page-text-dim)' }}>Total Portfolio CO₂ Impact</span>
                                <span className="text-sm font-bold text-emerald-400">
                                    {(totalCo2 / 1_000_000).toFixed(2)}M tCO₂e
                                </span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-xs" style={{ color: 'var(--ais-page-text-dim)' }}>Jobs (direct & indirect)</span>
                                <span className="text-sm font-bold text-teal-400">{totalJobs.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
