'use client';

import { useTranslations, useLocale } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import type { JurisdictionFigure } from '@/components/jurisdictions/profiles.generated';

/**
 * Au-delà du million, un nombre brut devient un mur de chiffres : 183 000 000
 * se lit moins bien que « 183 M ». En dessous, on garde la valeur exacte — un
 * trafic de 416 892 EVP est citable tel quel, et l'arrondir coûterait en
 * crédibilité ce qu'il gagnerait en concision.
 */
const COMPACT_THRESHOLD = 1_000_000;

function useFigureFormat() {
    const locale = useLocale();
    return (value: number) =>
        new Intl.NumberFormat(locale, value >= COMPACT_THRESHOLD ? { notation: 'compact', maximumFractionDigits: 1 } : {}).format(value);
}

/**
 * Une mesure de trafic. Tuile nue : ni delta, ni courbe de tendance, ni
 * infobulle — on n'a qu'un point par indicateur, et la méthode d'affichage
 * dispense d'interaction une tuile sans tracé.
 *
 * La valeur porte les jetons de texte, jamais une couleur de série : ici rien
 * n'est catégoriel, donc rien ne justifie de teinter un chiffre.
 */
function FigureTile({ figure }: Readonly<{ figure: JurisdictionFigure }>) {
    const t = useTranslations('Jurisdiction');
    const format = useFigureFormat();

    const label = t(`metric_${figure.metric}`);
    const qualifier = figure.subject ? t(`activity_${figure.subject}`) : null;

    return (
        <li
            className="rounded-2xl p-5"
            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
        >
            {/* Pas de `tabular-nums` : à cette taille, des chiffres de largeur
                égale font paraître « 391 » distendu. */}
            <p className="text-3xl font-semibold leading-none tracking-tight" style={{ color: 'var(--ais-page-text)' }}>
                {format(figure.value)}
            </p>

            <p className="text-[13px] font-medium mt-2.5" style={{ color: 'var(--ais-page-text)' }}>
                {label}
                {qualifier && <span style={{ color: 'var(--ais-page-text-muted)' }}>{` · ${qualifier}`}</span>}
            </p>

            {/* Un pays compte souvent plusieurs ports : sans cette ligne, deux
                comptages d'escales voisins seraient indiscernables. */}
            {figure.gateway && (
                <p className="text-[12px] leading-snug mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {figure.gateway}
                </p>
            )}

            {figure.note && (
                <p className="text-[12px] leading-snug mt-1.5" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {figure.note}
                </p>
            )}

            <p className="text-[11px] leading-snug mt-3 pt-3" style={{ color: 'var(--ais-page-text-muted)', borderTop: '1px solid var(--ais-page-border)' }}>
                {`${t('source_prefix')} : `}
                {figure.sourceUrl ? (
                    <a
                        href={figure.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-emerald-400 transition-colors inline-flex items-center gap-1"
                    >
                        {figure.sourceLabel}
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                    </a>
                ) : (
                    figure.sourceLabel
                )}
                {/* La période prime sur l'année : sans elle, 391 escales sur
                    quatre mois se lisent comme 391 escales par an. */}
                {` — ${figure.period ?? figure.year}`}
            </p>
        </li>
    );
}

/**
 * Le trafic d'une juridiction, en deux blocs : ce qui est constaté, et ce que
 * les sources annoncent elles-mêmes comme projection.
 *
 * Aucun montant n'apparaît ici. Le potentiel de recettes vit dans le bloc
 * `internal` de data/jurisdictions/ et n'est pas repris par le générateur :
 * ce module est servi au navigateur.
 */
export function JurisdictionFigures({ figures, announcedModes }: Readonly<{ figures: readonly JurisdictionFigure[]; announcedModes: readonly JurisdictionFigure['mode'][] }>) {
    const t = useTranslations('Jurisdiction');

    // Même filtre que sur les branches : une juridiction annoncée maritime ne
    // doit pas exposer un comptage de mouvements d'avions, qui laisserait
    // croire que l'aérien y est dans le périmètre.
    const shown = figures.filter((f) => announcedModes.includes(f.mode));
    const recorded = shown.filter((f) => !f.projection);
    const outlook = shown.filter((f) => f.projection);

    return (
        <section className="py-12 sm:py-16 px-3 sm:px-6" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
            <div className="max-w-4xl mx-auto">
                <h2 className="text-xl sm:text-2xl font-bold mb-2" style={{ color: 'var(--ais-page-text)' }}>
                    {t('traffic_title')}
                </h2>
                <p className="text-[13px] leading-relaxed mb-7 max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('traffic_intro')}
                </p>

                {recorded.length === 0 ? (
                    <p className="text-[13px] leading-relaxed rounded-xl p-4" style={{ color: 'var(--ais-page-text-muted)', border: '1px dashed var(--ais-page-border)' }}>
                        {t('traffic_empty')}
                    </p>
                ) : (
                    <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 list-none">
                        {recorded.map((figure, i) => (
                            <FigureTile key={`${figure.metric}-${figure.gateway ?? i}`} figure={figure} />
                        ))}
                    </ul>
                )}

                {outlook.length > 0 && (
                    <>
                        <h3 className="text-base sm:text-lg font-bold mt-12 mb-2" style={{ color: 'var(--ais-page-text)' }}>
                            {t('outlook_title')}
                        </h3>
                        <p className="text-[13px] leading-relaxed mb-5 max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>
                            {t('outlook_intro')}
                        </p>
                        <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 list-none">
                            {outlook.map((figure, i) => (
                                <FigureTile key={`${figure.metric}-${figure.gateway ?? i}`} figure={figure} />
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </section>
    );
}
