'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { STAGE_TIERS, type CollectionFunnel } from '@/services/collectionFunnel';

/**
 * En-tête de l'écran recouvrement.
 *
 * Le sous-titre énonce la règle appliquée (J+3, J+15, J+45) plutôt que de la
 * laisser deviner : l'agent doit pouvoir justifier une escalade sans ouvrir la
 * procédure écrite.
 *
 * « Traiter la file » emmène sur l'étape ouverte la plus grave — c'est l'ordre
 * dans lequel la file doit être vidée, et le bouton ne fait rien d'autre que
 * l'appliquer.
 */
export function CollectionsHeader({ funnel }: { funnel: CollectionFunnel }) {
    const t = useTranslations('AdminCollections');
    const router = useRouter();
    const searchParams = useSearchParams();

    const target = (['authority', 'formal', 'reminder'] as const).find(
        (stage) => funnel.columns[stage].count > 0,
    );

    function treatQueue() {
        if (!target) return;
        const params = new URLSearchParams(searchParams.toString());
        params.delete('page');
        params.delete('status');
        params.set('latestTier', STAGE_TIERS[target][0]);
        router.push(`?${params.toString()}`);
    }

    return (
        <OsPageHeader
            title={t('verdict', { count: funnel.actionable })}
            subtitle={t('rule')}
            actions={
                <button
                    type="button"
                    onClick={treatQueue}
                    disabled={!target}
                    className="flex h-10 items-center rounded-[10px] bg-[var(--os-brand-green)] px-[18px] text-[13.5px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                >
                    {t('treatQueue')}
                </button>
            }
        />
    );
}
