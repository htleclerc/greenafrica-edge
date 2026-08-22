import * as React from 'react';
import { accentStyle, type OsAccent } from '@/lib/osAccent';

/**
 * Pastille de délai — porte le temps restant ou écoulé, pas le statut.
 * « En retard · 4 j » et « Dans 9 j » disent quand agir ; le statut du dossier
 * se lit ailleurs, sur le badge de statut.
 */
export function OsUrgencyPill({
    accent,
    children,
    className = '',
}: {
    accent: OsAccent;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span
            style={accentStyle(accent)}
            className={`
                os-accent-tint os-accent-text
                inline-block shrink-0 whitespace-nowrap rounded-md px-2.5 py-1
                text-[11px] font-semibold uppercase tracking-[0.06em]
                ${className}
            `}
        >
            {children}
        </span>
    );
}
