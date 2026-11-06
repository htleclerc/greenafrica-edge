import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import fr from '../../../messages/fr.json';
import pt from '../../../messages/pt.json';
import so from '../../../messages/so.json';
import sw from '../../../messages/sw.json';
import { COVERAGE_COUNTRIES, LIVE_COUNTRIES, PIPELINE_COUNTRIES, findCountryBySlug, jurisdictionHref } from './coverage';
import { actionsFor } from '@/components/jurisdictions/actions';

type Messages = Record<string, Record<string, string>>;

const CATALOGS: ReadonlyArray<readonly [string, Messages]> = [
    ['en', en as unknown as Messages],
    ['fr', fr as unknown as Messages],
    ['pt', pt as unknown as Messages],
    ['so', so as unknown as Messages],
    ['sw', sw as unknown as Messages],
    ['ar', ar as unknown as Messages],
];

const SECTION_KEYS = [
    'coverage_badge',
    'coverage_title',
    'coverage_subtitle',
    'coverage_status_live',
    'coverage_status_pipeline',
    'coverage_mode_maritime',
    'coverage_mode_air',
    'coverage_mode_mining',
    'coverage_live_heading',
    'coverage_pipeline_heading',
    'coverage_disclaimer',
] as const;

const JURISDICTION_KEYS = [
    'back_to_coverage',
    'actions_title',
    'intro_live',
    'intro_pipeline',
    'pipeline_notice',
] as const;

describe('COVERAGE_COUNTRIES', () => {
    it('has unique keys', () => {
        const keys = COVERAGE_COUNTRIES.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('serves every flag from the local /public tree (the CSP blocks external CDNs)', () => {
        for (const country of COVERAGE_COUNTRIES) {
            expect(country.flag, country.key).toMatch(/^\/(flags|brand)\/[a-z0-9-]+\.svg$/);
        }
    });

    // Les drapeaux sont décoratifs (alt=""), donc un chemin fautif ne se voit
    // pas à l'écran : seul ce test attrape la faute de frappe.
    it('points at a flag file that actually exists on disk', () => {
        for (const country of COVERAGE_COUNTRIES) {
            const onDisk = path.join(process.cwd(), 'public', country.flag);
            expect(existsSync(onDisk), `${country.key} → ${country.flag}`).toBe(true);
        }
    });

    // Le mode est une décision métier, pas une déduction géographique (la
    // Mauritanie a un littoral et relève de l'aérien) : il doit être porté
    // explicitement par la donnée, et jamais vide.
    it('declares at least one coverage mode for every country', () => {
        for (const country of COVERAGE_COUNTRIES) {
            expect(country.modes.length, country.key).toBeGreaterThan(0);
            for (const mode of country.modes) {
                expect(['MARITIME', 'AIR', 'MINING'], `${country.key} → ${mode}`).toContain(mode);
            }
        }
    });

    // MINING n'a ni enum en base ni moteur de calcul : c'est un périmètre
    // annoncé. L'afficher sur une juridiction opérationnelle laisserait croire
    // qu'on sait déjà facturer l'extraction minière.
    it('never claims mining on a live jurisdiction', () => {
        for (const country of LIVE_COUNTRIES) {
            expect(country.modes, country.key).not.toContain('MINING');
        }
    });

    it('gives every country a unique, URL-safe slug', () => {
        const slugs = COVERAGE_COUNTRIES.map((c) => c.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const country of COVERAGE_COUNTRIES) {
            expect(country.slug, country.key).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(jurisdictionHref(country)).toBe(`/jurisdictions/${country.slug}`);
            expect(findCountryBySlug(country.slug)).toBe(country);
        }
    });

    it('resolves an unknown slug to undefined', () => {
        expect(findCountryBySlug('atlantis')).toBeUndefined();
    });

    it('declares a plausible aspect ratio for every flag', () => {
        for (const country of COVERAGE_COUNTRIES) {
            expect(country.ratio, country.key).toBeGreaterThan(1);
            expect(country.ratio, country.key).toBeLessThanOrEqual(2);
        }
    });

    it('splits into the two rendered tiers without losing a country', () => {
        expect(LIVE_COUNTRIES.length + PIPELINE_COUNTRIES.length).toBe(COVERAGE_COUNTRIES.length);
        expect(LIVE_COUNTRIES.length).toBeGreaterThan(0);
        expect(PIPELINE_COUNTRIES.length).toBeGreaterThan(0);
    });
});

describe('Landing coverage message catalog', () => {
    for (const [locale, catalog] of CATALOGS) {
        describe(locale, () => {
            it('defines every section key', () => {
                for (const key of SECTION_KEYS) {
                    expect(catalog.Landing?.[key], `${locale}.Landing.${key}`).toBeTruthy();
                }
            });

            it('names every country', () => {
                for (const country of COVERAGE_COUNTRIES) {
                    const key = `coverage_country_${country.key}`;
                    expect(catalog.Landing?.[key], `${locale}.Landing.${key}`).toBeTruthy();
                }
            });

            // Le sous-titre « site opérationnel » n'est rendu que pour les
            // juridictions en service — lui seul doit avoir la clé.
            it('names the operational site of every live jurisdiction', () => {
                for (const country of LIVE_COUNTRIES) {
                    const key = `coverage_site_${country.key}`;
                    expect(catalog.Landing?.[key], `${locale}.Landing.${key}`).toBeTruthy();
                }
            });

            it('defines every Jurisdiction page key', () => {
                for (const key of JURISDICTION_KEYS) {
                    expect(catalog.Jurisdiction?.[key], `${locale}.Jurisdiction.${key}`).toBeTruthy();
                }
            });

            // Chaque action proposée doit être libellée, sinon la page affiche
            // la clé brute en production.
            it('labels every action offered on a jurisdiction page', () => {
                const offered = new Set(
                    COVERAGE_COUNTRIES.flatMap((c) => actionsFor(c).map((a) => a.key)),
                );
                for (const action of offered) {
                    for (const suffix of ['title', 'desc']) {
                        const key = `action_${action}_${suffix}`;
                        expect(catalog.Jurisdiction?.[key], `${locale}.Jurisdiction.${key}`).toBeTruthy();
                    }
                }
            });
        });
    }
});
