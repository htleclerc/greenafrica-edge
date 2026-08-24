'use client';

import * as React from 'react';
import { UserRole } from '@/types/secure';
import {
    parseThemePreference, resolveTheme, migrateRetiredSkin,
    SKIN_KEY, THEME_KEY, THEME_PREFERENCE_KEY,
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

/**
 * Thème par défaut d'un rôle, quand la personne n'a rien choisi.
 *
 * Le SUPERADMIN ouvrait sur l'habillage « Institutional », qui n'était qu'une
 * façon détournée de dire « en clair ». L'habillage a disparu, l'intention
 * reste : ses écrans s'ouvrent en clair.
 */
export function defaultThemeForRole(role: UserRole): ThemeMode {
    return role === UserRole.SUPERADMIN ? 'light' : 'dark';
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
    // Mémorisé : recalculé à chaque rendu, il ferait changer d'identité les
    // rappels qui en dépendent, et leur mémorisation n'aurait plus d'objet.
    const fallbackTheme = React.useMemo<ThemeMode>(
        () => (defaultRole ? defaultThemeForRole(defaultRole) : 'dark'),
        [defaultRole],
    );

    const [skin, setSkinState] = React.useState<SkinId>(() => {
        if (typeof window === 'undefined') return 'emerald';
        return migrateRetiredSkin(localStorage.getItem(SKIN_KEY), localStorage.getItem(THEME_PREFERENCE_KEY)).skin;
    });
    const [themePreference, setThemePreferenceState] = React.useState<ThemePreference>(() => {
        if (typeof window === 'undefined') return 'auto';
        return parseThemePreference(localStorage.getItem(THEME_PREFERENCE_KEY));
    });

    const theme = resolveTheme(themePreference, fallbackTheme);

    /** Applique les deux attributs et tient `theme` à jour pour next-themes. */
    const apply = React.useCallback((nextSkin: SkinId, nextTheme: ThemeMode) => {
        const root = document.documentElement;
        root.setAttribute('data-skin', nextSkin);
        root.setAttribute('data-theme', nextTheme);
        localStorage.setItem(THEME_KEY, nextTheme);
    }, []);

    const setSkin = React.useCallback((newSkin: SkinId) => {
        setSkinState(newSkin);
        localStorage.setItem(SKIN_KEY, newSkin);
        // Changer d'habillage ne touche plus au thème : les deux axes sont
        // indépendants, et c'est précisément ce que la fusion a clarifié.
        apply(newSkin, resolveTheme(themePreference, fallbackTheme));
    }, [apply, themePreference, fallbackTheme]);

    const setThemePreference = React.useCallback((preference: ThemePreference) => {
        setThemePreferenceState(preference);
        if (preference === 'auto') localStorage.removeItem(THEME_PREFERENCE_KEY);
        else localStorage.setItem(THEME_PREFERENCE_KEY, preference);
        apply(skin, resolveTheme(preference, fallbackTheme));
    }, [apply, skin, fallbackTheme]);

    // Au montage : réconcilier le DOM avec ce que porte le stockage. Le script
    // anti-FOUC a déjà posé la bonne valeur dans le cas courant ; cet effet
    // couvre le cas où `defaultRole` change la donne (première visite d'un
    // SUPERADMIN, qui n'a pas encore de skin enregistré).
    React.useEffect(() => {
        const migrated = migrateRetiredSkin(
            localStorage.getItem(SKIN_KEY),
            localStorage.getItem(THEME_PREFERENCE_KEY),
        );
        // Le stockage est réécrit une fois : sans cela la migration se rejouerait
        // à chaque visite et écraserait un choix de thème fait entre-temps.
        if (migrated.changed) {
            localStorage.setItem(SKIN_KEY, migrated.skin);
            localStorage.setItem(THEME_PREFERENCE_KEY, migrated.preference);
        }
        setSkinState(migrated.skin);
        setThemePreferenceState(migrated.preference);
        apply(migrated.skin, resolveTheme(migrated.preference, fallbackTheme));
    }, [fallbackTheme, apply]);

    const value = React.useMemo(
        () => ({ skin, setSkin, theme, themePreference, setThemePreference }),
        [skin, setSkin, theme, themePreference, setThemePreference],
    );

    return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>;
}

