'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import type { Imminence, OperatorArrival } from '@/services/operatorArrivals';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';
import { ClaimAlertDialog } from './ClaimAlertDialog';

const IMMINENCE_ACCENT: Record<Imminence, OsAccent> = {
    now:     'danger',
    soon:    'warning',
    later:   'neutral',
    unknown: 'neutral',
};

interface Props {
    arrivals: OperatorArrival[];
    /** Les alertes brutes, indexées par identifiant — le dialogue de prise en charge en a besoin. */
    alertsById: Record<string, ArrivalAlertWithVessel>;
    portLabel: string;
}

/**
 * Navires entrants — conçu pour une main, debout, réseau intermittent.
 *
 * Des cartes plutôt qu'un tableau : sur le quai on lit un navire à la fois, et
 * aucune cible tactile ne descend sous 44 px. Les navires sont triés par
 * imminence d'accostage, pas par ordre alphabétique.
 *
 * La carte du navire imminent porte l'alerte de solvabilité de l'armateur en
 * clair : c'est le seul renseignement que l'opérateur ne peut pas obtenir seul,
 * et c'est celui qui décide s'il faut encaisser avant l'appareillage.
 */
export function IncomingVesselsList({ arrivals, alertsById, portLabel }: Props) {
    const t = useTranslations('IncomingVessels');
    const { isOnline } = useOnlineStatus();
    const [claimTarget, setClaimTarget] = React.useState<ArrivalAlertWithVessel | null>(null);

    return (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3.5 p-4 sm:p-6">
            {/* L'état réseau est un fait de terrain, pas une notification passagère :
                il vit dans l'en-tête, à côté du nombre de navires. */}
            <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-[var(--os-text-muted)]">{portLabel}</span>
                {!isOnline && (
                    <span className="flex items-center gap-1.5 rounded-full bg-[var(--os-yellow)]/12 px-2.5 py-1 text-[11.5px] text-[var(--os-yellow)]">
                        <WifiOff className="size-3.5" aria-hidden />
                        {t('offline')}
                    </span>
                )}
            </div>

            <OsPageHeader title={t('verdict', { count: arrivals.length })} subtitle={t('subtitle')} />

            {arrivals.length === 0 ? (
                <p className="os-card px-4 py-10 text-center text-[13px] text-[var(--os-text-muted)]">
                    {t('empty')}
                </p>
            ) : (
                <ul className="flex flex-col gap-3.5">
                    {arrivals.map((a) => (
                        <li key={a.alertId}>
                            <ArrivalCard
                                arrival={a}
                                onClaim={() => {
                                    const alert = alertsById[a.alertId];
                                    if (alert) setClaimTarget(alert);
                                }}
                            />
                        </li>
                    ))}
                </ul>
            )}

            {claimTarget && (
                <ClaimAlertDialog
                    alert={claimTarget}
                    open={!!claimTarget}
                    onClose={() => setClaimTarget(null)}
                />
            )}
        </div>
    );
}

function ArrivalCard({ arrival, onClaim }: { arrival: OperatorArrival; onClaim: () => void }) {
    const t = useTranslations('IncomingVessels');
    const accent = IMMINENCE_ACCENT[arrival.imminence];
    const urgent = arrival.imminence === 'now';

    return (
        <article
            style={accentStyle(accent)}
            className={`
                flex flex-col gap-2.5 rounded-xl border bg-[var(--os-surface)] p-4
                ${arrival.imminence === 'later' || arrival.imminence === 'unknown'
                    ? 'border-[var(--os-border)]'
                    : 'os-accent-edge os-accent-border-l'}
            `}
        >
            <div className="flex items-center justify-between gap-3">
                <OsUrgencyPill accent={accent} className="!bg-transparent !px-0">
                    {etaLabel(arrival, t)}
                </OsUrgencyPill>
                <span className="font-mono text-[11.5px] text-[var(--os-text-muted)]">
                    {t('distance', { nm: Math.round(arrival.distanceNm) })}
                </span>
            </div>

            <h2 className={`font-semibold text-[var(--os-text-primary)] ${urgent ? 'text-[17px]' : 'text-[16px]'}`}>
                {arrival.vesselName}
            </h2>
            <p className="font-mono text-xs text-[var(--os-text-muted)]">
                IMO {arrival.imoNumber}
                {arrival.ownerName && <span className="font-sans"> · {arrival.ownerName}</span>}
            </p>

            {arrival.ownerInDefault && arrival.ownerOutstandingUsd !== null ? (
                <p className="text-[13px] leading-relaxed text-[var(--os-red)]">
                    {t('ownerInDefault', { amount: usdGrouped(arrival.ownerOutstandingUsd) })}
                </p>
            ) : arrival.ownerOutstandingUsd === 0 ? (
                <p className="text-[12.5px] text-[var(--os-green)]">{t('ownerClear')}</p>
            ) : null}

            {/* 50 px : la cible primaire se vise debout, avec le pouce. */}
            <button
                type="button"
                onClick={onClaim}
                className="flex h-[50px] items-center justify-center rounded-xl bg-[var(--os-brand-green)] px-4 text-[15px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
            >
                {t('claim')}
            </button>

            {arrival.ownerInDefault && (
                <Link
                    href={`/admin/collections?q=${encodeURIComponent(arrival.ownerName ?? arrival.vesselName)}`}
                    className="flex h-11 items-center justify-center rounded-xl border border-[var(--os-border-strong)] px-4 text-sm text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                >
                    {t('reportToAuthority')}
                </Link>
            )}
        </article>
    );
}

/** « Accostage dans 40 min », « Dans 3 h », « Demain », « ETA inconnue ». */
function etaLabel(a: OperatorArrival, t: ReturnType<typeof useTranslations>): string {
    if (a.minutesToEta === null) return t('etaUnknown');
    if (a.minutesToEta < 0) return t('etaPassed');
    if (a.minutesToEta <= 60) return t('etaMinutes', { count: a.minutesToEta });
    if (a.minutesToEta <= 24 * 60) return t('etaHours', { count: Math.round(a.minutesToEta / 60) });
    return t('etaDays', { count: Math.round(a.minutesToEta / (24 * 60)) });
}
