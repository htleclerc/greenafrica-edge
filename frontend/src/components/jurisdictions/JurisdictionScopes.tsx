'use client';

import { useTranslations } from 'next-intl';
import { Ship, Plane, Pickaxe, type LucideIcon } from 'lucide-react';
import type { JurisdictionScope } from '@/components/jurisdictions/profiles.generated';

const MODE_ICONS: Record<JurisdictionScope['mode'], LucideIcon> = {
    MARITIME: Ship,
    AIR: Plane,
    MINING: Pickaxe,
};

/** Ordre d'affichage des branches, indépendant de l'ordre de saisie du JSON. */
const MODE_ORDER: ReadonlyArray<JurisdictionScope['mode']> = ['MARITIME', 'AIR', 'MINING'];

/**
 * « Sur quelle branche d'activité peut-on intervenir » : les flux qu'une
 * juridiction présente, groupés par mode.
 *
 * Les passerelles (`gateway`) sont des noms propres — port, aéroport, bassin
 * minier — et ne passent donc pas par l'i18n. Seuls le mode et l'activité sont
 * traduits, via un vocabulaire contrôlé : c'est ce qui permet de tenir treize
 * pays en six langues sans rédiger de prose par pays.
 */
export function JurisdictionScopes({ scopes, announcedModes, isLive }: Readonly<{ scopes: readonly JurisdictionScope[]; announcedModes: readonly JurisdictionScope['mode'][]; isLive: boolean }>) {
    const t = useTranslations('Jurisdiction');
    const l = useTranslations('Landing');

    // Le référentiel documente la réalité du pays ; le site n'affiche que le
    // périmètre annoncé dans coverage.ts. Sans ce filtre, la pastille du hero
    // (« Maritime + Mines ») et cette section (« Maritime, Aérien, Mines »)
    // se contrediraient sur la même page — ce qui s'est produit sur la Guinée.
    // Élargir le périmètre public est une décision éditoriale : elle se prend
    // dans coverage.ts, pas par effet de bord d'une donnée saisie ici.
    const byMode = MODE_ORDER
        .filter((mode) => announcedModes.includes(mode))
        .map((mode) => ({ mode, items: scopes.filter((s) => s.mode === mode) }))
        .filter((group) => group.items.length > 0);

    if (byMode.length === 0) return null;

    return (
        <section className="py-12 sm:py-16 px-3 sm:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-4xl mx-auto">
                <h2 className="text-xl sm:text-2xl font-bold mb-2" style={{ color: 'var(--ais-page-text)' }}>
                    {isLive ? t('scope_title_live') : t('scope_title_pipeline')}
                </h2>
                <p className="text-[13px] leading-relaxed mb-7 max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {isLive ? t('scope_intro_live') : t('scope_intro_pipeline')}
                </p>

                <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 list-none">
                    {byMode.map(({ mode, items }) => {
                        const Icon = MODE_ICONS[mode];
                        return (
                            <li
                                key={mode}
                                className="rounded-2xl p-5"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                <div className="flex items-center gap-2.5 mb-4">
                                    <span className="w-8 h-8 shrink-0 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                        <Icon className="w-4 h-4 text-emerald-400" />
                                    </span>
                                    <h3 className="coverage-track text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--ais-page-text-muted)' }}>
                                        {l(`coverage_mode_${mode.toLowerCase()}`)}
                                    </h3>
                                </div>

                                <ul role="list" className="space-y-3 list-none">
                                    {items.map((scope) => (
                                        <li key={`${scope.activity}-${scope.gateway}`}>
                                            <span className="block text-sm font-semibold" style={{ color: 'var(--ais-page-text)' }}>
                                                {t(`activity_${scope.activity}`)}
                                            </span>
                                            <span className="block text-[12px] leading-snug mt-0.5" style={{ color: 'var(--ais-page-text-muted)' }}>
                                                {scope.gateway}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}
