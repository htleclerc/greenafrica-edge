'use client';

// ─────────────────────────────────────────────────────────────────────────────
// VisionBoard — read-only overview for MANAGER / ADMIN staff
// ─────────────────────────────────────────────────────────────────────────────
//
// LECTURE SEULE — no write actions, no buttons that mutate state.
// Data is fetched server-side and passed as props; this component only renders.
// ─────────────────────────────────────────────────────────────────────────────

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Anchor, PlaneTakeoff, LogOut, DollarSign, AlertCircle } from 'lucide-react';

import { OsStatCard } from '@/components/ui/OsStatCard';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { ModeBadge } from '@/components/owner/ModeBadge';
import { formatUsd } from '@/services/ownerPortalService';
import type { VisionCounters, RecentDeparture } from '@/services/visionService';
import type { ActiveMode } from '@/lib/auth/activeMode';

// ─────────────────────────────────────────────────────────────────────────────
// Mode badge for the active filter header
// ─────────────────────────────────────────────────────────────────────────────

function ActiveModePill({ mode }: { mode: ActiveMode }) {
    const t = useTranslations('Vision');

    const styles: Record<ActiveMode, string> = {
        BOTH:     'bg-[var(--os-surface-2)] text-[var(--os-text-muted)] border border-[var(--os-border)]',
        MARITIME: 'bg-[var(--os-badge-compliant-bg)] text-[#22C55E] border border-[#22C55E]/20',
        AIR:      'bg-[#38BDF8]/10 text-[#7DD3FC] border border-[#38BDF8]/30',
    };

    const labels: Record<ActiveMode, string> = {
        BOTH:     t('modeBoth'),
        MARITIME: t('modeMaritime'),
        AIR:      t('modeAir'),
    };

    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide uppercase ${styles[mode]}`}
        >
            {labels[mode]}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Departures table columns
// ─────────────────────────────────────────────────────────────────────────────

function useDepartureColumns(t: ReturnType<typeof useTranslations>): OsColumn<RecentDeparture>[] {
    return [
        {
            key: 'ref',
            header: t('table.ref'),
            render: (row) => (
                <span className="font-mono text-xs text-[var(--os-text-primary)]">
                    {row.ref ?? '—'}
                </span>
            ),
        },
        {
            key: 'mode',
            header: t('table.mode'),
            render: (row) => <ModeBadge mode={row.mode} />,
        },
        {
            key: 'departedAt',
            header: t('table.departedAt'),
            render: (row) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {new Date(row.departedAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                    })}
                </span>
            ),
        },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface VisionBoardProps {
    counters: VisionCounters;
    mode: ActiveMode;
}

export function VisionBoard({ counters, mode }: VisionBoardProps) {
    const t = useTranslations('Vision');
    const columns = useDepartureColumns(t);

    return (
        <div className="space-y-6 p-4 sm:p-6">
            {/* Header + mode pill */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">
                        {t('pageTitle')}
                    </h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                        {t('pageSubtitle')}
                    </p>
                </div>
                <ActiveModePill mode={mode} />
            </div>

            {/* KPI stat cards — 2×2 on mobile, 4 across on large screens */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <OsStatCard
                    label={t('kpi.atPort')}
                    value={String(counters.atPort)}
                    icon={<Anchor className="w-4 h-4" />}
                    highlight={counters.atPort > 0}
                />
                <OsStatCard
                    label={t('kpi.approaching')}
                    value={String(counters.approaching)}
                    icon={<PlaneTakeoff className="w-4 h-4" />}
                />
                <OsStatCard
                    label={t('kpi.paidLast7d')}
                    value={`${counters.paidLast7dCount}`}
                    unit={formatUsd(counters.paidLast7dUsd)}
                    icon={<DollarSign className="w-4 h-4" />}
                />
                <OsStatCard
                    label={t('kpi.unpaidInProgress')}
                    value={`${counters.unpaidInProgressCount}`}
                    unit={formatUsd(counters.unpaidInProgressUsd)}
                    icon={<AlertCircle className="w-4 h-4" />}
                    highlight={counters.unpaidInProgressCount > 0}
                />
            </div>

            {/* Recent departures table */}
            <OsCard padded>
                <OsCardHeader
                    title={t('departures.title')}
                    subtitle={t('departures.subtitle')}
                />
                <OsTable<RecentDeparture>
                    columns={columns}
                    rows={counters.recentDepartures}
                    keyExtractor={(row) => row.id}
                    emptyMessage={t('departures.empty')}
                    loading={false}
                />
            </OsCard>
        </div>
    );
}
