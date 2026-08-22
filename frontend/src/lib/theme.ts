/**
 * Habillage visuel. Vit ici plutôt que dans SkinContext pour que la résolution
 * du thème reste une fonction pure, testable sans React ni localStorage.
 */
export type SkinId = 'emerald' | 'navy' | 'institutional';

export const VALID_SKINS: SkinId[] = ['emerald', 'navy', 'institutional'];

export function parseSkin(raw: string | null, fallback: SkinId = 'emerald'): SkinId {
    return VALID_SKINS.includes(raw as SkinId) ? (raw as SkinId) : fallback;
}

/** Les deux thèmes du produit : 1a (nuit) et 1b (clair) du handoff de refonte. */
export type ThemeMode = 'dark' | 'light';

/**
 * Ce que l'utilisateur a choisi, qui n'est pas la même chose que ce qui est affiché.
 *
 * `auto` = « décide pour moi », et le thème suit alors le skin. Dès que
 * l'utilisateur bascule explicitement, son choix devient indépendant du skin :
 * un armateur qui préfère le clair le garde en emerald, un agent qui préfère le
 * sombre le garde en institutional.
 */
export type ThemePreference = ThemeMode | 'auto';

/** Clé du choix explicite. Distincte de `theme`, qui porte la valeur *résolue*. */
export const THEME_PREFERENCE_KEY = 'africgreen_theme_pref';
/** Clé lue par next-themes — toujours la valeur résolue, jamais `auto`. */
export const THEME_KEY = 'theme';

/**
 * Thème par défaut d'un skin, quand l'utilisateur n'a rien choisi.
 *
 * `institutional` est le skin des écrans d'autorité, conçu clair ; les deux
 * autres sont sombres. C'est un défaut, pas une contrainte.
 */
export function themeForSkin(skin: SkinId): ThemeMode {
    return skin === 'institutional' ? 'light' : 'dark';
}

/** Thème réellement appliqué : le choix explicite s'il existe, sinon celui du skin. */
export function resolveTheme(preference: ThemePreference, skin: SkinId): ThemeMode {
    return preference === 'auto' ? themeForSkin(skin) : preference;
}

/** Normalise une valeur venue de localStorage, qui peut être n'importe quoi. */
export function parseThemePreference(raw: string | null): ThemePreference {
    return raw === 'dark' || raw === 'light' ? raw : 'auto';
}

export function parseThemeMode(raw: string | null): ThemeMode | null {
    return raw === 'dark' || raw === 'light' ? raw : null;
}
