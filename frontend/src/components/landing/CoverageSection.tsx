'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Globe2 } from 'lucide-react';
import { LIVE_COUNTRIES, PIPELINE_COUNTRIES, type CoverageCountry } from '@/components/landing/coverage';

/**
 * Drapeau vendoré sous /public, rendu à hauteur fixe et largeur dérivée du
 * ratio réel : aucun recadrage, y compris pour le Somaliland qui est en 2:1 là
 * où les drapeaux ISO sont en 4:3. Encadré pour rester lisible sur les 3 skins.
 */
function Flag({ country, height }: Readonly<{ country: CoverageCountry; height: number }>) {
    const width = Math.round(height * country.ratio);
    return (
        <span
            className="shrink-0 overflow-hidden rounded-[3px]"
            style={{ width, height, border: '1px solid var(--ais-page-border)' }}
        >
            <Image src={country.flag} alt="" width={width} height={height} unoptimized />
        </span>
    );
}

export function CoverageSection() {
    const t = useTranslations('Landing');

    return (
        <section
            aria-labelledby="coverage-title"
            className="pt-16 pb-12 sm:py-20 px-3 sm:px-6 relative overflow-hidden"
            style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}
        >
            {/* Lueur d'accent, cohérente avec les autres sections de la landing */}
            <div className="absolute bottom-0 left-1/4 w-[300px] sm:w-[480px] h-[300px] sm:h-[480px] bg-emerald-900/15 rounded-full blur-[140px] -translate-x-1/2 translate-y-1/3" />

            <div className="max-w-5xl mx-auto relative z-10">
                <div className="text-center mb-10 sm:mb-12">
                    <div className="coverage-live coverage-track inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold tracking-[0.15em] uppercase mb-4">
                        <Globe2 className="w-3.5 h-3.5" />
                        {t('coverage_badge')}
                    </div>
                    <h2 id="coverage-title" className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{ color: 'var(--ais-page-text)' }}>
                        {t('coverage_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('coverage_subtitle')}
                    </p>
                </div>

                {/* Juridictions réellement en service : mises en avant. Le titre
                    n'est pas affiché — la hiérarchie visuelle le dit déjà — mais
                    il existe pour la navigation par titres et nomme la liste. */}
                <h3 id="coverage-live-heading" className="sr-only">{t('coverage_live_heading')}</h3>
                <ul role="list" aria-labelledby="coverage-live-heading" className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-2xl mx-auto mb-10 sm:mb-12 list-none">
                    {LIVE_COUNTRIES.map((country) => (
                        <li
                            key={country.key}
                            className="flex items-center gap-3 sm:gap-4 rounded-2xl p-4 sm:p-5"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid rgba(16, 185, 129, 0.25)' }}
                        >
                            <Flag country={country} height={30} />
                            <div className="min-w-0">
                                <p className="text-base font-bold" style={{ color: 'var(--ais-page-text)' }}>
                                    {t(`coverage_country_${country.key}`)}
                                </p>
                                <p className="text-[11px] mt-0.5" style={{ color: 'var(--ais-page-text-muted)' }}>
                                    {t(`coverage_site_${country.key}`)}
                                </p>
                            </div>
                            <span className="coverage-live coverage-track ms-auto inline-flex items-center gap-1.5 shrink-0 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                </span>
                                {t('coverage_status_live')}
                            </span>
                        </li>
                    ))}
                </ul>

                {/* Déploiements annoncés : grille dense, volontairement plus sobre. */}
                <div className="flex items-center gap-3 mb-4">
                    <h3 id="coverage-pipeline-heading" className="coverage-track text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('coverage_pipeline_heading')}
                    </h3>
                    <span className="h-px flex-1" style={{ backgroundColor: 'var(--ais-page-border)' }} />
                </div>

                <ul role="list" aria-labelledby="coverage-pipeline-heading" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 list-none">
                    {PIPELINE_COUNTRIES.map((country) => (
                        <li
                            key={country.key}
                            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                            style={{ backgroundColor: 'var(--ais-page-surface)', border: '1px dashed var(--ais-page-border)' }}
                        >
                            <Flag country={country} height={18} />
                            <div className="min-w-0">
                                <p className="text-[13px] font-semibold" style={{ color: 'var(--ais-page-text-secondary)' }}>
                                    {t(`coverage_country_${country.key}`)}
                                </p>
                                <p className="coverage-pending coverage-track text-[10px] uppercase tracking-[0.08em]">
                                    {t('coverage_status_pipeline')}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>

                <p className="text-[11px] leading-relaxed mt-6 text-center max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('coverage_disclaimer')}
                </p>
            </div>
        </section>
    );
}
