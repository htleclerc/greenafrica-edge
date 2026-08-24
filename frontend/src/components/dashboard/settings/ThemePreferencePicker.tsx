'use client';

import * as React from 'react';
import { Moon, Sun, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSkin } from '@/lib/SkinContext';
import { themeForSkin, type ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; Icon: typeof Sun }[] = [
    { value: 'auto', Icon: Wand2 },
    { value: 'dark', Icon: Moon },
    { value: 'light', Icon: Sun },
];

/**
 * Choix du thème, dans les paramètres.
 *
 * Trois états et non deux : « Automatique » rend la main à l'habillage, ce qui
 * est le comportement historique et reste le défaut. Le bouton de la topbar ne
 * propose que la bascule ; c'est ici qu'on peut revenir à l'automatique.
 */
export function ThemePreferencePicker() {
    const t = useTranslations('DashboardPages');
    const { skin, themePreference, setThemePreference } = useSkin();
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => setMounted(true), []);

    return (
        <div className="flex flex-col gap-2">
            <div role="radiogroup" aria-label={t('settings_theme_mode')} className="flex flex-wrap gap-2">
                {OPTIONS.map(({ value, Icon }) => {
                    // Avant montage, rien n'est coché : la préférence vient de
                    // localStorage, que le rendu serveur ne connaît pas.
                    const active = mounted && themePreference === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setThemePreference(value)}
                            className={`
                                flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold
                                transition-colors duration-150
                                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                                ${active
                                    ? 'border-[var(--os-brand-green)]/45 bg-[var(--os-brand-green)]/10 text-[var(--os-brand-cyan)]'
                                    : 'border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-3)]'}
                            `}
                        >
                            <Icon className="size-4" aria-hidden />
                            {t(`settings_theme_${value}`)}
                        </button>
                    );
                })}
            </div>
            {mounted && themePreference === 'auto' && (
                <p className="text-xs text-[var(--os-text-muted)]">
                    {t('settings_theme_auto_hint', { theme: t(`settings_theme_${themeForSkin(skin)}`) })}
                </p>
            )}
        </div>
    );
}
