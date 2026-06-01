'use client';

import * as React from 'react';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NextTaxPrediction } from '@/services/walletService';

interface Props {
    prediction: NextTaxPrediction;
    currentBalanceUsd: number;
}

export function PredictionCard({ prediction, currentBalanceUsd }: Props) {
    const t = useTranslations('OwnerPortal.wallet');
    const insufficient = prediction.estimated_amount_30d_usd > currentBalanceUsd;
    const recommended = Math.max(0, prediction.estimated_amount_30d_usd - currentBalanceUsd);

    if (prediction.confidence === 'low') {
        return (
            <section className="os-card p-5">
                <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-[var(--os-text-muted)]" />
                    <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('predictionCard.title')}</h2>
                </div>
                <p className="text-xs text-[var(--os-text-muted)]">{t('predictionCard.notEnoughData')}</p>
            </section>
        );
    }

    return (
        <section className="os-card p-5">
            <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('predictionCard.title')}</h2>
            </div>
            <p className="text-xs text-[var(--os-text-muted)] mb-1">
                {t('predictionCard.estimate30d', {
                    count: prediction.estimated_count_30d,
                    amount: prediction.estimated_amount_30d_usd.toLocaleString('en-US'),
                })}
            </p>
            <p className="text-xs text-[var(--os-text-muted)] mb-3">
                {t('predictionCard.confidence', { level: t(`predictionCard.confidenceLevel.${prediction.confidence}`) })}
            </p>
            {insufficient && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                    <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-200">
                        {t('predictionCard.insufficientWarning', { amount: recommended.toLocaleString('en-US') })}
                    </p>
                </div>
            )}
        </section>
    );
}
