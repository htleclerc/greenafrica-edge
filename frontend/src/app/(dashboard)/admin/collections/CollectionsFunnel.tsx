'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import { STAGE_TIERS, type CollectionFunnel, type FunnelStage } from '@/services/collectionFunnel';

/**
 * Accent de chaque étape. Il ne décore pas : c'est le même code couleur que les
 * liserés du cockpit armateurs, si bien qu'un dossier gardera sa couleur d'un
 * écran à l'autre.
 */
const STAGE_ACCENT: Record<FunnelStage, OsAccent> = {
    reminder:  'warning',
    formal:    'mid',
    authority: 'danger',
    settled:   'success',
};

/** Ordre de lecture : la procédure, de son premier geste à son issue. */
const STAGE_ORDER: FunnelStage[] = ['reminder', 'formal', 'authority', 'settled'];

/**
 * File de recouvrement — une colonne par étape de la procédure.
 *
 * Cliquer une colonne filtre la liste du bas sur les paliers de cette étape :
 * la file n'est pas un tableau de bord décoratif, c'est l'entrée dans le
 * travail. L'action de pied applique ce filtre et emmène l'agent sur la liste.
 */
export function CollectionsFunnel({ funnel }: { funnel: CollectionFunnel }) {
    const t = useTranslations('AdminCollections');
    const router = useRouter();
    const searchParams = useSearchParams();

    /** Applique à la liste le filtre de palier correspondant à l'étape. */
    function focusStage(stage: FunnelStage) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('page');
        if (stage === 'settled') {
            params.delete('latestTier');
            params.set('status', 'PAID');
        } else {
            params.delete('status');
            // Le filtre serveur ne prend qu'un palier : on vise le premier de
            // l'étape, celui où les dossiers entrent.
            params.set('latestTier', STAGE_TIERS[stage][0]);
        }
        router.push(`?${params.toString()}`);
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                {STAGE_ORDER.map((stage) => {
                    const col = funnel.columns[stage];
                    const accent = STAGE_ACCENT[stage];
                    return (
                        <section
                            key={stage}
                            style={accentStyle(accent)}
                            className={`
                                flex flex-col gap-3 rounded-xl border bg-[var(--os-surface)] p-4
                                ${stage === 'settled' ? 'border-[var(--os-border)]' : 'os-accent-edge'}
                            `}
                        >
                            <div
                                aria-hidden
                                className="-mx-4 -mt-4 mb-1 h-0.5 rounded-t-xl"
                                style={{ backgroundColor: 'var(--os-accent)' }}
                            />
                            <div className="flex items-baseline justify-between gap-2">
                                <h3 className="text-[13px] font-semibold text-[var(--os-text-primary)]">
                                    {t(`stage.${stage}`)}
                                </h3>
                                <span className="os-accent-text font-mono text-[18px] font-semibold tabular-nums">
                                    {col.count}
                                </span>
                            </div>
                            <p className="font-mono text-xs text-[var(--os-text-muted)]">
                                {stage === 'settled'
                                    ? t('stageSettledAmount', { amount: usdGrouped(col.outstandingUsd) })
                                    : usdGrouped(col.outstandingUsd)}
                            </p>

                            <ul className="flex flex-col gap-2">
                                {col.previews.map((p) => (
                                    <li key={p.transactionId}>
                                        <span className="block truncate rounded-[9px] bg-[var(--os-surface-2)] px-2.5 py-2.5 text-[12.5px] text-[var(--os-text-secondary)]">
                                            {p.debtorName} · <span className="font-mono">{usdGrouped(p.outstandingUsd)}</span>
                                        </span>
                                    </li>
                                ))}
                                {col.others > 0 && (
                                    <li className="px-1 py-0.5 text-[12.5px] text-[var(--os-text-muted)]">
                                        {t('stageOthers', { count: col.others })}
                                    </li>
                                )}
                                {col.count === 0 && (
                                    <li className="px-1 py-0.5 text-[12.5px] text-[var(--os-text-muted)]">
                                        {t('stageEmpty')}
                                    </li>
                                )}
                            </ul>

                            <button
                                type="button"
                                onClick={() => focusStage(stage)}
                                disabled={col.count === 0}
                                className={`
                                    mt-auto flex h-[38px] items-center justify-center rounded-[10px] px-3
                                    text-[13px] font-semibold transition-colors duration-150
                                    disabled:cursor-not-allowed disabled:opacity-40
                                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                                    ${stage === 'authority'
                                        ? 'bg-[var(--os-brand-green)] text-[var(--os-on-primary)] hover:opacity-90'
                                        : 'border border-[var(--os-border-strong)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-2)]'}
                                `}
                            >
                                {t(`stageAction.${stage}`, { count: col.count })}
                            </button>
                        </section>
                    );
                })}
            </div>

            {/* Un cumul partiel doit se dire — sinon il se lit comme un cumul complet. */}
            {funnel.truncated && (
                <p className="text-[11.5px] text-[var(--os-text-muted)]">{t('funnelTruncated')}</p>
            )}
        </div>
    );
}
