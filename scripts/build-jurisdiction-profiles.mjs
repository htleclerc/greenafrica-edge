// Génère le sous-ensemble PUBLIABLE du référentiel pays vers le frontend.
//
// Pourquoi un générateur plutôt qu'un import direct : les fichiers de
// data/jurisdictions/ portent un bloc `internal` (potentiel de recettes,
// montants liquidés, base de tarification). Tout ce qu'un composant importe
// depuis frontend/src/ part dans le bundle client, donc devient public. Ce
// script ne recopie que `scopes` et `figures`.
//
//   node scripts/build-jurisdiction-profiles.mjs
//   node scripts/build-jurisdiction-profiles.mjs --check   (CI : échoue si périmé)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data', 'jurisdictions');
const OUT = join(ROOT, 'frontend', 'src', 'components', 'jurisdictions', 'profiles.generated.ts');

/** Champs recopiés vers le front. Toute autre clé de premier niveau est écartée. */
const PUBLIC_KEYS = ['key', 'status', 'scopes', 'figures'];
/** Champs d'un `figure` recopiés vers le front. */
const FIGURE_KEYS = ['metric', 'mode', 'subject', 'gateway', 'value', 'year', 'period', 'projection', 'sourceLabel', 'sourceUrl', 'note'];
/** Champs d'un `scope` recopiés vers le front. */
const SCOPE_KEYS = ['mode', 'activity', 'gateway'];
/** Clés de premier niveau connues mais volontairement non publiées. */
const WITHHELD_KEYS = ['internal', 'sourceDocument'];

const MODES = ['MARITIME', 'AIR', 'MINING'];
const STATUSES = ['live', 'pipeline'];

function fail(message) {
    console.error(`[build-jurisdiction-profiles] ${message}`);
    process.exit(1);
}

function pick(source, keys, context) {
    const unknown = Object.keys(source).filter((k) => !keys.includes(k) && !WITHHELD_KEYS.includes(k));
    if (unknown.length > 0) {
        // Une clé inattendue est plus souvent une faute de frappe qu'une
        // extension voulue : on refuse plutôt que de la perdre en silence.
        fail(`${context} : clé(s) non reconnue(s) ${unknown.join(', ')}. Déclarez-la dans le script ou corrigez le JSON.`);
    }
    const out = {};
    for (const k of keys) {
        // `null` sur un champ facultatif vaut « absent » : on l'écarte plutôt
        // que de l'émettre, sinon le type généré devrait accepter `null`
        // partout. `sourceUrl` fait exception : son `null` est porteur de sens
        // (source connue mais non reliable).
        if (source[k] === undefined) continue;
        if (source[k] === null && k !== 'sourceUrl') continue;
        out[k] = source[k];
    }
    return out;
}

function readProfiles() {
    const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) fail(`aucun fichier .json dans ${DATA_DIR}`);

    return files.map((file) => {
        const raw = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
        const context = `data/jurisdictions/${file}`;

        if (`${raw.key}.json` !== file) fail(`${context} : la clé "${raw.key}" ne correspond pas au nom du fichier.`);
        if (!STATUSES.includes(raw.status)) fail(`${context} : status "${raw.status}" invalide.`);
        if (!Array.isArray(raw.scopes) || raw.scopes.length === 0) fail(`${context} : "scopes" vide — il faut au moins une branche d'activité.`);
        if (!Array.isArray(raw.figures)) fail(`${context} : "figures" doit être un tableau (éventuellement vide).`);

        // Valide la forme complète, bloc interne compris, avant de ne garder que le publiable.
        pick(raw, PUBLIC_KEYS, context);

        const scopes = raw.scopes.map((s, i) => {
            const scope = pick(s, SCOPE_KEYS, `${context} scopes[${i}]`);
            if (!MODES.includes(scope.mode)) fail(`${context} scopes[${i}] : mode "${scope.mode}" invalide.`);
            if (!scope.activity || !scope.gateway) fail(`${context} scopes[${i}] : "activity" et "gateway" sont obligatoires.`);
            return scope;
        });

        const figures = raw.figures.map((f, i) => {
            const figure = pick(f, FIGURE_KEYS, `${context} figures[${i}]`);
            // Règle 1 du schéma : aucun chiffre sans année ni source.
            if (typeof figure.value !== 'number' || !Number.isFinite(figure.value)) fail(`${context} figures[${i}] : "value" doit être un nombre.`);
            if (typeof figure.year !== 'number') fail(`${context} figures[${i}] : "year" est obligatoire.`);
            // Le mode conditionne l'affichage : une juridiction annoncée
            // maritime ne doit pas exposer un comptage de mouvements d'avions.
            if (!MODES.includes(figure.mode)) fail(`${context} figures[${i}] : "mode" est obligatoire et doit valoir ${MODES.join(' | ')}.`);
            if (!figure.sourceLabel) fail(`${context} figures[${i}] : "sourceLabel" est obligatoire — un chiffre sans source ne se publie pas.`);
            if (figure.sourceUrl === undefined) fail(`${context} figures[${i}] : "sourceUrl" est obligatoire (null si la source n'est pas reliable).`);
            // Ces URL deviennent des liens sortants sur une page publique. On
            // contraint le schéma ici, à la saisie, plutôt qu'au rendu : un
            // `javascript:` ou un `data:` recopié par erreur n'atteint jamais le
            // bundle.
            if (figure.sourceUrl !== null && !/^https:\/\/[^\s]+$/.test(figure.sourceUrl)) {
                fail(`${context} figures[${i}] : "sourceUrl" doit être une URL https (ou null). Reçu : ${figure.sourceUrl}`);
            }
            return figure;
        });

        return { key: raw.key, status: raw.status, scopes, figures };
    });
}

function unionType(name, values, comment) {
    if (values.length === 0) return `${comment}\nexport type ${name} = never;\n`;
    const body = values.map((v) => `    | '${v}'`).join('\n');
    return `${comment}\nexport type ${name} =\n${body};\n`;
}

function render(profiles) {
    const activities = [...new Set(profiles.flatMap((p) => p.scopes.map((s) => s.activity)))].sort();
    const metrics = [...new Set(profiles.flatMap((p) => p.figures.map((f) => f.metric)))].sort();

    const header = `// FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN.
// Source : data/jurisdictions/*.json
// Régénérer : node scripts/build-jurisdiction-profiles.mjs
//
// Ne contient que le sous-ensemble publiable du référentiel pays. Les montants
// (potentiel de recettes, contributions liquidées) vivent dans le bloc
// \`internal\` des fichiers source et n'arrivent jamais ici : ce module est
// importé par des composants, donc son contenu est servi au navigateur.
`;

    const types = `
${unionType('ActivityCode', activities, "/**\n * Branche d'activité sur laquelle la contribution peut porter.\n * Union déduite des codes réellement utilisés : pas de vocabulaire mort.\n * Chaque code doit avoir une clé i18n `Jurisdiction.activity_<code>`.\n */")}
${unionType('MetricCode', metrics, "/**\n * Indicateur de trafic publiable.\n * Chaque code doit avoir une clé i18n `Jurisdiction.metric_<code>`.\n */")}
/** Mesure de trafic sourcée. Ni \`value\` ni \`year\` ne sont facultatifs. */
export interface JurisdictionFigure {
    metric: MetricCode;
    /** Branche dont relève la mesure : le site ne montre que les branches annoncées. */
    mode: 'MARITIME' | 'AIR' | 'MINING';
    /** Qualifie la mesure quand l'indicateur seul est ambigu (ex. tonnes de quoi). */
    subject?: ActivityCode;
    /** Port ou aéroport mesuré, quand le pays en compte plusieurs. Nom propre : jamais traduit. */
    gateway?: string;
    value: number;
    year: number;
    /** Présent quand la mesure ne couvre pas une année pleine : à afficher, sinon le chiffre se lit comme annuel. */
    period?: string;
    /** \`true\` quand la source qualifie elle-même le chiffre de projection. */
    projection?: boolean;
    sourceLabel: string;
    /** \`null\` quand seule la référence papier est connue — on affiche le libellé sans lien. */
    sourceUrl: string | null;
    note?: string;
}

/** Ce sur quoi la contribution peut porter, dans une juridiction donnée. */
export interface JurisdictionScope {
    mode: 'MARITIME' | 'AIR' | 'MINING';
    activity: ActivityCode;
    /** Port, aéroport ou bassin minier. Nom propre : jamais traduit. */
    gateway: string;
}

export interface JurisdictionProfile {
    key: string;
    status: 'live' | 'pipeline';
    scopes: readonly JurisdictionScope[];
    figures: readonly JurisdictionFigure[];
}
`;

    const body = `
const PROFILES: readonly JurisdictionProfile[] = ${JSON.stringify(profiles, null, 4)};

/** Profil d'une juridiction, ou \`undefined\` si elle n'est pas encore documentée. */
export function profileFor(key: string): JurisdictionProfile | undefined {
    return PROFILES.find((p) => p.key === key);
}

/** Toutes les juridictions documentées. L'ordre d'affichage vient de coverage.ts, pas d'ici. */
export const JURISDICTION_PROFILES = PROFILES;
`;

    // LF, parce que c'est ce que git stocke pour ce fichier (`ls-files --eol` : i/lf).
    // Forcer CRLF ne tenait que sous Windows, ou autocrlf reconvertit a la sortie du
    // depot ; sur un runner Linux le fichier arrive en LF et le controle ci-dessous
    // criait au fichier perime a chaque fois.
    return (header + types + body).replace(/\r\n/g, '\n');
}

const generated = render(readProfiles());

/** Les fins de ligne du fichier pose sur le disque dependent de la plateforme et du
 *  parametrage git du poste : elles ne disent rien du contenu. On compare le reste. */
const sansFinsDeLigne = (texte) => texte.replace(/\r\n/g, '\n');

if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (sansFinsDeLigne(current) !== sansFinsDeLigne(generated)) {
        fail('profiles.generated.ts est périmé. Lancez : node scripts/build-jurisdiction-profiles.mjs');
    }
    console.log('[build-jurisdiction-profiles] à jour.');
} else {
    writeFileSync(OUT, generated);
    console.log(`[build-jurisdiction-profiles] écrit ${OUT}`);
}
