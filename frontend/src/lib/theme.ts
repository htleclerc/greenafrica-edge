/**
 * Habillage visuel. Vit ici plutôt que dans SkinContext pour que la résolution
 * du thème reste une fonction pure, testable sans React ni localStorage.
 */
export type SkinId = 'emerald' | 'navy';

export const VALID_SKINS: SkinId[] = ['emerald', 'navy'];

/**
 * Habillages retirés, encore présents dans le stockage des visiteurs.
 *
 * « Institutional » ne portait plus que le thème clair : ses couleurs avaient
 * rejoint celles d'Emerald, et il ne restait qu'une police et un filet de
 * carte. Deux entrées pour une même intention, dont l'une doublait le sélecteur
 * de thème — on garde le thème, on retire l'habillage.
 */
export const RETIRED_SKINS = ['institutional'] as const;

export function parseSkin(raw: string | null, fallback: SkinId = 'emerald'): SkinId {
    return VALID_SKINS.includes(raw as SkinId) ? (raw as SkinId) : fallback;
}

/** Les deux thèmes du produit : 1a (nuit) et 1b (clair) du handoff de refonte. */
export type ThemeMode = 'dark' | 'light';

/**
 * Ce que l'utilisateur a choisi, qui n'est pas la même chose que ce qui est affiché.
 *
 * `auto` = « décide pour moi ». Le thème retombe alors sur la valeur par défaut
 * de son rôle. Dès qu'il bascule explicitement, son choix tient et ne bouge plus.
 */
export type ThemePreference = ThemeMode | 'auto';

/** Clé du choix explicite. Distincte de `theme`, qui porte la valeur *résolue*. */
export const THEME_PREFERENCE_KEY = 'africgreen_theme_pref';
/** Clé lue par next-themes — toujours la valeur résolue, jamais `auto`. */
export const THEME_KEY = 'theme';
/** Clé de l'habillage. */
export const SKIN_KEY = 'africgreen_skin';

/** Thème réellement appliqué : le choix explicite s'il existe, sinon le défaut. */
export function resolveTheme(preference: ThemePreference, fallback: ThemeMode = 'dark'): ThemeMode {
    return preference === 'auto' ? fallback : preference;
}

/** Normalise une valeur venue de localStorage, qui peut être n'importe quoi. */
export function parseThemePreference(raw: string | null): ThemePreference {
    return raw === 'dark' || raw === 'light' ? raw : 'auto';
}

export function parseThemeMode(raw: string | null): ThemeMode | null {
    return raw === 'dark' || raw === 'light' ? raw : null;
}

/**
 * Rattrape un habillage retiré sans changer ce que la personne voyait.
 *
 * « Institutional » posait le thème clair par défaut. Le remplacer simplement
 * par emerald ferait basculer en sombre exactement les gens qui l'avaient
 * choisi pour sa clarté — on emporte donc le clair avec, mais **seulement**
 * s'ils n'avaient rien choisi eux-mêmes : un choix explicite prime toujours.
 */
export function migrateRetiredSkin(
    rawSkin: string | null,
    rawPreference: string | null,
): { skin: SkinId; preference: ThemePreference; changed: boolean } {
    const preference = parseThemePreference(rawPreference);
    const retired = (RETIRED_SKINS as readonly string[]).includes(rawSkin ?? '');
    if (!retired) return { skin: parseSkin(rawSkin), preference, changed: false };
    return {
        skin: 'emerald',
        preference: preference === 'auto' ? 'light' : preference,
        changed: true,
    };
}
