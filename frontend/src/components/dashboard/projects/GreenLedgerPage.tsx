'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Leaf, Search, Filter, TrendingUp, Award, BarChart2,
    MapPin, Calendar, CheckCircle2, Clock, AlertTriangle,
    XCircle, ChevronDown, ChevronUp, ExternalLink, Download,
    Zap, Wind, Sun, Sprout, Waves, Flame,
} from 'lucide-react';
import { useCarbonProjects } from '@/hooks/useCarbonProjects';
import {
    CarbonProject, ProjectStatus, ProjectType, VerificationStandard,
} from '@/types/secure';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
    return n.toLocaleString('fr-FR');
}
function fmtUsd(n: number) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
}

// ── Status config ─────────────────────────────────────────────────────────────

function useStatusConfig() {
    const t = useTranslations('GreenLedgerPage');
    return {
        [ProjectStatus.ACTIVE]:     { label: t('status_active'),    color: '#22C55E', bg: 'rgba(34,197,94,0.1)',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
        [ProjectStatus.PENDING]:    { label: t('status_pending'),   color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  icon: <Clock className="w-3.5 h-3.5" /> },
        [ProjectStatus.REVIEW]:     { label: t('status_review'),    color: '#38BDF8', bg: 'rgba(56,189,248,0.1)',  icon: <AlertTriangle className="w-3.5 h-3.5" /> },
        [ProjectStatus.COMPLETED]:  { label: t('status_completed'), color: '#A3A3A3', bg: 'rgba(163,163,163,0.1)', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
        [ProjectStatus.SUSPENDED]:  { label: t('status_suspended'), color: '#EF4444', bg: 'rgba(239,68,68,0.1)',   icon: <XCircle className="w-3.5 h-3.5" /> },
    } as Record<ProjectStatus, { label: string; color: string; bg: string; icon: React.ReactNode }>;
}

function useTypeConfig() {
    const t = useTranslations('GreenLedgerPage');
    return {
        [ProjectType.BLUE_CARBON]:        { label: t('type_blue_carbon'),       color: '#38BDF8', icon: <Waves className="w-4 h-4" /> },
        [ProjectType.REFORESTATION]:      { label: t('type_reforestation'),     color: '#22C55E', icon: <Sprout className="w-4 h-4" /> },
        [ProjectType.SOLAR]:              { label: t('type_solar'),             color: '#F59E0B', icon: <Sun className="w-4 h-4" /> },
        [ProjectType.WIND]:               { label: t('type_wind'),              color: '#818CF8', icon: <Wind className="w-4 h-4" /> },
        [ProjectType.METHANE_CAPTURE]:    { label: t('type_methane_capture'),   color: '#F97316', icon: <Flame className="w-4 h-4" /> },
        [ProjectType.ENERGY_EFFICIENCY]:  { label: t('type_energy_efficiency'), color: '#A3A3A3', icon: <Zap className="w-4 h-4" /> },
    } as Record<ProjectType, { label: string; color: string; icon: React.ReactNode }>;
}

function useStdLabels() {
    const t = useTranslations('GreenLedgerPage');
    return {
        [VerificationStandard.VERRA_VCS]:     t('std_verra_vcs'),
        [VerificationStandard.GOLD_STANDARD]: t('std_gold_standard'),
        [VerificationStandard.IMO_DCS]:       t('std_imo_dcs'),
        [VerificationStandard.PENDING]:       t('std_pending'),
    } as Record<VerificationStandard, string>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProjectStatus }) {
    const statusConfig = useStatusConfig();
    const cfg = statusConfig[status];
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{ color: cfg.color, backgroundColor: cfg.bg }}
        >
            {cfg.icon}
            {cfg.label}
        </span>
    );
}

function TypeBadge({ type }: { type: ProjectType }) {
    const typeConfig = useTypeConfig();
    const cfg = typeConfig[type];
    return (
        <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{ color: cfg.color, backgroundColor: `${cfg.color}18` }}
        >
            {cfg.icon}
            {cfg.label}
        </span>
    );
}

function SdgPill({ n }: { n: number }) {
    const t = useTranslations('GreenLedgerPage');
    return (
        <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#10B981' }}
        >
            {t('sdg_label', { number: n })}
        </span>
    );
}

// ── KPI Row ───────────────────────────────────────────────────────────────────

function KpiRow({ projects }: { projects: CarbonProject[] }) {
    const t = useTranslations('GreenLedgerPage');
    const totalCredits  = projects.reduce((s, p) => s + p.creditsIssuedTotal, 0);
    const totalRetired  = projects.reduce((s, p) => s + p.creditsRetiredTotal, 0);
    const totalAvail    = projects.reduce((s, p) => s + p.creditsAvailable, 0);
    const totalValue    = projects.reduce((s, p) => s + p.totalValueUsd, 0);
    const active        = projects.filter((p) => p.status === ProjectStatus.ACTIVE).length;

    const kpis = [
        { label: t('kpi_active_projects'),  value: String(active),         sub: t('kpi_of_total', { total: projects.length }),   color: '#22C55E', icon: <Leaf className="w-5 h-5" /> },
        { label: t('kpi_credits_issued'),   value: fmt(totalCredits),      sub: t('kpi_tco2e_total'),                            color: '#10B981', icon: <Award className="w-5 h-5" /> },
        { label: t('kpi_credits_retired'),  value: fmt(totalRetired),      sub: t('kpi_percent_of_total', { percent: ((totalRetired/totalCredits||0)*100).toFixed(0) }), color: '#38BDF8', icon: <CheckCircle2 className="w-5 h-5" /> },
        { label: t('kpi_available'),        value: fmt(totalAvail),        sub: t('kpi_tco2e_for_sale'),                         color: '#F59E0B', icon: <TrendingUp className="w-5 h-5" /> },
        { label: t('kpi_market_value'),     value: fmtUsd(totalValue),     sub: t('kpi_total_portfolio'),                        color: '#818CF8', icon: <BarChart2 className="w-5 h-5" /> },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {kpis.map((k) => (
                <div
                    key={k.label}
                    className="rounded-2xl p-4 flex flex-col gap-1"
                    style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                >
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                            {k.label}
                        </span>
                        <span style={{ color: k.color }}>{k.icon}</span>
                    </div>
                    <span className="text-2xl font-bold" style={{ color: 'var(--os-text-primary)' }}>{k.value}</span>
                    <span className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>{k.sub}</span>
                </div>
            ))}
        </div>
    );
}

// ── Project Card (expandable) ─────────────────────────────────────────────────

function ProjectCard({ project }: { project: CarbonProject }) {
    const t = useTranslations('GreenLedgerPage');
    const typeConfig = useTypeConfig();
    const stdLabels = useStdLabels();
    const [open, setOpen] = React.useState(false);
    const typeCfg  = typeConfig[project.type];
    const retired  = project.creditsIssuedTotal > 0
        ? Math.round((project.creditsRetiredTotal / project.creditsIssuedTotal) * 100)
        : 0;

    return (
        <div
            className="rounded-2xl overflow-hidden transition-all"
            style={{
                backgroundColor: 'var(--os-surface)',
                border: `1px solid ${open ? 'rgba(16,185,129,0.3)' : 'var(--os-border)'}`,
            }}
        >
            {/* Header row */}
            <button
                className="w-full text-left px-5 py-4 flex items-start gap-4"
                onClick={() => setOpen((v) => !v)}
            >
                {/* Type icon bubble */}
                <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: `${typeCfg.color}18`, color: typeCfg.color }}
                >
                    {typeCfg.icon}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>
                            {project.name}
                        </span>
                        <StatusBadge status={project.status} />
                        <TypeBadge type={project.type} />
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs" style={{ color: 'var(--os-text-muted)' }}>
                        <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" /> {project.locationName}
                        </span>
                        <span className="flex items-center gap-1">
                            <Award className="w-3.5 h-3.5" /> {stdLabels[project.verificationStandard]}
                        </span>
                        <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> {t('since_date', { date: project.startDate.slice(0, 7) })}
                        </span>
                    </div>
                </div>

                {/* Right summary */}
                <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-sm font-bold" style={{ color: '#10B981' }}>
                        {fmt(project.creditsAvailable)} <span className="text-xs font-normal" style={{ color: 'var(--os-text-muted)' }}>{t('credits_available')}</span>
                    </span>
                    <span className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                        {fmtUsd(project.pricePerCreditUsd * project.creditsAvailable)} {t('value_label')}
                    </span>
                </div>

                <div className="flex-shrink-0 mt-1" style={{ color: 'var(--os-text-muted)' }}>
                    {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </button>

            {/* Expanded details */}
            {open && (
                <div
                    className="px-5 pb-5 border-t"
                    style={{ borderColor: 'var(--os-border)' }}
                >
                    <p className="text-xs leading-relaxed mt-4 mb-5" style={{ color: 'var(--os-text-muted)' }}>
                        {project.description}
                    </p>

                    {/* Metrics grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-5">
                        {[
                            { label: t('metric_area'),             value: project.areaHectares > 0 ? `${fmt(project.areaHectares)} ha` : '—' },
                            { label: t('metric_tco2_per_year'),    value: fmt(project.estimatedTco2PerYear) },
                            { label: t('metric_credits_issued'),   value: fmt(project.creditsIssuedTotal) },
                            { label: t('metric_credits_retired'),  value: `${fmt(project.creditsRetiredTotal)} (${retired}%)` },
                            { label: t('metric_price_per_credit'), value: `$${project.pricePerCreditUsd}` },
                            { label: t('metric_total_value'),      value: fmtUsd(project.totalValueUsd) },
                            { label: t('metric_funding'),          value: fmtUsd(project.fundingUsd) },
                            { label: t('metric_operator'),         value: project.operatorName },
                        ].map((m) => (
                            <div
                                key={m.label}
                                className="rounded-xl p-3"
                                style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                            >
                                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--os-text-muted)' }}>
                                    {m.label}
                                </p>
                                <p className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>{m.value}</p>
                            </div>
                        ))}
                    </div>

                    {/* Retired progress bar */}
                    {project.creditsIssuedTotal > 0 && (
                        <div className="mb-5">
                            <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--os-text-muted)' }}>
                                <span>{t('kpi_credits_retired')}</span>
                                <span>{retired}% — {fmt(project.creditsRetiredTotal)} / {fmt(project.creditsIssuedTotal)} tCO₂e</span>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--os-surface-2)' }}>
                                <div
                                    className="h-full rounded-full"
                                    style={{ width: `${retired}%`, backgroundColor: '#10B981' }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Footer row */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-1.5">
                            {project.sdgGoals.map((n) => <SdgPill key={n} n={n} />)}
                        </div>
                        <div className="flex items-center gap-2">
                            {project.lastVerifiedAt && (
                                <span className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('verified_on', { date: project.lastVerifiedAt })}
                                </span>
                            )}
                            <button
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10B981', border: '1px solid rgba(16,185,129,0.2)' }}
                            >
                                <Download className="w-3.5 h-3.5" />
                                {t('report')}
                            </button>
                            <button
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-primary)', border: '1px solid var(--os-border)' }}
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                {t('details')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function GreenLedgerPage() {
    const t = useTranslations('GreenLedgerPage');
    const { data: carbonProjects } = useCarbonProjects();
    const typeConfig = useTypeConfig();
    const [search, setSearch]           = React.useState('');
    const [statusFilter, setStatus]     = React.useState('ALL');
    const [typeFilter, setType]         = React.useState('ALL');

    const STATUS_FILTERS = [
        { key: 'ALL',                         label: t('filter_all') },
        { key: ProjectStatus.ACTIVE,          label: t('filter_active') },
        { key: ProjectStatus.PENDING,         label: t('filter_pending') },
        { key: ProjectStatus.REVIEW,          label: t('filter_review') },
        { key: ProjectStatus.COMPLETED,       label: t('filter_completed') },
    ];

    const TYPE_FILTERS = [
        { key: 'ALL',                           label: t('filter_all_types') },
        { key: ProjectType.BLUE_CARBON,         label: t('type_blue_carbon') },
        { key: ProjectType.REFORESTATION,       label: t('type_reforestation') },
        { key: ProjectType.SOLAR,               label: t('type_solar') },
        { key: ProjectType.WIND,               label: t('type_wind') },
        { key: ProjectType.METHANE_CAPTURE,     label: t('type_methane_capture') },
    ];

    const filtered = carbonProjects.filter((p) => {
        const matchStatus = statusFilter === 'ALL' || p.status === statusFilter;
        const matchType   = typeFilter   === 'ALL' || p.type   === typeFilter;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
            || p.operatorName.toLowerCase().includes(search.toLowerCase())
            || p.locationName.toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchType && matchSearch;
    });

    function count(key: string) {
        if (key === 'ALL') return carbonProjects.length;
        return carbonProjects.filter((p) => p.status === key).length;
    }

    return (
        <div className="px-3 sm:px-6 py-3 sm:py-6 flex flex-col gap-6">

            {/* Page header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--os-text-primary)' }}>
                        <Leaf className="w-5 h-5 text-emerald-500" />
                        {t('page_title')}
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                        {t('page_subtitle')}
                    </p>
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{ backgroundColor: '#10B981', color: '#fff' }}
                >
                    <Leaf className="w-4 h-4" />
                    {t('submit_project')}
                </button>
            </div>

            {/* KPIs */}
            <KpiRow projects={carbonProjects} />

            {/* Filters */}
            <div
                className="flex flex-wrap gap-2 sm:gap-3 p-3 sm:p-4 rounded-2xl"
                style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
            >
                {/* Search */}
                <div
                    className="flex items-center gap-2 w-full sm:flex-1 sm:min-w-[220px] h-9 px-3 rounded-xl"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('search_placeholder')}
                        className="flex-1 bg-transparent text-xs outline-none"
                        style={{ color: 'var(--os-text-primary)' }}
                    />
                </div>

                {/* Status tabs */}
                <div className="flex items-center gap-1 overflow-x-auto">
                    {STATUS_FILTERS.map((f) => (
                        <button
                            key={f.key}
                            onClick={() => setStatus(f.key)}
                            className="flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-semibold transition-all"
                            style={{
                                backgroundColor: statusFilter === f.key ? 'rgba(16,185,129,0.12)' : 'transparent',
                                color: statusFilter === f.key ? '#10B981' : 'var(--os-text-muted)',
                                border: statusFilter === f.key ? '1px solid rgba(16,185,129,0.25)' : '1px solid transparent',
                            }}
                        >
                            {f.label}
                            <span
                                className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                                style={{
                                    backgroundColor: statusFilter === f.key ? 'rgba(16,185,129,0.2)' : 'var(--os-surface-2)',
                                    color: statusFilter === f.key ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                {count(f.key)}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Type filter */}
                <div
                    className="flex items-center gap-2 h-9 px-3 rounded-xl"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Filter className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                    <select
                        value={typeFilter}
                        onChange={(e) => setType(e.target.value)}
                        className="bg-transparent text-xs outline-none appearance-none"
                        style={{ color: 'var(--os-text-primary)' }}
                    >
                        {TYPE_FILTERS.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Results count */}
            <div className="flex items-center justify-between">
                <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                    {t('projects_displayed', { count: filtered.length })}
                </p>
            </div>

            {/* Project list */}
            {filtered.length === 0 ? (
                <div
                    className="flex flex-col items-center justify-center py-16 rounded-2xl"
                    style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                >
                    <Leaf className="w-10 h-10 mb-3" style={{ color: 'var(--os-text-muted)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--os-text-primary)' }}>{t('no_projects_found')}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--os-text-muted)' }}>{t('no_projects_hint')}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {filtered.map((p) => <ProjectCard key={p.id} project={p} />)}
                </div>
            )}
        </div>
    );
}
