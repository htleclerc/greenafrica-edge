'use client';

import * as React from 'react';

export interface OsFilterTab {
    value: string;
    label: string;
    /** Compte affiché après le libellé (« Toutes · 6 »). `undefined` = pas de compte. */
    count?: number;
}

interface OsFilterTabsProps {
    tabs: OsFilterTab[];
    value: string;
    onChange: (value: string) => void;
    /** Nom du groupe pour les lecteurs d'écran. */
    label: string;
    className?: string;
}

/**
 * Onglets de filtre : chaque onglet porte son compte, pour qu'on sache ce qu'on
 * va trouver avant de cliquer. Actif = pastille emerald pleine ; inactif =
 * surface secondaire.
 *
 * `role="tablist"` avec navigation aux flèches — les onglets pilotent un filtre,
 * pas une route, donc ce sont bien des onglets et pas des liens.
 */
export function OsFilterTabs({ tabs, value, onChange, label, className = '' }: OsFilterTabsProps) {
    const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

    function onKeyDown(e: React.KeyboardEvent, index: number) {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const next = (index + delta + tabs.length) % tabs.length;
        refs.current[next]?.focus();
        onChange(tabs[next].value);
    }

    return (
        <div role="tablist" aria-label={label} className={`flex flex-wrap gap-1.5 ${className}`}>
            {tabs.map((tab, i) => {
                const active = tab.value === value;
                return (
                    <button
                        key={tab.value}
                        ref={(el) => { refs.current[i] = el; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        // L'algorithme de nom accessible concatène les nœuds de
                        // texte en rognant leurs blancs de bord : « Ouvertes » et
                        // « · 3 » s'annonçaient « Ouvertes· 3 ». Un libellé
                        // explicite rétablit la lecture.
                        aria-label={tab.count !== undefined ? `${tab.label} · ${tab.count}` : tab.label}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(tab.value)}
                        onKeyDown={(e) => onKeyDown(e, i)}
                        className={`
                            shrink-0 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[12.5px]
                            transition-colors duration-150
                            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]
                            ${active
                                ? 'bg-[var(--os-brand-cyan)] font-semibold text-[var(--os-on-primary)]'
                                : 'bg-[var(--os-surface-2)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-3)]'}
                        `}
                    >
                        {tab.label}
                        {tab.count !== undefined && <span className="tabular-nums"> · {tab.count}</span>}
                    </button>
                );
            })}
        </div>
    );
}
