'use client';

import * as React from 'react';
import {
    Leaf, Search, Filter, TrendingUp, Award, BarChart2,
    MapPin, Calendar, CheckCircle2, Clock, AlertTriangle,
    XCircle, ChevronDown, ChevronUp, ExternalLink, Download,
    Zap, Wind, Sun, Sprout, Waves, Flame,
} from 'lucide-react';
import { mockCarbonProjects } from '@/mock/datas/secureMock';
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

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    [ProjectStatus.ACTIVE]:     { label: 'Actif',         color: '#22C55E', bg: 'rgba(34,197,94,0.1)',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    [ProjectStatus.PENDING]:    { label: 'En attente',    color: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  icon: <Clock className="w-3.5 h-3.5" /> },
    [ProjectStatus.REVIEW]:     { label: 'Sous revue',    color: '#38BDF8', bg: 'rgba(56,189,248,0.1)',  icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    [ProjectStatus.COMPLETED]:  { label: 'Terminé',       color: '#A3A3A3', bg: 'rgba(163,163,163,0.1)', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    [ProjectStatus.SUSPENDED]:  { label: 'Suspendu',      color: '#EF4444', bg: 'rgba(239,68,68,0.1)',   icon: <XCircle className="w-3.5 h-3.5" /> },
};

const TYPE_CONFIG: Record<ProjectType, { label: string; color: string; icon: React.ReactNode }> = {
    [ProjectType.BLUE_CARBON]:        { label: 'Carbone Bleu',      color: '#38BDF8', icon: <Waves className="w-4 h-4" /> },
    [ProjectType.REFORESTATION]:      { label: 'Reforestation',     color: '#22C55E', icon: <Sprout className="w-4 h-4" /> },
    [ProjectType.SOLAR]:              { label: 'Solaire',           color: '#F59E0B', icon: <Sun className="w-4 h-4" /> },
    [ProjectType.WIND]:               { label: 'Éolien',            color: '#818CF8', icon: <Wind className="w-4 h-4" /> },
    [ProjectType.METHANE_CAPTURE]:    { label: 'Capture Méthane',   color: '#F97316', icon: <Flame className="w-4 h-4" /> },
    [ProjectType.ENERGY_EFFICIENCY]:  { label: 'Efficacité Énerg.', color: '#A3A3A3', icon: <Zap className="w-4 h-4" /> },
};

const STD_LABELS: Record<VerificationStandard, string> = {
    [VerificationStandard.VERRA_VCS]:     'Verra VCS',
    [VerificationStandard.GOLD_STANDARD]: 'Gold Standard',
    [VerificationStandard.IMO_DCS]:       'IMO DCS',
    [VerificationStandard.PENDING]:       'En cours',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProjectStatus }) {
    const cfg = STATUS_CONFIG[status];
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
    const cfg = TYPE_CONFIG[type];
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
    return (
        <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#10B981' }}
        >
            ODD {n}
        </span>
    );
}

// ── KPI Row ───────────────────────────────────────────────────────────────────

function KpiRow({ projects }: { projects: CarbonProject[] }) {
    const totalCredits  = projects.reduce((s, p) => s + p.creditsIssuedTotal, 0);
    const totalRetired  = projects.reduce((s, p) => s + p.creditsRetiredTotal, 0);
    const totalAvail    = projects.reduce((s, p) => s + p.creditsAvailable, 0);
    const totalValue    = projects.reduce((s, p) => s + p.totalValueUsd, 0);
    const active        = projects.filter((p) => p.status === ProjectStatus.ACTIVE).length;

    const kpis = [
        { label: 'Projets actifs',      value: String(active),         sub: `sur ${projects.length} total`,   color: '#22C55E', icon: <Leaf className="w-5 h-5" /> },
        { label: 'Crédits émis',        value: fmt(totalCredits),      sub: 'tCO₂e total',                    color: '#10B981', icon: <Award className="w-5 h-5" /> },
        { label: 'Crédits retirés',     value: fmt(totalRetired),      sub: `${((totalRetired/totalCredits||0)*100).toFixed(0)}% du total`,  color: '#38BDF8', icon: <CheckCircle2 className="w-5 h-5" /> },
        { label: 'Disponibles',         value: fmt(totalAvail),        sub: 'tCO₂e à vendre',                 color: '#F59E0B', icon: <TrendingUp className="w-5 h-5" /> },
        { label: 'Valeur marché',       value: fmtUsd(totalValue),     sub: 'portefeuille total',             color: '#818CF8', icon: <BarChart2 className="w-5 h-5" /> },
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
    const [open, setOpen] = React.useState(false);
    const typeCfg  = TYPE_CONFIG[project.type];
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
                            <Award className="w-3.5 h-3.5" /> {STD_LABELS[project.verificationStandard]}
                        </span>
                        <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> Depuis {project.startDate.slice(0, 7)}
                        </span>
                    </div>
                </div>

                {/* Right summary */}
                <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-sm font-bold" style={{ color: '#10B981' }}>
                        {fmt(project.creditsAvailable)} <span className="text-xs font-normal" style={{ color: 'var(--os-text-muted)' }}>crédits dispo.</span>
                    </span>
                    <span className="text-xs" style={{ color: 'var(--os-text-muted)' }}>
                        {fmtUsd(project.pricePerCreditUsd * project.creditsAvailable)} valeur
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
                            { label: 'Superficie',         value: project.areaHectares > 0 ? `${fmt(project.areaHectares)} ha` : '—' },
                            { label: 'tCO₂ est./an',       value: fmt(project.estimatedTco2PerYear) },
                            { label: 'Crédits émis',       value: fmt(project.creditsIssuedTotal) },
                            { label: 'Crédits retirés',    value: `${fmt(project.creditsRetiredTotal)} (${retired}%)` },
                            { label: 'Prix / crédit',      value: `$${project.pricePerCreditUsd}` },
                            { label: 'Valeur totale',      value: fmtUsd(project.totalValueUsd) },
                            { label: 'Financement',        value: fmtUsd(project.fundingUsd) },
                            { label: 'Opérateur',         value: project.operatorName },
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
                                <span>Crédits retirés</span>
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
                                    Vérifié le {project.lastVerifiedAt}
                                </span>
                            )}
                            <button
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#10B981', border: '1px solid rgba(16,185,129,0.2)' }}
                            >
                                <Download className="w-3.5 h-3.5" />
                                Rapport
                            </button>
                            <button
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-primary)', border: '1px solid var(--os-border)' }}
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Détails
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
    { key: 'ALL',                         label: 'Tous' },
    { key: ProjectStatus.ACTIVE,          label: 'Actifs' },
    { key: ProjectStatus.PENDING,         label: 'En attente' },
    { key: ProjectStatus.REVIEW,          label: 'Sous revue' },
    { key: ProjectStatus.COMPLETED,       label: 'Terminés' },
];

const TYPE_FILTERS = [
    { key: 'ALL',                           label: 'Tous types' },
    { key: ProjectType.BLUE_CARBON,         label: 'Carbone Bleu' },
    { key: ProjectType.REFORESTATION,       label: 'Reforestation' },
    { key: ProjectType.SOLAR,               label: 'Solaire' },
    { key: ProjectType.WIND,               label: 'Éolien' },
    { key: ProjectType.METHANE_CAPTURE,     label: 'Méthane' },
];

export function GreenLedgerPage() {
    const [search, setSearch]           = React.useState('');
    const [statusFilter, setStatus]     = React.useState('ALL');
    const [typeFilter, setType]         = React.useState('ALL');

    const filtered = mockCarbonProjects.filter((p) => {
        const matchStatus = statusFilter === 'ALL' || p.status === statusFilter;
        const matchType   = typeFilter   === 'ALL' || p.type   === typeFilter;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
            || p.operatorName.toLowerCase().includes(search.toLowerCase())
            || p.locationName.toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchType && matchSearch;
    });

    function count(key: string) {
        if (key === 'ALL') return mockCarbonProjects.length;
        return mockCarbonProjects.filter((p) => p.status === key).length;
    }

    return (
        <div className="px-6 py-6 flex flex-col gap-6">

            {/* Page header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--os-text-primary)' }}>
                        <Leaf className="w-5 h-5 text-emerald-500" />
                        Green Ledger
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                        Registre souverain des projets carbone — Somaliland
                    </p>
                </div>
                <button
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{ backgroundColor: '#10B981', color: '#fff' }}
                >
                    <Leaf className="w-4 h-4" />
                    Soumettre un projet
                </button>
            </div>

            {/* KPIs */}
            <KpiRow projects={mockCarbonProjects} />

            {/* Filters */}
            <div
                className="flex flex-wrap gap-3 p-4 rounded-2xl"
                style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
            >
                {/* Search */}
                <div
                    className="flex items-center gap-2 flex-1 min-w-[220px] h-9 px-3 rounded-xl"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Rechercher un projet, opérateur, localisation..."
                        className="flex-1 bg-transparent text-xs outline-none"
                        style={{ color: 'var(--os-text-primary)' }}
                    />
                </div>

                {/* Status tabs */}
                <div className="flex items-center gap-1">
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
                    {filtered.length} projet{filtered.length !== 1 ? 's' : ''} affiché{filtered.length !== 1 ? 's' : ''}
                </p>
            </div>

            {/* Project list */}
            {filtered.length === 0 ? (
                <div
                    className="flex flex-col items-center justify-center py-16 rounded-2xl"
                    style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                >
                    <Leaf className="w-10 h-10 mb-3" style={{ color: 'var(--os-text-muted)' }} />
                    <p className="text-sm font-semibold" style={{ color: 'var(--os-text-primary)' }}>Aucun projet trouvé</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--os-text-muted)' }}>Modifiez vos filtres ou soumettez un nouveau projet.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {filtered.map((p) => <ProjectCard key={p.id} project={p} />)}
                </div>
            )}
        </div>
    );
}
