'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { OsGridTable, type OsGridColumn } from '@/components/ui/OsGridTable';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import { matchesFleetTab, type FleetStatus, type FleetTab, type FleetVessel, type OwnerFleet } from '@/services/ownerFleet';

const STATUS_ACCENT: Record<FleetStatus, OsAccent> = {
    overdue:   'danger',
    toPay:     'warning',
    proforma:  'info',
    compliant: 'success',
    exempt:    'info',
};

const TABS: FleetTab[] = ['all', 'action', 'inPort', 'compliant', 'exempt'];

/**
 * Ma flotte — deux niveaux de lecture.
 *
 * Les navires qui exigent une action sont des **cartes** : nom, statut, quatre
 * paires libellé/valeur, et un bouton dont le libellé porte l'échéance. Les
 * navires conformes sont des **lignes de tableau**. Un navire qui ne demande
 * rien n'a pas besoin d'une carte, et lui en donner une noierait les deux qui
 * comptent au milieu de six.
 */
interface FleetBoardProps {
    fleet: OwnerFleet;
    vesselBasePath: string;
    /** Où mène « payer » depuis une carte. Défaut : les factures du portail. */
    invoicesHref?: string;
    /** Vue staff : l'action de paiement est visible mais désactivée. */
    readOnly?: boolean;
    /** Rôle sans accès aux montants facturés : reste dû et payé masqués. */
    hideAmounts?: boolean;
}

export function FleetBoard({
    fleet, vesselBasePath, invoicesHref = '/dashboard/invoices', readOnly = false, hideAmounts = false,
}: FleetBoardProps) {
    const t = useTranslations('OwnerPortal.fleet');
    const tView = useTranslations('AdminOwnerView');
    const router = useRouter();
    const [tab, setTab] = React.useState<FleetTab>('all');

    const visible = fleet.vessels.filter((v) => matchesFleetTab(v, tab));
    // Les cartes mettent en avant les navires a traiter ; le tableau reste
    // l'inventaire COMPLET. Un navire mis en carte en sortait auparavant, si
    // bien que la liste annoncait deux navires et n'en montrait qu'un —
    // l'armateur qui cherchait le sien devait deviner qu'il etait plus haut.
    // La redondance est voulue : un appel a l'action, puis la flotte entiere.
    const cards = visible.filter((v) => v.needsAction);
    const rows = visible;

    const columns: OsGridColumn<FleetVessel>[] = [
        {
            key: 'name', header: t('col.vessel'), width: '1.4fr', primary: true,
            render: (v) => (
                <span className="flex min-w-0 flex-col gap-px">
                    <span className="truncate text-[13.5px] font-semibold text-[var(--os-text-primary)]">{v.name}</span>
                    <span className="truncate font-mono text-[11px] text-[var(--os-text-muted)]">
                        {v.imoNumber ? `IMO ${v.imoNumber}` : '—'}
                    </span>
                </span>
            ),
        },
        {
            key: 'category', header: t('col.type'), width: '1fr', secondary: true,
            render: (v) => <span className="truncate text-[12.5px] text-[var(--os-text-secondary)]">{v.category ?? '—'}</span>,
        },
        {
            key: 'position', header: t('col.position'), width: '1fr', secondary: true,
            render: (v) => <span className="truncate text-[12.5px] text-[var(--os-text-secondary)]">{v.position ?? '—'}</span>,
        },
        {
            key: 'status', header: t('col.status'), width: '1fr',
            render: (v) => (
                <OsUrgencyPill accent={STATUS_ACCENT[v.status]} className="!rounded-full !px-2.5 !py-0.5 !tracking-[0.04em]">
                    {t(`status.${v.status}`)}
                </OsUrgencyPill>
            ),
        },
        {
            key: 'paid', header: t('col.paidYtd'), width: '0.8fr', align: 'end',
            render: (v) => (
                <span className="font-mono text-[13px] tabular-nums text-[var(--os-text-secondary)]">
                    {!hideAmounts && v.paidYtdUsd > 0 ? usdGrouped(v.paidYtdUsd) : '—'}
                </span>
            ),
        },
        {
            key: 'actions', header: '', width: '90px', align: 'end',
            render: (v) => (
                <Link
                    href={`${vesselBasePath}/${v.ref}`}
                    onClick={(e) => e.stopPropagation()}
                    className="px-1 py-1.5 text-[12.5px] text-[var(--os-text-muted)] transition-colors duration-150 hover:text-[var(--os-text-primary)]"
                >
                    {t('detail')}
                </Link>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-[18px]">
            <OsFilterTabs
                label={t('tabsLabel')}
                value={tab}
                onChange={(v) => setTab(v as FleetTab)}
                tabs={TABS.map((key) => ({ value: key, label: t(`tab.${key}`), count: fleet.counts[key] }))}
            />

            {cards.length > 0 && (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                    {cards.map((v) => (
                        <VesselCard
                            key={v.id}
                            vessel={v}
                            vesselBasePath={vesselBasePath}
                            invoicesHref={invoicesHref}
                            readOnly={readOnly}
                            hideAmounts={hideAmounts}
                            hint={tView('actionHint')}
                        />
                    ))}
                </div>
            )}

            {rows.length > 0 && (
                <OsGridTable
                    columns={columns}
                    rows={rows}
                    keyExtractor={(v) => v.id}
                    onRowClick={(v) => router.push(`${vesselBasePath}/${v.ref}`)}
                    rowLabel={(v) => t('openVessel', { name: v.name })}
                    emptyMessage={t('empty')}
                />
            )}

            {visible.length === 0 && (
                <p className="os-card px-[18px] py-10 text-center text-[13px] text-[var(--os-text-muted)]">
                    {t('empty')}
                </p>
            )}
        </div>
    );
}

function VesselCard({ vessel, vesselBasePath, invoicesHref, readOnly, hideAmounts, hint }: {
    vessel: FleetVessel; vesselBasePath: string; invoicesHref: string; readOnly: boolean; hideAmounts: boolean; hint: string;
}) {
    const t = useTranslations('OwnerPortal.fleet');
    const accent = STATUS_ACCENT[vessel.status];
    // Une seule action pleine par écran : celle du navire réellement en retard.
    const primary = vessel.status === 'overdue';

    return (
        <article
            style={accentStyle(accent)}
            className="os-accent-edge flex flex-col gap-3.5 rounded-xl border bg-[var(--os-surface)] p-[18px]"
        >
            <header className="flex items-start justify-between gap-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="truncate text-[15px] font-semibold text-[var(--os-text-primary)]">
                        <Link
                            href={`${vesselBasePath}/${vessel.ref}`}
                            className="hover:text-[var(--os-brand-cyan)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                        >
                            {vessel.name}
                        </Link>
                    </h3>
                    <p className="truncate font-mono text-[11px] text-[var(--os-text-muted)]">
                        {vessel.imoNumber ? `IMO ${vessel.imoNumber}` : '—'}
                        {vessel.category && <span className="font-sans"> · {vessel.category}</span>}
                    </p>
                </div>
                <OsUrgencyPill accent={accent} className="!rounded-full !px-2.5 !py-0.5 !tracking-[0.04em]">
                    {t(`status.${vessel.status}`)}
                </OsUrgencyPill>
            </header>

            <dl className="flex flex-col gap-[7px]">
                <Pair label={t('card.position')}>{vessel.position ?? '—'}</Pair>
                <Pair label={t('card.nextDue')}>
                    {vessel.nextDueDate ? new Date(vessel.nextDueDate).toLocaleDateString() : t('card.onCall')}
                </Pair>
                <Pair label={t('card.emissions')}>
                    {vessel.emissionsTco2 > 0
                        ? t('card.tco2', { value: Math.round(vessel.emissionsTco2).toLocaleString('fr-FR') })
                        : '—'}
                </Pair>
                <Pair label={vessel.status === 'proforma' ? t('card.estimate') : t('card.due')} mono>
                    {hideAmounts ? '—' : usdGrouped(vessel.outstandingUsd)}
                </Pair>
            </dl>

            {/* Deux chemins, pas un. L'action principale mène au paiement ; le
                détail du navire doit rester atteignable pour TOUS les navires,
                pas seulement pour ceux que leur conformité relègue au tableau.
                Un armateur qui veut vérifier une émission ou une escale avant
                de payer n'avait, sur cette carte, aucun moyen d'y accéder. */}
            <div className="flex items-stretch gap-2">
                {/* En lecture seule, l'action de PAIEMENT est grisée : le staff voit
                    ce que l'armateur peut déclencher sans le déclencher pour lui.
                    Le chemin vers le détail, lui, reste ouvert. */}
                {readOnly && vessel.status !== 'proforma' ? (
                    <span
                        aria-disabled
                        title={hint}
                        className={`
                            flex h-10 flex-1 cursor-not-allowed items-center justify-center rounded-[10px] px-3 text-[13.5px] font-semibold opacity-50
                            ${primary
                                ? 'bg-[var(--os-brand-green)] text-[var(--os-on-primary)]'
                                : 'border border-[var(--os-brand-green)]/35 text-[var(--os-brand-cyan)]'}
                        `}
                    >
                        {vessel.nextDueDate
                            ? t('card.payBefore', { date: new Date(vessel.nextDueDate).toLocaleDateString() })
                            : t('card.payNow')}
                    </span>
                ) : (
                <Link
                    href={
                        vessel.status === 'proforma'
                            ? `${vesselBasePath}/${vessel.ref}`
                            : invoicesHref
                    }
                    className={`
                        flex h-10 flex-1 items-center justify-center rounded-[10px] px-3 text-[13.5px] font-semibold
                        transition-opacity duration-150
                        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                        ${primary
                            ? 'bg-[var(--os-brand-green)] text-[var(--os-on-primary)] hover:opacity-90'
                            : vessel.status === 'toPay'
                                ? 'border border-[var(--os-brand-green)]/35 text-[var(--os-brand-cyan)] hover:bg-[var(--os-brand-green)]/10'
                                : 'border border-[var(--os-border-strong)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-2)]'}
                    `}
                >
                    {/* Le libellé porte l'échéance : « Payer avant le 31 août » dit
                        quoi faire ET quand, là où « Payer » laisse chercher la date. */}
                    {vessel.status === 'proforma'
                        ? t('card.seeProforma')
                        : vessel.nextDueDate
                            ? t('card.payBefore', { date: new Date(vessel.nextDueDate).toLocaleDateString() })
                            : t('card.payNow')}
                </Link>
                )}

                {vessel.status !== 'proforma' && (
                    <Link
                        href={`${vesselBasePath}/${vessel.ref}`}
                        className="flex h-10 items-center justify-center rounded-[10px] border border-[var(--os-border-strong)] px-3 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {t('detail')}
                    </Link>
                )}
            </div>
        </article>
    );
}

function Pair({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-[var(--os-text-muted)]">
            <dt>{label}</dt>
            <dd className={`truncate text-right ${mono ? 'font-mono tabular-nums text-[var(--os-text-primary)]' : 'text-[var(--os-text-secondary)]'}`}>
                {children}
            </dd>
        </div>
    );
}
