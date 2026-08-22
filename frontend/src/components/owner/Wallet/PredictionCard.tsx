'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { accentStyle } from '@/lib/osAccent';
import { usdGrouped } from '@/lib/osMoney';
import { computeProvision } from '@/services/walletProvision';
import type { NextTaxPrediction } from '@/services/walletService';

interface Props {
    prediction: NextTaxPrediction;
    currentBalanceUsd: number;
    onOpenTopup?: () => void;
}

/**
 * Provision recommandée.
 *
 * C'est le seul endroit du produit où l'on anticipe au lieu de constater : la
 * carte énonce le manque en une phrase, montre le calcul en trois lignes, puis
 * propose un bouton qui porte le montant exact. Un armateur doit pouvoir
 * décider sans refaire la soustraction.
 *
 * Trois états, et c'est délibéré : sans historique suffisant on ne recommande
 * rien plutôt que d'avancer un chiffre creux ; couvert, on le dit et on
 * s'arrête ; à découvert, on chiffre.
 */
export function PredictionCard({ prediction, currentBalanceUsd, onOpenTopup }: Props) {
    const t = useTranslations('OwnerPortal.wallet');
    const provision = computeProvision(prediction, currentBalanceUsd);

    if (provision.confidence === 'low') {
        return (
            <section className="os-card flex flex-col gap-2 p-[22px]">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
                    {t('predictionCard.title')}
                </h2>
                <p className="text-[13px] text-[var(--os-text-muted)]">{t('predictionCard.notEnoughData')}</p>
            </section>
        );
    }

    if (!provision.short) {
        return (
            <section className="os-card flex flex-col gap-2 p-[22px]">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
                    {t('predictionCard.title')}
                </h2>
                <p className="text-[16px] font-semibold text-[var(--os-text-primary)]">
                    {t('predictionCard.covered', { amount: usdGrouped(provision.dueSoonUsd) })}
                </p>
                <p className="text-[12.5px] text-[var(--os-text-muted)]">
                    {t('predictionCard.confidence', {
                        level: t(`predictionCard.confidenceLevel.${provision.confidence}`),
                    })}
                </p>
            </section>
        );
    }

    return (
        <section
            style={accentStyle('warning')}
            className="os-accent-edge os-accent-border-l flex flex-col gap-3 rounded-xl border bg-[var(--os-surface)] p-[22px]"
        >
            <h2 className="os-accent-text text-[11px] font-semibold uppercase tracking-[0.06em]">
                {t('predictionCard.title')}
            </h2>

            <p className="text-[16px] font-semibold leading-snug text-[var(--os-text-primary)]">
                {t('predictionCard.gapSentence', { amount: usdGrouped(provision.gapUsd) })}
            </p>

            <dl className="flex flex-col gap-2 border-t border-[var(--os-border)] pt-3">
                <Line label={t('predictionCard.due30d')}>{usdGrouped(provision.dueSoonUsd)}</Line>
                <Line label={t('predictionCard.currentBalance')}>{usdGrouped(provision.balanceUsd)}</Line>
                <Line label={t('predictionCard.toProvision')} accent>{usdGrouped(provision.gapUsd)}</Line>
            </dl>

            <button
                type="button"
                onClick={onOpenTopup}
                disabled={!onOpenTopup}
                className="flex h-[42px] items-center justify-center rounded-[11px] border border-[var(--os-brand-green)]/35 px-4 text-[13.5px] font-semibold text-[var(--os-brand-cyan)] transition-colors duration-150 hover:bg-[var(--os-brand-green)]/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
            >
                {t('predictionCard.provisionCta', { amount: usdGrouped(provision.gapUsd) })}
            </button>
        </section>
    );
}

function Line({ label, accent, children }: { label: string; accent?: boolean; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-[var(--os-text-muted)]">
            <dt>{label}</dt>
            <dd className={`font-mono tabular-nums ${accent ? 'os-accent-text' : 'text-[var(--os-text-secondary)]'}`}>
                {children}
            </dd>
        </div>
    );
}
