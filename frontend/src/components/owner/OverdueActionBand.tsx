'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { accentStyle } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import type { WorkItem } from '@/services/ownerWorkQueue';

interface Props {
    item: WorkItem;
    payHref: string;
    disputeHref: string;
}

/**
 * Bande d'action — le traitement réservé à une échéance dépassée.
 *
 * Là où une ligne de file annonce « En retard · 4 j » dans une pastille, la
 * bande sort le nombre de jours en Mono 44 px et le pose à gauche d'un filet :
 * l'ancienneté du retard devient le premier élément lu de la page, avant même
 * le nom du navire. C'est délibérément disproportionné — un seul dossier peut
 * le porter, et seulement quand il est vraiment en retard.
 *
 * Quand la bande est là, c'est elle qui porte l'unique action pleine de l'écran ;
 * l'action de l'en-tête de page se replie en secondaire (cf. OperatorDashboardPage).
 */
export function OverdueActionBand({ item, payHref, disputeHref }: Props) {
    const t = useTranslations('OwnerPortal.actionBand');
    const daysLate = item.daysToDue !== null ? -item.daysToDue : 0;

    return (
        <section
            style={accentStyle('danger')}
            className="os-accent-edge os-action-band flex flex-col gap-5 rounded-[14px] border px-[22px] py-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
        >
            <div className="flex min-w-0 items-center gap-5">
                <div className="flex shrink-0 flex-col gap-0.5 border-r border-[var(--os-border-strong)] pr-5">
                    <span className="os-accent-text font-mono text-[44px] font-semibold leading-none tabular-nums">
                        {daysLate}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-red)]">
                        {t('daysLate', { count: daysLate })}
                    </span>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--os-red)]">
                        {t('required')}
                    </span>
                    <h2 className="text-[19px] font-semibold leading-snug text-[var(--os-text-primary)]">
                        {t('title', { vessel: item.vesselName ?? t('fleetWide') })}
                    </h2>
                    <p className="truncate text-[13px] text-[var(--os-text-secondary)]">
                        {t('meta', {
                            ref: item.invoiceRef ?? item.transactionId.slice(0, 8),
                            date: item.dueDate ? new Date(item.dueDate).toLocaleDateString() : '—',
                        })}
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-3.5">
                <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-[26px] font-semibold leading-none tabular-nums text-[var(--os-text-primary)]">
                        {usdGrouped(item.amountUsd)}
                    </span>
                    <span className="text-[11.5px] text-[var(--os-text-muted)]">{t('terms')}</span>
                </div>
                <div className="flex gap-2.5">
                    <Link
                        href={payHref}
                        className="flex h-11 items-center rounded-[11px] bg-[var(--os-brand-green)] px-5 text-sm font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {t('payNow')}
                    </Link>
                    <Link
                        href={disputeHref}
                        className="flex h-11 items-center rounded-[11px] border border-[var(--os-border-strong)] px-4 text-sm text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                    >
                        {t('dispute')}
                    </Link>
                </div>
            </div>
        </section>
    );
}
