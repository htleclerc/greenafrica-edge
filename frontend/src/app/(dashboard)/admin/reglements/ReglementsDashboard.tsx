'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { useClientSort } from '@/hooks/useClientSort';
import type { ReglementsSummary, Bucket } from '@/services/reglementsService';
import type { ArmateurCockpitRow } from '@/services/armateurService';

interface Props { summary: ReglementsSummary; owners: ArmateurCockpitRow[] }

const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function ReglementsDashboard({ summary, owners }: Props) {
    const t = useTranslations('AdminReglements');
    const router = useRouter();

    const windows: { label: string; invoiced: Bucket; collected: Bucket }[] = [
        { label: t('today'), invoiced: summary.invoicedToday, collected: summary.collectedToday },
        { label: t('week'),  invoiced: summary.invoicedWeek,  collected: summary.collectedWeek },
        { label: t('month'), invoiced: summary.invoicedMonth, collected: summary.collectedMonth },
    ];

    const columns: OsColumn<ArmateurCockpitRow>[] = React.useMemo(() => [
        {
            key: 'owner', header: t('col.owner'), sortable: true, sortValue: (o) => o.name,
            render: (o) => <span className="font-medium text-[var(--os-text-primary)]">{o.name}</span>,
        },
        {
            key: 'outstanding', header: t('col.outstanding'), className: 'text-right',
            sortable: true, sortValue: (o) => o.total_outstanding_usd,
            render: (o) => <span className="text-xs tabular-nums font-semibold">{usd(o.total_outstanding_usd)}</span>,
        },
        {
            key: 'overdue', header: t('col.overdue'), className: 'text-right',
            sortable: true, sortValue: (o) => o.overdue_count,
            render: (o) => <OsBadge variant="overdue" label={String(o.overdue_count)} />,
        },
        {
            key: 'tier', header: t('col.tier'),
            sortable: true, sortValue: (o) => o.last_auto_tier,
            render: (o) => o.last_auto_tier
                ? <OsBadge variant="warning" label={o.last_auto_tier} />
                : <span className="text-xs text-[var(--os-text-muted)]">—</span>,
        },
        {
            key: 'lastReminder', header: t('col.lastReminder'),
            sortable: true, sortValue: (o) => o.last_reminder_at,
            render: (o) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {o.last_reminder_at ? new Date(o.last_reminder_at).toLocaleDateString() : '—'}
                </span>
            ),
        },
    ], [t]);

    const { sort, onSortChange, sortedRows } = useClientSort(owners, columns);

    return (
        <div className="flex flex-col gap-4">
            <OsCard>
                <OsCardHeader title={t('flowTitle')} subtitle={t('utcNote')} />
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-8 gap-y-3 text-sm">
                    <span />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] text-right">{t('invoiced')}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] text-right">{t('collected')}</span>
                    {windows.map((w) => (
                        <React.Fragment key={w.label}>
                            <span className="text-[var(--os-text-secondary)]">{w.label}</span>
                            <span className="text-right tabular-nums">
                                {usd(w.invoiced.usd)}
                                <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({w.invoiced.count})</span>
                            </span>
                            <span className="text-right tabular-nums">
                                {usd(w.collected.usd)}
                                <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({w.collected.count})</span>
                            </span>
                        </React.Fragment>
                    ))}
                </div>
            </OsCard>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <OsCard>
                    <OsCardHeader title={t('totalOutstanding')} />
                    <p className="text-2xl font-bold tabular-nums text-[var(--os-text-primary)]">
                        {usd(summary.totalOutstandingUsd)}
                    </p>
                </OsCard>
                <OsCard>
                    <OsCardHeader title={t('overdue')} />
                    <p className="text-2xl font-bold tabular-nums text-[#EF4444]">{usd(summary.overdueUsd)}</p>
                    <p className="text-xs text-[var(--os-text-muted)] mt-1">
                        {t('overdueCount', { count: summary.overdueCount })}
                    </p>
                </OsCard>
            </div>

            <OsCard>
                <OsCardHeader title={t('toChase')} />
                <OsTable
                    columns={columns}
                    rows={sortedRows}
                    sort={sort}
                    onSortChange={onSortChange}
                    keyExtractor={(o) => o.id}
                    emptyMessage={t('empty')}
                    onRowClick={(o) => router.push('/admin/armateurs/' + o.id)}
                />
            </OsCard>
        </div>
    );
}
