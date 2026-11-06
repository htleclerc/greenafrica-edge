import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import fr from '../../../messages/fr.json';
import pt from '../../../messages/pt.json';
import so from '../../../messages/so.json';
import sw from '../../../messages/sw.json';
import { COVERAGE_COUNTRIES, LIVE_COUNTRIES, PIPELINE_COUNTRIES } from './coverage';

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
    'coverage_live_heading',
    'coverage_pipeline_heading',
    'coverage_disclaimer',
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
    it('declares at least one transport mode for every country', () => {
        for (const country of COVERAGE_COUNTRIES) {
            expect(country.modes.length, country.key).toBeGreaterThan(0);
            for (const mode of country.modes) {
                expect(['MARITIME', 'AIR'], `${country.key} → ${mode}`).toContain(mode);
            }
        }
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
        });
    }
});
