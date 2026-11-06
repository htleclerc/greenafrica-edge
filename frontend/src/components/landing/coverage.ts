/** Statut de déploiement affiché sur la page publique. */
export type CoverageStatus = 'live' | 'pipeline';

/**
 * Même vocabulaire que l'enum `public.transport_mode` en base, et même forme
 * de tableau que `shipowners.applicable_modes` (mig 160) : une juridiction
 * peut relever des deux modes.
 *
 * Le mode est une décision métier, pas une déduction géographique — la
 * Mauritanie a un littoral et relève pourtant de l'aérien.
 */
export type TransportMode = 'MARITIME' | 'AIR';

export interface CoverageCountry {
    /**
     * Identifiant stable, aussi utilisé comme suffixe de clé i18n
     * (`Landing.coverage_country_<key>`). Code ISO-3166 alpha-2 en minuscules
     * quand il existe — `somaliland` n'a pas de code ISO.
     */
    key: string;
    /**
     * Drapeau servi depuis /public. Les fichiers sont vendorés localement :
     * le CSP (`img-src 'self' data: blob: …`, next.config.ts) interdit tout CDN
     * externe, et Windows n'a pas de glyphes emoji drapeau.
     */
    flag: string;
    /**
     * Rapport largeur/hauteur du drapeau. Tous les SVG de flag-icons sont en
     * 4:3 (640x480) ; celui du Somaliland est en 2:1. On rend à hauteur fixe et
     * largeur dérivée : aucun emblème n'est recadré.
     */
    ratio: number;
    /** Modes dont relève la juridiction. Jamais vide. */
    modes: readonly TransportMode[];
    status: CoverageStatus;
}

const MARITIME: readonly TransportMode[] = ['MARITIME'];
const AIR: readonly TransportMode[] = ['AIR'];

/** Format de tous les drapeaux ISO vendorés (640x480). */
const R_4_3 = 4 / 3;

/**
 * Juridictions montrées sur la page d'accueil pour matérialiser le caractère
 * multi-pays de la plateforme.
 *
 * `live` = la juridiction existe réellement dans la plateforme (table
 * `jurisdictions`, site opérationnel, barème). `pipeline` = annoncé comme
 * déploiement à venir, aucune perception en cours — le libellé public doit le
 * dire explicitement (`coverage_disclaimer`).
 *
 * L'ordre du tableau est l'ordre d'affichage.
 */
export const COVERAGE_COUNTRIES: readonly CoverageCountry[] = [
    // Somaliland porte les deux modes : le port de Berbera et le portail
    // aviation (opérateurs aériens en service).
    { key: 'somaliland', flag: '/brand/somaliland-flag.svg', ratio: 2, modes: ['MARITIME', 'AIR'], status: 'live' },
    { key: 'dj', flag: '/flags/dj.svg', ratio: R_4_3, modes: MARITIME, status: 'live' },
    { key: 'ao', flag: '/flags/ao.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'gn', flag: '/flags/gn.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'sn', flag: '/flags/sn.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'ci', flag: '/flags/ci.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'gh', flag: '/flags/gh.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'ng', flag: '/flags/ng.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'cm', flag: '/flags/cm.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'ga', flag: '/flags/ga.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    { key: 'mz', flag: '/flags/mz.svg', ratio: R_4_3, modes: MARITIME, status: 'pipeline' },
    // Mauritanie et Niger : aérien. La Mauritanie a un littoral — c'est bien
    // une décision métier, pas la géographie, qui fixe le mode. Le Niger étant
    // enclavé, le libellé de la section parle d'États souverains et couvre
    // zone maritime ET espace aérien, non de « pays côtiers ».
    { key: 'mr', flag: '/flags/mr.svg', ratio: R_4_3, modes: AIR, status: 'pipeline' },
    { key: 'ne', flag: '/flags/ne.svg', ratio: R_4_3, modes: AIR, status: 'pipeline' },
];

export const LIVE_COUNTRIES = COVERAGE_COUNTRIES.filter((c) => c.status === 'live');
export const PIPELINE_COUNTRIES = COVERAGE_COUNTRIES.filter((c) => c.status === 'pipeline');
