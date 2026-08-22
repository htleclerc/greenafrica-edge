import * as React from 'react';

interface OsPageHeaderProps {
    /** Titre-verdict : ce que l'écran conclut, pas ce qu'il contient. */
    title: React.ReactNode;
    subtitle?: React.ReactNode;
    /** Actions de page — la primaire en dernier, elle se pose à droite. */
    actions?: React.ReactNode;
    className?: string;
}

/**
 * En-tête d'écran : verdict à gauche, actions de page à droite, alignés sur la
 * ligne de base basse. Le titre énonce l'état (« 7 armateurs en défaut de
 * paiement »), le sous-titre porte le contexte chiffré.
 */
export function OsPageHeader({ title, subtitle, actions, className = '' }: OsPageHeaderProps) {
    return (
        <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5 ${className}`}>
            <div className="flex flex-col gap-1 min-w-0">
                <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-[var(--os-text-primary)]">
                    {title}
                </h1>
                {subtitle && (
                    <p className="text-[13.5px] text-[var(--os-text-muted)]">{subtitle}</p>
                )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
        </div>
    );
}
