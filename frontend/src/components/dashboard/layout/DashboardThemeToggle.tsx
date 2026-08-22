'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSkin } from '@/lib/SkinContext';

/**
 * Bascule nuit / jour du dashboard.
 *
 * Distincte du sélecteur d'habillage voisin : le skin choisit la palette, ce
 * bouton choisit la luminosité. Les deux directions du handoff (1a nuit,
 * 1b clair) sont ainsi offertes à tous les rôles, pas déduites du skin.
 *
 * Le rendu est retardé jusqu'au montage : la valeur vient de `localStorage`, que
 * le serveur ne connaît pas. Un carré de la même taille tient la place pour que
 * la topbar ne saute pas.
 */
export function DashboardThemeToggle() {
    const t = useTranslations('Dashboard');
    const { theme, setThemePreference } = useSkin();
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => setMounted(true), []);
    if (!mounted) return <div className="size-8 shrink-0" aria-hidden />;

    const isDark = theme === 'dark';
    const label = isDark ? t('theme_switch_to_light') : t('theme_switch_to_dark');

    return (
        <button
            type="button"
            onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
            aria-label={label}
            title={label}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-muted)] transition-colors duration-150 hover:bg-[var(--os-surface-3)] hover:text-[var(--os-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
        >
            {isDark
                ? <Sun className="size-4" aria-hidden />
                : <Moon className="size-4" aria-hidden />}
        </button>
    );
}
