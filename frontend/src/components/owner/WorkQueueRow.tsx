'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import type { WorkItem, WorkUrgency } from '@/services/ownerWorkQueue';

const URGENCY_ACCENT: Record<WorkUrgency, OsAccent> = {
    overdue:  'danger',
    dueSoon:  'warning',
    upcoming: 'info',
};

/**
 * Une ligne de la file de travail : le délai, ce que c'est, combien, et le geste.
 *
 * `primary` n'est vrai que pour la première ligne — la plus urgente. C'est la
 * règle qui rend l'action suivante lisible : un seul bouton plein par écran.
 * Des boutons pleins sur chaque ligne les rendraient tous équivalents, et
 * l'armateur devrait à nouveau décider par quoi commencer.
 */
export function WorkQueueRow({
    item,
    primary,
    payHref,
}: {
    item: WorkItem;
    primary: boolean;
    payHref: string;
}) {
    const t = useTranslations('OwnerPortal.queue');
    const accent = URGENCY_ACCENT[item.urgency];

    return (
        <article
            style={accentStyle(accent)}
            className="os-accent-edge os-accent-border-l flex flex-col gap-3 rounded-[11px] border bg-[var(--os-surface)] p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-[18px]"
        >
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <OsUrgencyPill accent={accent} className="self-start">
                    {deadlineLabel(item, t)}
                </OsUrgencyPill>
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="truncate text-[15px] font-semibold text-[var(--os-text-primary)]">
                        {t('title', { vessel: item.vesselName ?? t('fleetWide') })}
                    </h3>
                    <p className="truncate text-[12.5px] text-[var(--os-text-muted)]">
                        <span className="font-mono">{item.invoiceRef ?? item.transactionId.slice(0, 8)}</span>
                        {item.dueDate && ` · ${t('due', { date: new Date(item.dueDate).toLocaleDateString() })}`}
                    </p>
                </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end sm:gap-[18px]">
                {/* Mono 26 px sur mobile, 19 px au-dessus : sur un écran de 390 px
                    le montant est la première chose qu'on lit, pas la dernière. */}
                <span className="font-mono text-[26px] font-semibold tabular-nums text-[var(--os-text-primary)] sm:text-[19px]">
                    {usdGrouped(item.amountUsd)}
                </span>
                <Link
                    href={payHref}
                    className={`
                        flex h-12 shrink-0 items-center justify-center rounded-[10px] px-[18px]
                        text-[13.5px] font-semibold transition-opacity duration-150 sm:h-10
                        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                        ${primary
                            ? 'bg-[var(--os-brand-green)] text-[var(--os-on-primary)] hover:opacity-90'
                            : 'border border-[var(--os-brand-green)]/35 text-[var(--os-brand-cyan)] hover:bg-[var(--os-brand-green)]/10'}
                    `}
                >
                    {t('pay')}
                </Link>
            </div>
        </article>
    );
}

/** « En retard · 4 j », « Dans 9 j », « À l'escale ». */
function deadlineLabel(item: WorkItem, t: ReturnType<typeof useTranslations>): string {
    if (item.daysToDue === null) return t('onCall');
    if (item.daysToDue < 0) return t('overdueBy', { count: -item.daysToDue });
    if (item.daysToDue === 0) return t('dueToday');
    return t('inDays', { count: item.daysToDue });
}
