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
import { filterAirlines, type AirlineFilterState } from './airlineFilters';
import type { AirlineCockpitRow } from '@/services/airlineService';

interface Props {
    rows: AirlineCockpitRow[];
    /** id interne -> reference opaque exposee dans l'URL (mig 144). */
    refs: Record<string, string>;
    canInvite: boolean;
}

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

const DEFAULT_FILTERS: AirlineFilterState = {
    status: '',
    sanctions: '',
    country: '',
    search: '',
    dueOnly: false,
};

export function AirlinesCockpit({ rows, refs, canInvite }: Props) {
    const t = useTranslations('AdminAirlines');
    const router = useRouter();

    const [filters, setFilters] = React.useState<AirlineFilterState>(DEFAULT_FILTERS);
    const visible = React.useMemo(() => filterAirlines(rows, filters), [rows, filters]);

    const statusOptions = React.useMemo(
        () => Array.from(new Set(rows.map((r) => r.account_state))).sort(),
        [rows],
    );
    const countryOptions = React.useMemo(
        () => Array.from(new Set(rows.map((r) => r.country_code).filter((c): c is string => !!c))).sort(),
        [rows],
    );

    const [inviteTarget, setInviteTarget] = React.useState<AirlineCockpitRow | null>(null);
    const [inviteEmail, setInviteEmail] = React.useState('');
    const [inviteError, setInviteError] = React.useState<string | null>(null);
    const [invitePending, startInviteTransition] = React.useTransition();

    const [emailTarget, setEmailTarget] = React.useState<AirlineCockpitRow | null>(null);
    const [emailValue, setEmailValue] = React.useState('');
    const [emailError, setEmailError] = React.useState<string | null>(null);
    const [emailPending, startEmailTransition] = React.useTransition();

    function openInvite(row: AirlineCockpitRow) {
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

    function openEditEmail(row: AirlineCockpitRow) {
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
            });
            if (!result.ok) {
                setEmailError(result.reason);
                return;
            }
            closeEditEmail();
            router.refresh();
        });
    }

    const stateBadge = (state: string) => {
        if (state === 'ACTIVE') return <OsBadge variant="active" label={t('state.active')} />;
        if (state === 'INVITED') return <OsBadge variant="warning" label={t('state.invited')} />;
        return <OsBadge variant="archived" label={t('state.ghost')} />;
    };

    const columns: OsColumn<AirlineCockpitRow>[] = [
        {
            key: 'name',
            header: t('col.name'),
            render: (r) => <span className="font-medium text-[var(--os-text-primary)]">{r.name}</span>,
        },
        {
            key: 'iata',
            header: t('col.iata'),
            render: (r) => <span className="text-xs">{r.iata_code ?? '—'}</span>,
        },
        {
            key: 'icao',
            header: t('col.icao'),
            render: (r) => <span className="text-xs">{r.icao_code ?? '—'}</span>,
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
            render: (r) => <span className="text-xs tabular-nums">{r.proforma_count}</span>,
        },
        {
            key: 'invoiced',
            header: t('col.invoiced'),
            className: 'text-right',
            render: (r) => <span className="text-xs tabular-nums">{usd(r.total_invoiced_usd)}</span>,
        },
        {
            key: 'paid',
            header: t('col.paid'),
            className: 'text-right',
            render: (r) => <span className="text-xs tabular-nums">{usd(r.total_paid_usd)}</span>,
        },
        {
            key: 'outstanding',
            header: t('col.outstanding'),
            className: 'text-right',
            render: (r) => (
                <span
                    className={`text-xs tabular-nums font-semibold ${
                        r.total_outstanding_usd > 0 ? 'text-[#EF4444]' : 'text-[var(--os-text-primary)]'
                    }`}
                >
                    {usd(r.total_outstanding_usd)}
                </span>
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
    ];

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
                        label={t('filters.status')}
                        value={filters.status}
                        onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                        options={[
                            { value: '', label: t('filters.all') },
                            ...statusOptions.map((s) => ({ value: s, label: s })),
                        ]}
                    />
                </div>
                <div className="w-48">
                    <OsSelect
                        label={t('filters.sanctions')}
                        value={filters.sanctions}
                        onChange={(e) => setFilters((f) => ({ ...f, sanctions: e.target.value }))}
                        options={[
                            { value: '', label: t('filters.all') },
                            { value: 'OFAC', label: 'OFAC' },
                            { value: 'UN', label: 'UN' },
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
                            { value: '', label: t('filters.all') },
                            ...countryOptions.map((c) => ({ value: c, label: c })),
                        ]}
                    />
                </div>
                <label className="flex items-center gap-2 h-11 text-xs text-[var(--os-text-secondary)]">
                    <input
                        type="checkbox"
                        checked={filters.dueOnly}
                        onChange={(e) => setFilters((f) => ({ ...f, dueOnly: e.target.checked }))}
                    />
                    {t('filters.dueOnly')}
                </label>
            </div>

            <OsTable
                columns={columns}
                rows={visible}
                keyExtractor={(r) => r.id}
                emptyMessage={t('empty')}
                onRowClick={(r) => { const ref = refs[r.id]; if (ref) router.push('/admin/airlines/' + ref); }}
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
                            placeholder="ops@example.com"
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
                            placeholder="ops@example.com"
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
