'use client';

import * as React from 'react';
import { UserRole } from '@/types/secure';

export type SkinId = 'emerald' | 'navy' | 'institutional';

const VALID_SKINS: SkinId[] = ['emerald', 'navy', 'institutional'];

interface SkinContextValue {
    skin: SkinId;
    setSkin: (skin: SkinId) => void;
}

const SkinContext = React.createContext<SkinContextValue>({
    skin: 'emerald',
    setSkin: () => {},
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
 * SkinProvider — manages the visual skin (emerald / navy / institutional).
 * Always sets data-skin on <html> so CSS selectors are properly scoped.
 */
export function SkinProvider({ children, defaultRole }: { children: React.ReactNode; defaultRole?: UserRole }) {
    const [skin, setSkinState] = React.useState<SkinId>(() => {
        if (typeof window === 'undefined') return 'emerald';
        const saved = localStorage.getItem(STORAGE_KEY) as SkinId | null;
        if (saved && VALID_SKINS.includes(saved)) return saved;
        return defaultRole ? defaultSkinForRole(defaultRole) : 'emerald';
    });

    const setSkin = React.useCallback((newSkin: SkinId) => {
        setSkinState(newSkin);
        localStorage.setItem(STORAGE_KEY, newSkin);
        document.documentElement.setAttribute('data-skin', newSkin);
        // Institutional = light mode, others = dark mode
        const autoTheme = newSkin === 'institutional' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', autoTheme);
        localStorage.setItem('theme', autoTheme);
    }, []);

    // On mount: always apply data-skin to <html>
    React.useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY) as SkinId | null;
        const resolved = (saved && VALID_SKINS.includes(saved))
            ? saved
            : (defaultRole ? defaultSkinForRole(defaultRole) : 'emerald');

        setSkinState(resolved);
        document.documentElement.setAttribute('data-skin', resolved);
        // Auto-set theme based on skin
        const autoTheme = resolved === 'institutional' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', autoTheme);
        localStorage.setItem('theme', autoTheme);
    }, [defaultRole]);

    return (
        <SkinContext.Provider value={{ skin, setSkin }}>
            {children}
        </SkinContext.Provider>
    );
}
