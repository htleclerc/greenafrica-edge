import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import fr from '../../../messages/fr.json';
import pt from '../../../messages/pt.json';
import so from '../../../messages/so.json';
import sw from '../../../messages/sw.json';
import { COVERAGE_COUNTRIES } from '@/components/landing/coverage';
import { JURISDICTION_PROFILES, profileFor } from './profiles.generated';

type Messages = Record<string, Record<string, string>>;

const CATALOGS: ReadonlyArray<readonly [string, Messages]> = [
    ['en', en as unknown as Messages],
    ['fr', fr as unknown as Messages],
    ['pt', pt as unknown as Messages],
    ['so', so as unknown as Messages],
    ['sw', sw as unknown as Messages],
    ['ar', ar as unknown as Messages],
];

const REPO_ROOT = path.resolve(process.cwd(), '..');
const DATA_DIR = path.join(REPO_ROOT, 'data', 'jurisdictions');
const GENERATED = path.join(process.cwd(), 'src', 'components', 'jurisdictions', 'profiles.generated.ts');

function generatedDataBlock(): string {
    const generated = readFileSync(GENERATED, 'utf8');
    return generated.slice(generated.indexOf('const PROFILES'));
}

describe('profiles.generated.ts — garde de confidentialité', () => {
    // Le risque qu'on garde ici : un montant de recettes recopié dans un module
    // importé par un composant est servi au navigateur. Personne ne le verrait
    // à l'écran, donc seul ce test l'attrape.
    it('ne laisse fuir aucune clé du bloc interne vers le bundle', () => {
        const dataBlock = generatedDataBlock();

        for (const forbidden of ['internal', 'potential_usd', 'assessed_usd', 'breakdown', 'collected', 'legal_basis', 'sourceDocument', 'local_currency']) {
            expect(dataBlock, `"${forbidden}" ne doit pas apparaître dans les données générées`).not.toContain(forbidden);
        }
    });

    it('ne laisse fuir aucun montant présent dans les fichiers source', () => {
        const dataBlock = generatedDataBlock();

        // Confronte le fichier publié aux vrais montants du référentiel plutôt
        // qu'à une liste de mots-clés : une clé renommée resterait attrapée.
        for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
            const raw = JSON.parse(readFileSync(path.join(DATA_DIR, file), 'utf8')) as { internal?: unknown };
            if (!raw.internal) continue;
            for (const amount of JSON.stringify(raw.internal).match(/\d{6,}/g) ?? []) {
                expect(dataBlock, `le montant ${amount} de ${file} a fuité`).not.toContain(amount);
            }
        }
    });

    // Les dossiers internes (build-jurisdiction-briefings.mjs) reprennent
    // volontairement les montants. Leur seul risque est d'entrer dans
    // l'historique — ce dépôt a déjà dû être purgé une fois.
    it('garde les dossiers internes hors du dépôt', () => {
        const briefings = path.join(DATA_DIR, 'briefings');
        if (!existsSync(briefings)) return; // jamais générés sur ce poste

        expect(readFileSync(path.join(briefings, '.gitignore'), 'utf8').trim()).toBe('*');
        const tracked = execFileSync('git', ['ls-files', '--', 'data/jurisdictions/briefings'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        expect(tracked.trim(), 'des dossiers internes sont suivis par git').toBe('');
    });

    it('est à jour par rapport à data/jurisdictions/', () => {
        // Un fichier généré périmé ferait passer les autres tests sur des
        // données que personne ne sert plus.
        expect(() =>
            execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'build-jurisdiction-profiles.mjs'), '--check'], { stdio: 'pipe' }),
        ).not.toThrow();
    });
});

describe('profiles.generated.ts — cohérence avec coverage.ts', () => {
    it('ne documente que des juridictions qui existent', () => {
        const known = new Set(COVERAGE_COUNTRIES.map((c) => c.key));
        for (const profile of JURISDICTION_PROFILES) {
            expect(known.has(profile.key), `profil orphelin : ${profile.key}`).toBe(true);
        }
    });

    it('porte le même statut que coverage.ts', () => {
        for (const profile of JURISDICTION_PROFILES) {
            const country = COVERAGE_COUNTRIES.find((c) => c.key === profile.key);
            expect(profile.status, profile.key).toBe(country?.status);
        }
    });

    // Asymétrie voulue : documenter une branche qu'on n'annonce pas est une
    // occasion manquée, annoncer une branche qu'on ne documente pas est une
    // affirmation sans rien derrière. Seul le second cas doit casser le build.
    it('documente au moins un flux pour chaque branche annoncée', () => {
        for (const country of COVERAGE_COUNTRIES) {
            const profile = profileFor(country.key);
            if (!profile) continue;
            const documented = new Set(profile.scopes.map((s) => s.mode));
            for (const mode of country.modes) {
                expect(documented.has(mode), `${country.key} annonce ${mode} sans aucun flux documenté`).toBe(true);
            }
        }
    });
});

describe('profiles.generated.ts — publiabilité', () => {
    it('traduit chaque code du vocabulaire dans les six langues', () => {
        const activities = new Set(JURISDICTION_PROFILES.flatMap((p) => [
            ...p.scopes.map((s) => s.activity),
            ...p.figures.flatMap((f) => (f.subject ? [f.subject] : [])),
        ]));
        const metrics = new Set(JURISDICTION_PROFILES.flatMap((p) => p.figures.map((f) => f.metric)));

        for (const [locale, catalog] of CATALOGS) {
            for (const activity of activities) {
                expect(catalog.Jurisdiction?.[`activity_${activity}`], `${locale}.Jurisdiction.activity_${activity}`).toBeTruthy();
            }
            for (const metric of metrics) {
                expect(catalog.Jurisdiction?.[`metric_${metric}`], `${locale}.Jurisdiction.metric_${metric}`).toBeTruthy();
            }
        }
    });

    // Ces libellés deviennent des liens sortants sur une page publique.
    it('ne porte que des sources en https, ou aucun lien', () => {
        for (const profile of JURISDICTION_PROFILES) {
            for (const figure of profile.figures) {
                expect(figure.sourceLabel, `${profile.key}/${figure.metric}`).toBeTruthy();
                if (figure.sourceUrl !== null) {
                    expect(figure.sourceUrl, `${profile.key}/${figure.metric}`).toMatch(/^https:\/\//);
                }
            }
        }
    });

    it('date chaque chiffre', () => {
        for (const profile of JURISDICTION_PROFILES) {
            for (const figure of profile.figures) {
                expect(Number.isInteger(figure.year), `${profile.key}/${figure.metric}`).toBe(true);
                expect(figure.year, `${profile.key}/${figure.metric}`).toBeGreaterThan(2000);
            }
        }
    });
});
