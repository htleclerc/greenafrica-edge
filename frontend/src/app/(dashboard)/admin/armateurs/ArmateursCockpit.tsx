'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { OsKpiBand, type OsKpiCell } from '@/components/ui/OsKpiBand';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { OsGridTable, type OsGridColumn } from '@/components/ui/OsGridTable';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { inviteShipowner } from '@/actions/inviteShipowner';
import { sendConsolidatedRecap } from '@/actions/sendConsolidatedRecap';
import { usdCompact, usdGrouped } from '@/lib/osMoney';
import { filterArmateurs, type ArmateurFilterState } from './armateurFilters';
import {
    cockpitTotals, debtAgeDays, escalationLevel, matchesTab, sortByDebtAge,
    LEVEL_ACCENT, type CockpitTab, type EscalationLevel,
} from './armateurEscalation';
import type { ArmateurCockpitRow } from '@/services/armateurService';

interface Props {
    rows: ArmateurCockpitRow[];
    canInvite: boolean;
}

/**
 * Action de ligne appropriée à l'état du dossier.
 *
 * Seule `collections` — l'escalade, portée par la ligne la plus grave — est
 * rendue en bouton plein. C'est ce qui rend l'action suivante lisible : des
 * boutons pleins sur chaque ligne la rendraient invisible.
 */
type RowActionKind = 'collections' | 'remind' | 'arbitrate' | 'kyc' | 'none';

const LEVEL_ACTION: Record<EscalationLevel, RowActionKind> = {
    sanctioned: 'none',         // contact interdit — procédure in rem / consulaire
    escalated:  'collections',  // la rampe légale (J45 → huissier) vit sur l'écran recouvrement
    default:    'remind',
    late:       'remind',
    disputed:   'arbitrate',
    kyc:        'kyc',
    clear:      'none',
};

const BASE_FILTERS: ArmateurFilterState = {
    search: '', accountState: 'all', sanction: 'all', country: 'all', outstandingOnly: false,
};

/** Les dossiers qu'une campagne de relance peut effectivement toucher. */
function isRemindable(level: EscalationLevel, row: ArmateurCockpitRow): boolean {
    return (level === 'default' || level === 'late') && row.open_count > 0 && !!row.official_email;
}

export function ArmateursCockpit({ rows, canInvite }: Props) {
    const t = useTranslations('AdminArmateurs');
    const router = useRouter();

    // `now` est figé au montage : sans cela, chaque rendu recalculerait
    // l'ancienneté sur un instant différent et le tri pourrait glisser sous le
    // curseur. Une console de recouvrement se rafraîchit par navigation.
    const [now] = React.useState(() => new Date());
    const [tab, setTab] = React.useState<CockpitTab>('defaulting');
    const [search, setSearch] = React.useState('');

    const decorated = React.useMemo(
        () => sortByDebtAge(rows, now).map((row) => ({ row, level: escalationLevel(row, now) })),
        [rows, now],
    );

    const searched = React.useMemo(() => {
        if (!search.trim()) return decorated;
        const kept = new Set(filterArmateurs(rows, { ...BASE_FILTERS, search }).map((r) => r.id));
        return decorated.filter((d) => kept.has(d.row.id));
    }, [decorated, rows, search]);

    const visible = React.useMemo(
        () => searched.filter((d) => matchesTab(d.level, tab)),
        [searched, tab],
    );

    const counts = React.useMemo(() => ({
        defaulting: searched.filter((d) => matchesTab(d.level, 'defaulting')).length,
        all:        searched.length,
        escalated:  searched.filter((d) => matchesTab(d.level, 'escalated')).length,
        kyc:        searched.filter((d) => matchesTab(d.level, 'kyc')).length,
    }), [searched]);

    // Les KPI décrivent le portefeuille entier, pas l'onglet courant : c'est une
    // ligne de contexte, elle ne doit pas bouger quand on filtre la liste.
    const totals = React.useMemo(() => cockpitTotals(rows, now), [rows, now]);

    const campaignTargets = React.useMemo(
        () => searched.filter((d) => isRemindable(d.level, d.row)).map((d) => d.row),
        [searched],
    );

    // ── Relance unitaire ──────────────────────────────────────────────────────
    const [recapTarget, setRecapTarget] = React.useState<ArmateurCockpitRow | null>(null);
    const [recapError, setRecapError] = React.useState<string | null>(null);
    const [recapPending, startRecap] = React.useTransition();

    function confirmRecap() {
        if (!recapTarget) return;
        setRecapError(null);
        startRecap(async () => {
            const res = await sendConsolidatedRecap({ shipownerId: recapTarget.id });
            if (!res.ok) { setRecapError(res.reason); return; }
            setRecapTarget(null);
            router.refresh();
        });
    }

    // ── Campagne de relance ───────────────────────────────────────────────────
    const [campaignOpen, setCampaignOpen] = React.useState(false);
    const [campaignError, setCampaignError] = React.useState<string | null>(null);
    const [campaignResult, setCampaignResult] = React.useState<{ sent: number; failed: number } | null>(null);
    const [campaignPending, startCampaign] = React.useTransition();

    function confirmCampaign() {
        setCampaignError(null);
        startCampaign(async () => {
            // Envois séquentiels : chaque récapitulatif compose un PDF côté serveur.
            // Les lancer en parallèle sur 38 armateurs saturerait le générateur pour
            // gagner quelques secondes sur un geste qu'on ne fait qu'une fois par mois.
            let sent = 0, failed = 0;
            for (const row of campaignTargets) {
                const res = await sendConsolidatedRecap({ shipownerId: row.id });
                if (res.ok) sent += 1; else failed += 1;
            }
            setCampaignResult({ sent, failed });
            if (failed > 0 && sent === 0) setCampaignError(t('campaignAllFailed'));
            router.refresh();
        });
    }

    function closeCampaign() {
        setCampaignOpen(false);
        setCampaignError(null);
        setCampaignResult(null);
    }

    // ── Invitation / e-mail (comportement existant, chrome refondu) ────────────
    const [inviteTarget, setInviteTarget] = React.useState<ArmateurCockpitRow | null>(null);
    const [inviteEmail, setInviteEmail] = React.useState('');
    const [inviteError, setInviteError] = React.useState<string | null>(null);
    const [invitePending, startInvite] = React.useTransition();

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
        startInvite(async () => {
            const result = await inviteShipowner({ shipownerId: inviteTarget.id, email: inviteEmail });
            if (!result.ok) { setInviteError(result.reason); return; }
            closeInvite();
            router.refresh();
        });
    }

    function exportCsv() {
        const header = [t('col.name'), t('col.country'), t('col.status'), t('col.age'), t('col.proformas'), t('col.outstanding')];
        const lines = visible.map(({ row, level }) => [
            row.name,
            row.country_code ?? '',
            t(`status.${level}`),
            String(debtAgeDays(row, now) ?? ''),
            String(row.proforma_count),
            row.total_outstanding_usd.toFixed(2),
        ]);
        // Guillemets doublés : un nom d'armateur peut contenir une virgule.
        const csv = [header, ...lines]
            .map((cells) => cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `armateurs-${now.toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Colonnes ──────────────────────────────────────────────────────────────
    type Decorated = { row: ArmateurCockpitRow; level: EscalationLevel };

    const columns: OsGridColumn<Decorated>[] = React.useMemo(() => [
        {
            key: 'name', header: t('col.name'), width: '1.5fr', primary: true,
            render: ({ row }) => (
                <span className="flex min-w-0 flex-col gap-px">
                    <span className="truncate text-[13.5px] font-semibold text-[var(--os-text-primary)]">{row.name}</span>
                    <span className="truncate text-[11px] text-[var(--os-text-muted)]">
                        {row.country_code ?? '—'}
                        {row.imo_company_no && <span className="font-mono"> · {row.imo_company_no}</span>}
                    </span>
                </span>
            ),
        },
        {
            key: 'proformas', header: t('col.proformas'), width: '0.7fr', secondary: true,
            render: ({ row }) => (
                <span className="font-mono text-[13px] tabular-nums text-[var(--os-text-secondary)]">{row.proforma_count}</span>
            ),
        },
        {
            key: 'age', header: t('col.age'), width: '0.9fr',
            render: ({ row, level }) => {
                const age = debtAgeDays(row, now);
                if (age === null) return <span className="text-[13px] text-[var(--os-text-muted)]">—</span>;
                const strong = level === 'escalated' || level === 'default' || level === 'late';
                return (
                    <span
                        className={`text-[13px] tabular-nums ${strong ? 'font-semibold' : ''}`}
                        style={strong ? { color: `var(--os-${level === 'late' ? 'yellow' : 'red'})` } : undefined}
                    >
                        {t('daysAgo', { count: age })}
                    </span>
                );
            },
        },
        {
            key: 'lastContact', header: t('col.lastReminder'), width: '1fr', secondary: true,
            render: ({ row }) => (
                <span className="truncate text-[12.5px] text-[var(--os-text-secondary)]">
                    {row.last_reminder_at
                        ? `${row.last_auto_tier ?? t('manualReminder')} · ${new Date(row.last_reminder_at).toLocaleDateString()}`
                        : t('noContact')}
                </span>
            ),
        },
        {
            key: 'status', header: t('col.status'), width: '0.9fr',
            render: ({ row, level }) => (
                <OsUrgencyPill accent={LEVEL_ACCENT[level]} className="!rounded-full !px-2.5 !py-0.5 !tracking-[0.04em]">
                    {level === 'sanctioned'
                        ? [row.is_ofac_sdn && 'OFAC', row.is_un_prohibited && 'UN'].filter(Boolean).join(' · ')
                        : t(`status.${level}`)}
                </OsUrgencyPill>
            ),
        },
        {
            key: 'outstanding', header: t('col.outstanding'), width: '0.9fr', align: 'end',
            render: ({ row }) => (
                <span className="font-mono text-[13.5px] tabular-nums text-[var(--os-text-primary)]">
                    {usdGrouped(row.total_outstanding_usd)}
                </span>
            ),
        },
        {
            key: 'actions', header: '', width: '200px', align: 'end',
            render: ({ row, level }) => {
                const kind = LEVEL_ACTION[level];
                // stopPropagation : le clic sur la ligne ouvre la fiche, le bouton
                // déclenche son action sans passer par le détail.
                const stop = (e: React.MouseEvent) => e.stopPropagation();
                return (
                    <span className="flex items-center justify-end gap-2" onClick={stop}>
                        {kind === 'collections' && (
                            <Link
                                href={`/admin/collections?q=${encodeURIComponent(row.name)}`}
                                className="inline-flex h-[34px] items-center rounded-lg bg-[var(--os-brand-green)] px-3 text-[12.5px] font-semibold whitespace-nowrap text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90"
                            >
                                {t('action.collections')}
                            </Link>
                        )}
                        {kind === 'remind' && (
                            <button
                                type="button"
                                onClick={() => { setRecapError(null); setRecapTarget(row); }}
                                disabled={!row.official_email}
                                title={row.official_email ? undefined : t('action.noEmail')}
                                className="inline-flex h-[34px] items-center rounded-lg border border-[var(--os-brand-green)]/40 px-3 text-[12.5px] font-semibold whitespace-nowrap text-[var(--os-brand-cyan)] transition-colors duration-150 hover:bg-[var(--os-brand-green)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {t('action.remind')}
                            </button>
                        )}
                        {kind === 'arbitrate' && (
                            <Link
                                href={`/admin/collections?q=${encodeURIComponent(row.name)}&latestResponse=DISPUTE`}
                                className="inline-flex h-[34px] items-center rounded-lg border border-[var(--os-border-strong)] px-3 text-[12.5px] font-semibold whitespace-nowrap text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                            >
                                {t('action.arbitrate')}
                            </Link>
                        )}
                        {kind === 'kyc' && canInvite && (
                            <button
                                type="button"
                                onClick={() => openInvite(row)}
                                className="inline-flex h-[34px] items-center rounded-lg border border-[var(--os-border-strong)] px-3 text-[12.5px] font-semibold whitespace-nowrap text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                            >
                                {row.account_state === 'INVITED' ? t('reinvite') : t('action.checkKyc')}
                            </button>
                        )}
                        <Link
                            href={`/admin/armateurs/${row.id}`}
                            className="shrink-0 px-1 py-1.5 text-[12.5px] text-[var(--os-text-muted)] transition-colors duration-150 hover:text-[var(--os-text-primary)]"
                        >
                            {t('action.file')}
                        </Link>
                    </span>
                );
            },
        },
    ], [t, now, canInvite]);

    const kpis: OsKpiCell[] = [
        {
            label: t('kpi.outstanding'), value: usdCompact(totals.outstandingUsd),
            note: t('kpi.outstandingNote', { count: totals.openInvoices }),
        },
        {
            label: t('kpi.aged'), value: usdCompact(totals.agedOutstandingUsd), tone: 'danger',
            note: t('kpi.agedNote', { count: totals.agedOwners }),
        },
        {
            label: t('kpi.collected'), value: usdCompact(totals.paidUsd),
            note: t('kpi.collectedNote'),
        },
        {
            label: t('kpi.avgAge'),
            value: totals.averageAgeDays === null ? '—' : t('daysShort', { count: totals.averageAgeDays }),
            note: t('kpi.avgAgeNote'),
        },
        {
            label: t('kpi.recovery'),
            value: totals.recoveryRate === null ? '—' : `${totals.recoveryRate.toFixed(1).replace('.', ',')}%`,
            note: t('kpi.recoveryNote'),
        },
    ];

    const defaultingCount = decorated.filter((d) => matchesTab(d.level, 'defaulting')).length;

    return (
        <div className="flex flex-col gap-[18px] p-4 sm:p-6">
            <OsPageHeader
                title={t('cockpit.verdict', { count: defaultingCount })}
                subtitle={t('cockpit.context', {
                    outstanding: usdGrouped(totals.outstandingUsd),
                    total: rows.length,
                })}
                actions={
                    <>
                        <OsButton variant="secondary" onClick={exportCsv} className="!h-10 !rounded-[10px]">
                            {t('cockpit.export')}
                        </OsButton>
                        <OsButton
                            variant="primary"
                            onClick={() => { setCampaignResult(null); setCampaignError(null); setCampaignOpen(true); }}
                            disabled={campaignTargets.length === 0}
                            title={campaignTargets.length === 0 ? t('campaignEmpty') : undefined}
                            className="!h-10 !rounded-[10px] !bg-[var(--os-brand-green)] !text-[var(--os-on-primary)] !shadow-none"
                        >
                            {t('cockpit.campaign', { count: campaignTargets.length })}
                        </OsButton>
                    </>
                }
            />

            <OsKpiBand cells={kpis} />

            <div className="os-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5">
                    <OsFilterTabs
                        label={t('cockpit.tabsLabel')}
                        value={tab}
                        onChange={(v) => setTab(v as CockpitTab)}
                        tabs={[
                            { value: 'defaulting', label: t('tab.defaulting'), count: counts.defaulting },
                            { value: 'all',        label: t('tab.all'),        count: counts.all },
                            { value: 'escalated',  label: t('tab.escalated'),  count: counts.escalated },
                            { value: 'kyc',        label: t('tab.kyc'),        count: counts.kyc },
                        ]}
                    />
                    <div className="flex items-center gap-3">
                        <label className="sr-only" htmlFor="cockpit-search">{t('filters.search')}</label>
                        <input
                            id="cockpit-search"
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('filters.searchPlaceholder')}
                            className="h-9 w-full min-w-0 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 text-[12.5px] text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--os-brand-green)] sm:w-[260px]"
                        />
                        <span className="hidden text-[12.5px] whitespace-nowrap text-[var(--os-text-muted)] xl:inline">
                            {t('cockpit.sortedBy')}
                        </span>
                    </div>
                </div>

                <OsGridTable
                    columns={columns}
                    rows={visible}
                    keyExtractor={(d) => d.row.id}
                    rowAccent={(d) => (d.level === 'clear' ? null : LEVEL_ACCENT[d.level])}
                    onRowClick={(d) => router.push(`/admin/armateurs/${d.row.id}`)}
                    rowLabel={(d) => t('rowLabel', { name: d.row.name })}
                    emptyMessage={t('empty')}
                    className="!rounded-none !border-0"
                />
            </div>

            {/* ── Relance unitaire ─────────────────────────────────────────────── */}
            <ConfirmDialog
                open={recapTarget !== null}
                onOpenChange={(o) => !o && setRecapTarget(null)}
                title={t('sendRecapConfirmTitle')}
                body={t('sendRecapConfirmBody', {
                    name: recapTarget?.name ?? '',
                    count: recapTarget?.open_count ?? 0,
                })}
                error={recapError}
                cancelLabel={t('cancel')}
                confirmLabel={t('sendRecap')}
                pending={recapPending}
                onConfirm={confirmRecap}
                onCancel={() => setRecapTarget(null)}
            />

            {/* ── Campagne de relance ──────────────────────────────────────────── */}
            <Dialog.Root open={campaignOpen} onOpenChange={(o) => !o && !campaignPending && closeCampaign()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="mb-2 text-base font-semibold text-[var(--os-text-primary)]">
                            {t('campaignTitle')}
                        </Dialog.Title>
                        {campaignResult ? (
                            <Dialog.Description className="text-sm text-[var(--os-text-secondary)]">
                                {t('campaignDone', { sent: campaignResult.sent, failed: campaignResult.failed })}
                            </Dialog.Description>
                        ) : (
                            <Dialog.Description className="text-sm text-[var(--os-text-muted)]">
                                {t('campaignBody', {
                                    count: campaignTargets.length,
                                    amount: usdGrouped(campaignTargets.reduce((s, r) => s + r.total_outstanding_usd, 0)),
                                })}
                            </Dialog.Description>
                        )}
                        {campaignError && <p className="mt-2 text-xs text-[var(--os-red)]">{campaignError}</p>}
                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeCampaign} disabled={campaignPending}>
                                {campaignResult ? t('close') : t('cancel')}
                            </OsButton>
                            {!campaignResult && (
                                <OsButton variant="primary" onClick={confirmCampaign} loading={campaignPending} disabled={campaignPending}>
                                    {t('campaignConfirm', { count: campaignTargets.length })}
                                </OsButton>
                            )}
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* ── Invitation ───────────────────────────────────────────────────── */}
            <Dialog.Root open={inviteTarget !== null} onOpenChange={(o) => !o && closeInvite()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="mb-2 text-base font-semibold text-[var(--os-text-primary)]">
                            {t('inviteDialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="mb-4 text-sm text-[var(--os-text-muted)]">
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
                            <OsButton variant="ghost" onClick={closeInvite} disabled={invitePending}>{t('cancel')}</OsButton>
                            <OsButton
                                variant="primary"
                                onClick={submitInvite}
                                loading={invitePending}
                                disabled={invitePending || !inviteEmail || (inviteTarget?.sanctioned ?? false)}
                                title={inviteTarget?.sanctioned ? t('sanctionedTooltip') : undefined}
                            >
                                {invitePending ? t('sending') : t('sendInvite')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

        </div>
    );
}

/** Dialogue de confirmation d'un geste sortant — envoi immédiat, irréversible. */
function ConfirmDialog({
    open, onOpenChange, title, body, error, cancelLabel, confirmLabel, pending, onConfirm, onCancel,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    body: string;
    error: string | null;
    cancelLabel: string;
    confirmLabel: string;
    pending: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[440px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Dialog.Title className="mb-2 text-base font-semibold text-[var(--os-text-primary)]">{title}</Dialog.Title>
                    <Dialog.Description className="text-sm text-[var(--os-text-muted)]">{body}</Dialog.Description>
                    {error && <p className="mt-2 text-xs text-[var(--os-red)]">{error}</p>}
                    <div className="mt-5 flex justify-end gap-2">
                        <OsButton variant="ghost" onClick={onCancel} disabled={pending}>{cancelLabel}</OsButton>
                        <OsButton variant="primary" onClick={onConfirm} loading={pending} disabled={pending}>{confirmLabel}</OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
