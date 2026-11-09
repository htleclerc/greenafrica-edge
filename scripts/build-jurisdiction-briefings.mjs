// Génère un dossier par juridiction, à l'usage interne, depuis le référentiel pays.
//
// Pendant de build-jurisdiction-profiles.mjs : celui-ci n'extrait que le
// publiable vers le frontend, celui-là reprend TOUT — bloc `internal` compris —
// pour qui rédige une note conceptuelle ou un dossier gouvernemental. Les deux
// lisent la même source, de sorte qu'un chiffre corrigé dans
// data/jurisdictions/ se propage au site et aux notes sans ressaisie.
//
// La sortie contient des montants confidentiels. Elle part dans briefings/,
// qui porte son propre .gitignore : ces fichiers se régénèrent, ils n'ont
// rien à faire dans l'historique.
//
//   node scripts/build-jurisdiction-briefings.mjs
//   node scripts/build-jurisdiction-briefings.mjs --check   (CI : échoue si périmé)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data', 'jurisdictions');
const OUT_DIR = join(DATA_DIR, 'briefings');
const COVERAGE = join(ROOT, 'frontend', 'src', 'components', 'landing', 'coverage.ts');
const MESSAGES = join(ROOT, 'frontend', 'messages', 'fr.json');

const MODE_LABELS = { MARITIME: 'Maritime', AIR: 'Aérien', MINING: 'Mines' };
const MODE_ORDER = ['MARITIME', 'AIR', 'MINING'];

function fail(message) {
    console.error(`[build-jurisdiction-briefings] ${message}`);
    process.exit(1);
}

/**
 * Le périmètre annoncé publiquement vit dans coverage.ts, pas dans le
 * référentiel : c'est une décision éditoriale. On le relit ici pour pouvoir
 * dire, pays par pays, ce qui est documenté mais pas annoncé — l'écart est
 * précisément ce qu'un arbitrage de périmètre demande de voir.
 *
 * Lecture d'un fichier TypeScript par expression régulière, donc : chaque cas
 * non reconnu interrompt la génération. Une lecture partielle serait pire
 * qu'une erreur — elle produirait des dossiers qui affirment « aucun mode
 * annoncé » pour un pays qui en annonce.
 */
function readAnnouncedModes() {
    const source = readFileSync(COVERAGE, 'utf8');

    // `modes:` vaut soit un tableau littéral, soit l'une des constantes
    // partagées déclarées en tête de fichier (`modes: MARITIME`).
    const constants = new Map(
        [...source.matchAll(/const (\w+): readonly CoverageMode\[\] = \[([^\]]*)\]/g)]
            .map(([, name, values]) => [name, [...values.matchAll(/'(\w+)'/g)].map((m) => m[1])]),
    );

    const entries = [...source.matchAll(/\{[^{}]*key:\s*'([a-z-]+)'[^{}]*\}/g)];
    if (entries.length === 0) fail(`aucune juridiction lue dans ${COVERAGE} — le format a changé, corrigez l'extraction.`);

    return new Map(entries.map(([entry, key]) => {
        const modesExpression = entry.match(/modes:\s*(\[[^\]]*\]|\w+)/)?.[1];
        const status = entry.match(/status:\s*'(\w+)'/)?.[1];
        if (!modesExpression || !status) fail(`juridiction "${key}" : "modes" ou "status" illisible dans ${COVERAGE}.`);

        const modes = modesExpression.startsWith('[')
            ? [...modesExpression.matchAll(/'(\w+)'/g)].map((m) => m[1])
            : constants.get(modesExpression);
        if (!modes) fail(`juridiction "${key}" : "modes: ${modesExpression}" ne renvoie à aucune constante connue de ${COVERAGE}.`);

        return [key, { modes, status }];
    }));
}

function readNames() {
    const messages = JSON.parse(readFileSync(MESSAGES, 'utf8'));
    return (key) => messages.Landing?.[`coverage_country_${key}`] ?? key;
}

const formatNumber = (value) => new Intl.NumberFormat('fr-FR').format(value);

/**
 * Rend un bloc de montants de forme libre : les clés diffèrent d'un pays à
 * l'autre. Le nom de la clé est le seul indice du type de la valeur — une année
 * séparée par milliers (« 2 030 ») se lirait comme une quantité.
 */
function renderAmounts(value, depth = 0, key = '') {
    const pad = '  '.repeat(depth);
    if (typeof value === 'number') return ` ${/year$/.test(key) ? value : formatNumber(value)}`;
    if (typeof value !== 'object' || value === null) return ` ${value}`;

    return Object.entries(value)
        .map(([k, v]) => `\n${pad}- **${k}** :${renderAmounts(v, depth + 1, k)}`)
        .join('');
}

function renderFigureTable(figures) {
    const rows = figures.map((f) => {
        const source = f.sourceUrl ? `[${f.sourceLabel}](${f.sourceUrl})` : f.sourceLabel;
        const cells = [
            f.metric,
            formatNumber(f.value),
            f.period ?? String(f.year),
            f.gateway ?? '—',
            MODE_LABELS[f.mode],
            source,
            f.note ?? '',
        ];
        // Une note contenant un pipe casserait la ligne du tableau.
        return `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
    });

    return [
        '| Indicateur | Valeur | Année | Passerelle | Branche | Source | Remarque |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...rows,
    ].join('\n');
}

function renderBriefing(profile, announced, name) {
    const documented = MODE_ORDER.filter((m) => profile.scopes.some((s) => s.mode === m));
    const announcedModes = announced?.modes ?? [];
    const undocumented = announcedModes.filter((m) => !documented.includes(m));
    const unannounced = documented.filter((m) => !announcedModes.includes(m));

    const recorded = profile.figures.filter((f) => !f.projection);
    const outlook = profile.figures.filter((f) => f.projection);

    const lines = [
        `# ${name} — dossier juridiction`,
        '',
        '> **Usage interne.** Ce document reprend le bloc `internal` du référentiel :',
        "> montants, hypothèses et réserves. Rien ici n'est publiable en l'état.",
        `> Généré depuis \`data/jurisdictions/${profile.key}.json\` — ne pas modifier à la main.`,
        '',
        '## Périmètre',
        '',
        `- **Statut** : ${announced?.status ?? 'absent de coverage.ts'}`,
        `- **Annoncé publiquement** : ${announcedModes.map((m) => MODE_LABELS[m]).join(', ') || '—'}`,
        `- **Documenté dans le référentiel** : ${documented.map((m) => MODE_LABELS[m]).join(', ')}`,
    ];

    // L'écart entre les deux listes est le cœur de l'arbitrage : annoncer sans
    // documenter est une affirmation à vide, documenter sans annoncer est une
    // assiette laissée de côté. Les deux méritent d'être nommés.
    if (undocumented.length > 0) {
        lines.push('', `⚠️ **Annoncé sans être documenté** : ${undocumented.map((m) => MODE_LABELS[m]).join(', ')} — aucun flux sourcé derrière cette annonce.`);
    }
    if (unannounced.length > 0) {
        lines.push('', `**Documenté sans être annoncé** : ${unannounced.map((m) => MODE_LABELS[m]).join(', ')} — le site n'en dit rien ; assiette disponible si le périmètre s'élargit.`);
    }

    lines.push('', '## Branches sur lesquelles la contribution peut porter', '');
    for (const mode of documented) {
        lines.push(`### ${MODE_LABELS[mode]}${announcedModes.includes(mode) ? '' : ' *(non annoncé)*'}`, '');
        for (const scope of profile.scopes.filter((s) => s.mode === mode)) {
            lines.push(`- **${scope.activity}** — ${scope.gateway}`);
        }
        lines.push('');
    }

    lines.push('## Trafic constaté', '');
    lines.push(recorded.length > 0 ? renderFigureTable(recorded) : '_Aucune mesure de trafic sourcée. Voir les réserves ci-dessous._');

    if (outlook.length > 0) {
        lines.push('', '## Perspectives annoncées', '', '_Chiffres que leurs sources qualifient elles-mêmes de projection._', '', renderFigureTable(outlook));
    }

    const amounts = Object.entries(profile.internal ?? {}).filter(([k]) => k !== 'notes');
    if (amounts.length > 0) {
        lines.push('', '## Montants (confidentiel)', '');
        for (const [key, value] of amounts) {
            lines.push(`**${key}** :${renderAmounts(value, 1)}`, '');
        }
    }

    if (profile.internal?.notes) {
        lines.push('', '## Analyse et réserves (confidentiel)', '', profile.internal.notes);
    }

    lines.push('', '---', '', `Source de la recherche : ${profile.sourceDocument ?? 'non renseignée'}.`);

    return `${lines.join('\n')}\n`.replace(/\r?\n/g, '\r\n');
}

const announcedByKey = readAnnouncedModes();
const nameFor = readNames();

const briefings = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
        const profile = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
        const announced = announcedByKey.get(profile.key);
        // Un pays documenté qu'on ne retrouve pas dans coverage.ts signale une
        // incohérence, pas un périmètre vide : on s'arrête.
        if (!announced) fail(`${file} : la juridiction "${profile.key}" est absente de ${COVERAGE}.`);

        return {
            file: `${profile.key}.md`,
            content: renderBriefing(profile, announced, nameFor(profile.key)),
        };
    });

if (process.argv.includes('--check')) {
    for (const { file, content } of briefings) {
        const path = join(OUT_DIR, file);
        if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
            fail(`${file} est périmé. Lancez : node scripts/build-jurisdiction-briefings.mjs`);
        }
    }
    console.log(`[build-jurisdiction-briefings] ${briefings.length} dossiers à jour.`);
} else {
    mkdirSync(OUT_DIR, { recursive: true });
    // Ces fichiers portent des montants internes et se régénèrent : ils ne
    // doivent jamais entrer dans l'historique, même si data/ y entre un jour.
    writeFileSync(join(OUT_DIR, '.gitignore'), '*\r\n');
    for (const { file, content } of briefings) writeFileSync(join(OUT_DIR, file), content);
    console.log(`[build-jurisdiction-briefings] écrit ${briefings.length} dossiers dans ${OUT_DIR}`);
}
