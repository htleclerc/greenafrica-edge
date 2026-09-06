'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { useClientSort } from '@/hooks/useClientSort';
import {
    navireCollectionsState,
    type NavireRecouvrementRow,
    type NavireCollectionsState,
} from '@/services/navireService';

interface Props {
    rows: NavireRecouvrementRow[];
    /** Encours total vu par le tableau de bord — témoin de couverture. */
    dashboardOutstandingUsd: number;
}

const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const STATE_VARIANT: Record<NavireCollectionsState, BadgeVariant> = {
    OVERDUE: 'overdue',
    OPEN: 'warning',
    SETTLED: 'paid',
    NEVER_INVOICED: 'draft',
};

type StateFilter = 'all' | NavireCollectionsState;

export function NaviresCockpit({ rows, dashboardOutstandingUsd }: Props) {
    const t = useTranslations('AdminNavires');
    const router = useRouter();

    const [search, setSearch] = React.useState('');
    const [state, setState] = React.useState<StateFilter>('all');
    const [ownerFilter, setOwnerFilter] = React.useState<'all' | 'with' | 'without'>('all');

    const visible = React.useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) => {
            if (state !== 'all' && navireCollectionsState(r) !== state) return false;
            if (ownerFilter === 'with' && !r.shipowner_id) return false;
            if (ownerFilter === 'without' && r.shipowner_id) return false;
            if (q) {
                const hay = `${r.name} ${r.imo_number ?? ''} ${r.shipowner_name ?? ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [rows, search, state, ownerFilter]);

    const columns: OsColumn<NavireRecouvrementRow>[] = React.useMemo(() => [
        {
            key: 'name',
            header: t('col.vessel'),
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => (
                <div className="flex flex-col">
                    <span className="font-medium text-[var(--os-text-primary)]">{r.name}</span>
                    <span className="text-[10px] text-[var(--os-text-muted)] tabular-nums">
                        {r.imo_number ?? '—'}
                    </span>
                </div>
            ),
        },
        {
            key: 'owner',
            header: t('col.owner'),
            sortable: true,
            sortValue: (r) => r.shipowner_name,
            render: (r) =>
                r.shipowner_name ? (
                    <span className="flex items-center gap-1.5 text-sm">
                        {r.shipowner_name}
                        {r.shipowner_sanctioned && <OsBadge variant="critical" label="OFAC/UN" size="sm" />}
                    </span>
                ) : (
                    <span className="text-xs text-[var(--os-text-muted)]">{t('noOwner')}</span>
                ),
        },
        {
            key: 'state',
            header: t('col.state'),
            sortable: true,
            sortValue: (r) => navireCollectionsState(r),
            render: (r) => {
                const s = navireCollectionsState(r);
                return <OsBadge variant={STATE_VARIANT[s]} label={t(`state.${s}`)} />;
            },
        },
        {
            key: 'outstanding',
            header: t('col.outstanding'),
            className: 'text-right',
            sortable: true,
            sortValue: (r) => r.total_outstanding_usd,
            render: (r) => (
                <span className="text-xs tabular-nums font-semibold text-[var(--os-text-primary)]">
                    {usd(r.total_outstanding_usd)}
                </span>
            ),
        },
        {
            key: 'invoiced',
            header: t('col.invoiced'),
            className: 'text-right',
            sortable: true,
            sortValue: (r) => r.total_invoiced_usd,
            render: (r) => <span className="text-xs tabular-nums">{usd(r.total_invoiced_usd)}</span>,
        },
        {
            key: 'open',
            header: t('col.open'),
            className: 'text-right',
            sortable: true,
            sortValue: (r) => r.open_count,
            render: (r) => (
                <span className="text-xs tabular-nums">
                    {r.open_count}
                    {r.overdue_count > 0 && (
                        <span className="ml-1.5 text-[10px] text-[#EF4444]">
                            {t('overdueSuffix', { count: r.overdue_count })}
                        </span>
                    )}
                </span>
            ),
        },
        {
            key: 'nextDue',
            header: t('col.nextDue'),
            sortable: true,
            sortValue: (r) => r.next_due_date,
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : '—'}
                </span>
            ),
        },
        {
            key: 'actions',
            header: '',
            // « Voir comme ce navire » : le portail tel que le voit un gestionnaire
            // limité à ce navire. Sans armateur rattaché, il n'y a rien à voir.
            render: (r) => (
                r.vessel_public_ref && r.shipowner_id ? (
                    <Link
                        href={`/admin/navires/${r.vessel_public_ref}/portail`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-semibold text-[#00D97E] hover:underline whitespace-nowrap"
                    >
                        {t('action.viewAs')}
                    </Link>
                ) : null
            ),
        },
    ], [t]);

    const { sort, onSortChange, sortedRows } = useClientSort(visible, columns);

    const covered = rows.reduce((s, r) => s + r.total_outstanding_usd, 0);
    const gap = dashboardOutstandingUsd - covered;

    return (
        <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="w-64">
                    <OsInput
                        label={t('filters.search')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('filters.searchPlaceholder')}
                    />
                </div>
                <div className="w-52">
                    <OsSelect
                        label={t('filters.state')}
                        value={state}
                        onChange={(e) => setState(e.target.value as StateFilter)}
                        options={[
                            { value: 'all', label: t('filters.all') },
                            { value: 'OVERDUE', label: t('state.OVERDUE') },
                            { value: 'OPEN', label: t('state.OPEN') },
                            { value: 'SETTLED', label: t('state.SETTLED') },
                            { value: 'NEVER_INVOICED', label: t('state.NEVER_INVOICED') },
                        ]}
                    />
                </div>
                <div className="w-48">
                    <OsSelect
                        label={t('filters.owner')}
                        value={ownerFilter}
                        onChange={(e) => setOwnerFilter(e.target.value as 'all' | 'with' | 'without')}
                        options={[
                            { value: 'all', label: t('filters.all') },
                            { value: 'with', label: t('filters.ownerWith') },
                            { value: 'without', label: t('filters.ownerWithout') },
                        ]}
                    />
                </div>
            </div>

            <OsTable
                columns={columns}
                rows={sortedRows}
                sort={sort}
                onSortChange={onSortChange}
                keyExtractor={(r) => r.id}
                emptyMessage={t('empty')}
                onRowClick={(r) => r.shipowner_public_ref && router.push('/admin/armateurs/' + r.shipowner_public_ref)}
            />

            {/*
              Témoin de couverture. Une créance sans navire rattaché n'entre pas
              dans cette vue : sans ce rappel, son montant disparaîtrait de
              l'écran sans que rien ne le signale.
            */}
            <p className="mt-3 text-xs text-[var(--os-text-muted)]">
                {gap > 0.5
                    ? t('coverageGap', { covered: usd(covered), total: usd(dashboardOutstandingUsd), gap: usd(gap) })
                    : t('coverageComplete', { total: usd(covered) })}
            </p>
        </>
    );
}
