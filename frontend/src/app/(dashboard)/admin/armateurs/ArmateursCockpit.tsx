'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import * as Dialog from '@radix-ui/react-dialog';
import { inviteShipowner } from '@/actions/inviteShipowner';
import { updateArmateurContacts } from '@/actions/updateArmateurContacts';
import { filterArmateurs, type ArmateurFilterState, type SanctionFilter } from './armateurFilters';
import { useClientSort } from '@/hooks/useClientSort';
import type { ArmateurCockpitRow } from '@/services/armateurService';

interface Props {
    rows: ArmateurCockpitRow[];
    canInvite: boolean;
}

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const DEFAULT_FILTERS: ArmateurFilterState = {
    search: '',
    accountState: 'all',
    sanction: 'all',
    country: 'all',
    outstandingOnly: false,
};

export function ArmateursCockpit({ rows, canInvite }: Props) {
    const t = useTranslations('AdminArmateurs');
    const router = useRouter();

    const [filters, setFilters] = React.useState<ArmateurFilterState>(DEFAULT_FILTERS);
    const visible = React.useMemo(() => filterArmateurs(rows, filters), [rows, filters]);

    const accountStateOptions = React.useMemo(
        () => Array.from(new Set(rows.map((r) => r.account_state))).sort(),
        [rows],
    );
    const countryOptions = React.useMemo(
        () => Array.from(new Set(rows.map((r) => r.country_code).filter((c): c is string => !!c))).sort(),
        [rows],
    );

    const [inviteTarget, setInviteTarget] = React.useState<ArmateurCockpitRow | null>(null);
    const [inviteEmail, setInviteEmail] = React.useState('');
    const [inviteError, setInviteError] = React.useState<string | null>(null);
    const [invitePending, startInviteTransition] = React.useTransition();

    const [emailTarget, setEmailTarget] = React.useState<ArmateurCockpitRow | null>(null);
    const [emailValue, setEmailValue] = React.useState('');
    const [emailError, setEmailError] = React.useState<string | null>(null);
    const [emailPending, startEmailTransition] = React.useTransition();

    function openInvite(row: ArmateurCockpitRow) {
        setInviteTarget(row);
        setInviteEmail(row.official_email ?? '');
        setInviteError(null);
    }
    function closeInvite() {
        setInviteTarget(null);
        setInviteEmail('');
        setInviteError(null);
    }
    function submitInvite() {
        if (!inviteTarget) return;
        setInviteError(null);
        startInviteTransition(async () => {
            const result = await inviteShipowner({ shipownerId: inviteTarget.id, email: inviteEmail });
            if (!result.ok) {
                setInviteError(result.reason);
                return;
            }
            closeInvite();
            router.refresh();
        });
    }

    function openEditEmail(row: ArmateurCockpitRow) {
        setEmailTarget(row);
        setEmailValue(row.official_email ?? '');
        setEmailError(null);
    }
    function closeEditEmail() {
        setEmailTarget(null);
        setEmailValue('');
        setEmailError(null);
    }
    function submitEditEmail() {
        if (!emailTarget) return;
        setEmailError(null);
        startEmailTransition(async () => {
            const result = await updateArmateurContacts({
                shipownerId: emailTarget.id,
                officialEmail: emailValue,
                billingCcEmails: [],
            });
            if (!result.ok) {
                setEmailError(result.reason);
                return;
            }
            closeEditEmail();
            router.refresh();
        });
    }

    const stateBadge = React.useCallback((state: string) => {
        if (state === 'ACTIVE') return <OsBadge variant="active" label={t('state.active')} />;
        if (state === 'INVITED') return <OsBadge variant="warning" label={t('state.invited')} />;
        return <OsBadge variant="archived" label={t('state.ghost')} />;
    }, [t]);

    // Mémoïsé : `useClientSort` mémoïse `sortedRows` sur la référence de `columns`,
    // un tableau reconstruit à chaque rendu recalculerait le tri à chaque fois.
    // Dépendances : `t` (libellés), `canInvite` (prop — la colonne actions en dépend ;
    // submitInvite/submitEditEmail appellent router.refresh(), qui réconcilie de nouvelles
    // props sur ce client component déjà monté, sans démontage : un canInvite non listé ici
    // resterait périmé après un refresh), `stateBadge` (stabilisé ci-dessus par son propre
    // useCallback). openEditEmail/openInvite ne sont pas listées : ce sont des déclarations
    // de fonction qui ne ferment que sur des setters useState, stables par garantie React —
    // leur identité par rendu n'affecte pas le comportement capturé.
    const columns: OsColumn<ArmateurCockpitRow>[] = React.useMemo(() => [
        {
            key: 'name',
            header: t('col.name'),
            sortable: true,
            sortValue: (r) => r.name,
            render: (r) => <span className="font-medium text-[var(--os-text-primary)]">{r.name}</span>,
        },
        {
            key: 'country',
            header: t('col.country'),
            render: (r) => <span className="text-xs">{r.country_code ?? '—'}</span>,
        },
        {
            key: 'state',
            header: t('col.state'),
            render: (r) => stateBadge(r.account_state),
        },
        {
            key: 'sanctions',
            header: t('col.sanctions'),
            render: (r) => (
                <div className="flex gap-1">
                    {r.is_ofac_sdn && <OsBadge variant="critical" label="OFAC" />}
                    {r.is_un_prohibited && <OsBadge variant="critical" label="UN" />}
                </div>
            ),
        },
        {
            key: 'proformas',
            header: t('col.proformas'),
            className: 'text-right',
            sortable: true,
            sortValue: (r) => r.proforma_count,
            render: (r) => <span className="text-xs tabular-nums">{r.proforma_count}</span>,
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
            key: 'paid',
            header: t('col.paid'),
            className: 'text-right',
            sortable: true,
            sortValue: (r) => r.total_paid_usd,
            render: (r) => <span className="text-xs tabular-nums">{usd(r.total_paid_usd)}</span>,
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
            key: 'overdue',
            header: t('col.overdue'),
            className: 'text-right',
            sortable: true,
            sortValue: (r) => r.overdue_count,
            render: (r) => r.overdue_count > 0
                ? <OsBadge variant="overdue" label={String(r.overdue_count)} />
                : <span className="text-xs text-[var(--os-text-muted)]">—</span>,
        },
        {
            key: 'lastReminder',
            header: t('col.lastReminder'),
            sortable: true,
            sortValue: (r) => r.last_reminder_at,
            render: (r) => (
                <div className="flex items-center gap-1.5">
                    {r.last_auto_tier && <OsBadge variant="warning" label={r.last_auto_tier} size="sm" />}
                    <span className="text-xs text-[var(--os-text-muted)]">
                        {r.last_reminder_at ? new Date(r.last_reminder_at).toLocaleDateString() : '—'}
                    </span>
                </div>
            ),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: (r) => (
                <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <OsButton size="sm" variant="ghost" onClick={() => openEditEmail(r)}>
                        {t('editEmail')}
                    </OsButton>
                    {canInvite && r.account_state !== 'ACTIVE' && (
                        <span title={r.sanctioned ? t('sanctionedTooltip') : undefined}>
                            <OsButton
                                size="sm"
                                variant="primary"
                                disabled={r.sanctioned}
                                onClick={() => openInvite(r)}
                            >
                                {r.account_state === 'INVITED' ? t('reinvite') : t('invite')}
                            </OsButton>
                        </span>
                    )}
                </div>
            ),
        },
    ], [t, canInvite, stateBadge]);

    const { sort, onSortChange, sortedRows } = useClientSort(visible, columns);

    return (
        <>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="w-64">
                    <OsInput
                        label={t('filters.search')}
                        value={filters.search}
                        onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                        placeholder={t('filters.searchPlaceholder')}
                    />
                </div>
                <div className="w-48">
                    <OsSelect
                        label={t('filters.accountState')}
                        value={filters.accountState}
                        onChange={(e) => setFilters((f) => ({ ...f, accountState: e.target.value }))}
                        options={[
                            { value: 'all', label: t('filters.all') },
                            ...accountStateOptions.map((s) => ({ value: s, label: s })),
                        ]}
                    />
                </div>
                <div className="w-48">
                    <OsSelect
                        label={t('filters.sanction')}
                        value={filters.sanction}
                        onChange={(e) => setFilters((f) => ({ ...f, sanction: e.target.value as SanctionFilter }))}
                        options={[
                            { value: 'all', label: t('filters.all') },
                            { value: 'ofac', label: 'OFAC' },
                            { value: 'un', label: 'UN' },
                            { value: 'clean', label: t('filters.clean') },
                        ]}
                    />
                </div>
                <div className="w-40">
                    <OsSelect
                        label={t('filters.country')}
                        value={filters.country}
                        onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}
                        options={[
                            { value: 'all', label: t('filters.all') },
                            ...countryOptions.map((c) => ({ value: c, label: c })),
                        ]}
                    />
                </div>
                <label className="flex items-center gap-2 h-11 text-xs text-[var(--os-text-secondary)]">
                    <input
                        type="checkbox"
                        checked={filters.outstandingOnly}
                        onChange={(e) => setFilters((f) => ({ ...f, outstandingOnly: e.target.checked }))}
                    />
                    {t('filters.outstandingOnly')}
                </label>
            </div>

            <OsTable
                columns={columns}
                rows={sortedRows}
                keyExtractor={(r) => r.id}
                emptyMessage={t('empty')}
                onRowClick={(r) => router.push('/admin/armateurs/' + r.id)}
                sort={sort}
                onSortChange={onSortChange}
            />

            <Dialog.Root open={inviteTarget !== null} onOpenChange={(o) => !o && closeInvite()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('inviteDialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('inviteDialogSubtitle', { name: inviteTarget?.name ?? '' })}
                        </Dialog.Description>

                        <OsInput
                            label={t('col.email')}
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="owner@example.com"
                            autoFocus
                            error={inviteError ?? undefined}
                        />

                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeInvite} disabled={invitePending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="primary"
                                onClick={submitInvite}
                                loading={invitePending}
                                disabled={invitePending || !inviteEmail}
                            >
                                {invitePending ? t('sending') : t('sendInvite')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={emailTarget !== null} onOpenChange={(o) => !o && closeEditEmail()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('editEmailDialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('editEmailDialogSubtitle', { name: emailTarget?.name ?? '' })}
                        </Dialog.Description>

                        <OsInput
                            label={t('col.email')}
                            type="email"
                            value={emailValue}
                            onChange={(e) => setEmailValue(e.target.value)}
                            placeholder="owner@example.com"
                            autoFocus
                            error={emailError ?? undefined}
                        />

                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeEditEmail} disabled={emailPending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="primary"
                                onClick={submitEditEmail}
                                loading={emailPending}
                                disabled={emailPending || !emailValue}
                            >
                                {emailPending ? t('saving') : t('save')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}
