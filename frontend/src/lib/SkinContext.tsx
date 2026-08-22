'use client';

import * as React from 'react';
import { UserRole } from '@/types/secure';
import {
    parseSkin, parseThemePreference, resolveTheme, themeForSkin,
    THEME_KEY, THEME_PREFERENCE_KEY,
    type SkinId, type ThemeMode, type ThemePreference,
} from '@/lib/theme';

export type { SkinId } from '@/lib/theme';

interface SkinContextValue {
    skin: SkinId;
    setSkin: (skin: SkinId) => void;
    /** Thème réellement appliqué. */
    theme: ThemeMode;
    /** Ce que l'utilisateur a choisi — `auto` tant qu'il n'a rien choisi. */
    themePreference: ThemePreference;
    setThemePreference: (preference: ThemePreference) => void;
}

const SkinContext = React.createContext<SkinContextValue>({
    skin: 'emerald',
    setSkin: () => {},
    theme: 'dark',
    themePreference: 'auto',
    setThemePreference: () => {},
});

export function useSkin(): SkinContextValue {
    return React.useContext(SkinContext);
}

const STORAGE_KEY = 'africgreen_skin';

/** Returns the default skin for a given role */
export function defaultSkinForRole(role: UserRole): SkinId {
    if (role === UserRole.SUPERADMIN) return 'institutional';
    return 'emerald';
}

/**
 * SkinProvider — pilote l'habillage (`data-skin`) et le thème (`data-theme`).
 *
 * Les deux axes sont **indépendants** : le skin choisit la palette, le thème
 * choisit nuit ou jour. Tant que l'utilisateur n'a pas tranché
 * (`themePreference === 'auto'`), le thème suit le skin — c'est le comportement
 * historique. Dès qu'il bascule, son choix tient, y compris s'il change de skin
 * ensuite : un armateur qui préfère le clair le garde en emerald.
 *
 * `data-theme` n'a qu'un seul écrivain, ici. Le script anti-FOUC de `layout.tsx`
 * pose la même valeur avant la première peinture et la recopie sous la clé
 * `theme`, celle que lit `next-themes` — les deux ne peuvent donc pas diverger.
 */
export function SkinProvider({ children, defaultRole }: { children: React.ReactNode; defaultRole?: UserRole }) {
    const fallbackSkin = defaultRole ? defaultSkinForRole(defaultRole) : 'emerald';

    const [skin, setSkinState] = React.useState<SkinId>(() => {
        if (typeof window === 'undefined') return fallbackSkin;
        return parseSkin(localStorage.getItem(STORAGE_KEY), fallbackSkin);
    });
    const [themePreference, setThemePreferenceState] = React.useState<ThemePreference>(() => {
        if (typeof window === 'undefined') return 'auto';
        return parseThemePreference(localStorage.getItem(THEME_PREFERENCE_KEY));
    });

    const theme = resolveTheme(themePreference, skin);

    /** Applique les deux attributs et tient `theme` à jour pour next-themes. */
    const apply = React.useCallback((nextSkin: SkinId, nextTheme: ThemeMode) => {
        const root = document.documentElement;
        root.setAttribute('data-skin', nextSkin);
        root.setAttribute('data-theme', nextTheme);
        localStorage.setItem(THEME_KEY, nextTheme);
    }, []);

    const setSkin = React.useCallback((newSkin: SkinId) => {
        setSkinState(newSkin);
        localStorage.setItem(STORAGE_KEY, newSkin);
        // Le skin ne redéfinit le thème que si l'utilisateur ne l'a pas choisi.
        setThemePreferenceState((preference) => {
            apply(newSkin, resolveTheme(preference, newSkin));
            return preference;
        });
    }, [apply]);

    const setThemePreference = React.useCallback((preference: ThemePreference) => {
        setThemePreferenceState(preference);
        if (preference === 'auto') localStorage.removeItem(THEME_PREFERENCE_KEY);
        else localStorage.setItem(THEME_PREFERENCE_KEY, preference);
        setSkinState((currentSkin) => {
            apply(currentSkin, resolveTheme(preference, currentSkin));
            return currentSkin;
        });
    }, [apply]);

    // Au montage : réconcilier le DOM avec ce que porte le stockage. Le script
    // anti-FOUC a déjà posé la bonne valeur dans le cas courant ; cet effet
    // couvre le cas où `defaultRole` change la donne (première visite d'un
    // SUPERADMIN, qui n'a pas encore de skin enregistré).
    React.useEffect(() => {
        const resolvedSkin = parseSkin(localStorage.getItem(STORAGE_KEY), fallbackSkin);
        const preference = parseThemePreference(localStorage.getItem(THEME_PREFERENCE_KEY));
        setSkinState(resolvedSkin);
        setThemePreferenceState(preference);
        apply(resolvedSkin, resolveTheme(preference, resolvedSkin));
    }, [fallbackSkin, apply]);

    const value = React.useMemo(
        () => ({ skin, setSkin, theme, themePreference, setThemePreference }),
        [skin, setSkin, theme, themePreference, setThemePreference],
    );

    return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

export { themeForSkin };
