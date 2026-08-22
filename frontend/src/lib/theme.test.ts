import { describe, it, expect } from 'vitest';
import {
    themeForSkin, resolveTheme, parseThemePreference, parseThemeMode, parseSkin,
} from './theme';

describe('themeForSkin', () => {
    it('rend clair le skin institutional, sombre les autres', () => {
        expect(themeForSkin('institutional')).toBe('light');
        expect(themeForSkin('emerald')).toBe('dark');
        expect(themeForSkin('navy')).toBe('dark');
    });
});

describe('resolveTheme', () => {
    it('suit le skin tant que l’utilisateur n’a rien choisi', () => {
        expect(resolveTheme('auto', 'institutional')).toBe('light');
        expect(resolveTheme('auto', 'emerald')).toBe('dark');
    });

    // C'est tout l'objet du réglage : 1a et 1b sont deux thèmes offerts, pas la
    // conséquence d'un choix de skin.
    it('rend le choix explicite indépendant du skin', () => {
        expect(resolveTheme('dark', 'institutional')).toBe('dark');
        expect(resolveTheme('light', 'emerald')).toBe('light');
        expect(resolveTheme('light', 'navy')).toBe('light');
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
    it('accepte les trois skins connus', () => {
        expect(parseSkin('navy')).toBe('navy');
        expect(parseSkin('institutional')).toBe('institutional');
    });
    it('retombe sur le défaut sur une valeur inconnue', () => {
        expect(parseSkin('vaporwave')).toBe('emerald');
        expect(parseSkin(null)).toBe('emerald');
        expect(parseSkin(null, 'institutional')).toBe('institutional');
    });
});
