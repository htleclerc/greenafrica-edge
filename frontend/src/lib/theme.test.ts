import { describe, it, expect } from 'vitest';
import {
    migrateRetiredSkin, resolveTheme, parseThemePreference, parseThemeMode, parseSkin,
} from './theme';

describe('resolveTheme', () => {
    it('retombe sur le défaut fourni tant que rien n’a été choisi', () => {
        expect(resolveTheme('auto', 'light')).toBe('light');
        expect(resolveTheme('auto', 'dark')).toBe('dark');
        expect(resolveTheme('auto')).toBe('dark');
    });

    it('rend le choix explicite indépendant du défaut', () => {
        expect(resolveTheme('dark', 'light')).toBe('dark');
        expect(resolveTheme('light', 'dark')).toBe('light');
    });
});

describe('parseThemePreference', () => {
    it('accepte les deux thèmes', () => {
        expect(parseThemePreference('dark')).toBe('dark');
        expect(parseThemePreference('light')).toBe('light');
    });
    it('retombe sur auto sur une valeur absente ou aberrante', () => {
        expect(parseThemePreference(null)).toBe('auto');
        expect(parseThemePreference('')).toBe('auto');
        expect(parseThemePreference('sombre')).toBe('auto');
        // « auto » n'est pas un thème : c'est l'absence de choix.
        expect(parseThemePreference('auto')).toBe('auto');
    });
});

describe('parseThemeMode', () => {
    it('rend null plutôt qu’un thème inventé', () => {
        expect(parseThemeMode('dark')).toBe('dark');
        expect(parseThemeMode(null)).toBeNull();
        expect(parseThemeMode('auto')).toBeNull();
    });
});

describe('parseSkin', () => {
    it('accepte les habillages connus', () => {
        expect(parseSkin('emerald')).toBe('emerald');
        expect(parseSkin('navy')).toBe('navy');
    });
    it('retombe sur le défaut sur une valeur inconnue', () => {
        expect(parseSkin('vaporwave')).toBe('emerald');
        expect(parseSkin(null)).toBe('emerald');
        expect(parseSkin(null, 'navy')).toBe('navy');
    });
    it('ne reconnaît plus l’habillage retiré', () => {
        expect(parseSkin('institutional')).toBe('emerald');
    });
});

/**
 * « Institutional » posait le thème clair. Le remplacer par emerald sans emporter
 * le clair ferait basculer en sombre exactement les gens qui l'avaient choisi
 * pour sa clarté — c'est le seul point où ce retrait pouvait se voir.
 */
describe('migrateRetiredSkin', () => {
    it('emporte le clair avec l’habillage retiré', () => {
        expect(migrateRetiredSkin('institutional', null))
            .toEqual({ skin: 'emerald', preference: 'light', changed: true });
    });

    it('respecte un choix de thème déjà fait, même contraire', () => {
        expect(migrateRetiredSkin('institutional', 'dark'))
            .toEqual({ skin: 'emerald', preference: 'dark', changed: true });
    });

    it('ne touche pas un habillage encore valide', () => {
        expect(migrateRetiredSkin('navy', 'light'))
            .toEqual({ skin: 'navy', preference: 'light', changed: false });
        expect(migrateRetiredSkin(null, null))
            .toEqual({ skin: 'emerald', preference: 'auto', changed: false });
    });

    it('ne se dit « migré » qu’une fois — sinon elle se rejouerait à chaque visite', () => {
        const once = migrateRetiredSkin('institutional', null);
        expect(migrateRetiredSkin(once.skin, once.preference).changed).toBe(false);
    });
});
