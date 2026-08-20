'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { useClientSort } from '@/hooks/useClientSort';
import { sendConsolidatedRecap } from '@/actions/sendConsolidatedRecap';
import type { ReglementsSummary, Bucket } from '@/services/reglementsService';
import type { ArmateurCockpitRow } from '@/services/armateurService';

interface Props { summary: ReglementsSummary; owners: ArmateurCockpitRow[] }

const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function ReglementsDashboard({ summary, owners }: Props) {
    const t = useTranslations('AdminReglements');
    const router = useRouter();

    // Récapitulatif consolidé (sendConsolidatedRecap, Tâche 12) déclenché depuis
    // une ligne du tableau « À relancer ». `recapTarget` porte l'armateur ciblé ;
    // sa présence pilote l'ouverture du Dialog de confirmation — un envoi ne part
    // jamais sur le clic seul du bouton de la ligne.
    const [recapTarget, setRecapTarget] = React.useState<ArmateurCockpitRow | null>(null);
    const [recapError, setRecapError] = React.useState<string | null>(null);
    const [recapPending, startRecapTransition] = React.useTransition();

    function confirmRecap() {
        if (!recapTarget) return;
        setRecapError(null);
        startRecapTransition(async () => {
            const res = await sendConsolidatedRecap({ shipownerId: recapTarget.id });
            if (!res.ok) { setRecapError(res.reason); return; }
            setRecapTarget(null);
            router.refresh();
        });
    }

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
        {
            // Pas de `sortable` : cette colonne ne porte qu'une action, aucune valeur
            // à trier. En-tête vide à dessein — colonne d'action pure, comme ailleurs
            // dans l'admin (cf. col.actions de ArmateurDetail, ici sans équivalent
            // dédié dans ce namespace pour une simple icône de ligne).
            key: 'actions', header: '', className: 'text-right',
            render: (o) => (
                <OsButton
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                        // Stoppe la propagation : la ligne entière navigue vers la fiche
                        // armateur au clic (onRowClick ci-dessous) — ce bouton ne doit
                        // pas déclencher cette navigation en plus d'ouvrir le Dialog.
                        e.stopPropagation();
                        setRecapError(null);
                        setRecapTarget(o);
                    }}
                >
                    {t('sendRecap')}
                </OsButton>
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

            <Dialog.Root open={recapTarget !== null} onOpenChange={(o) => !o && setRecapTarget(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('sendRecap')}
                        </Dialog.Title>
                        {/* Le récapitulatif étant ici déclenché depuis une agrégation par
                            armateur (v_armateur_recouvrement), pas une liste de factures,
                            le nombre exact de factures ouvertes n'est connu que côté
                            serveur (composeOwnerStatement). overdue_count — déjà affiché
                            dans la colonne de cette même ligne — est le meilleur repère
                            client disponible : c'est un plancher (les factures ouvertes
                            mais pas encore en retard n'y sont pas comptées), jamais une
                            survente du nombre réel de factures couvertes. */}
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {recapTarget?.name} — {t('col.overdue')}: {recapTarget?.overdue_count}
                        </Dialog.Description>

                        {recapError && <p className="text-xs text-[#EF4444] mb-3">{recapError}</p>}

                        <div className="flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={() => setRecapTarget(null)} disabled={recapPending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton variant="primary" onClick={confirmRecap} loading={recapPending} disabled={recapPending}>
                                {t('sendRecap')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}
