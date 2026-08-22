'use client';

import * as React from 'react';
import { accentStyle, type OsAccent } from '@/lib/osAccent';

export interface OsGridColumn<T> {
    key: string;
    header: string;
    render: (row: T) => React.ReactNode;
    /** Piste CSS grid de la colonne : `1.5fr`, `0.9fr`, `180px`. */
    width: string;
    align?: 'start' | 'end';
    /**
     * Colonne secondaire : masquée sous 1280 px. Réservée à ce qui informe sans
     * décider (position, type) — jamais au montant ni à l'action.
     */
    secondary?: boolean;
    /** Colonne d'identité : en mode carte elle occupe la ligne, sans libellé. */
    primary?: boolean;
}

export interface OsGridTableProps<T> {
    columns: OsGridColumn<T>[];
    rows: T[];
    keyExtractor: (row: T) => string;
    /** Accent du liseré gauche — l'ancienneté de la dette au balayage vertical. */
    rowAccent?: (row: T) => OsAccent | null;
    onRowClick?: (row: T) => void;
    /** Libellé de la ligne, pour l'accessibilité du clic sur la ligne entière. */
    rowLabel?: (row: T) => string;
    loading?: boolean;
    /** Message d'erreur ; s'il est posé il prime sur `rows` et propose de réessayer. */
    error?: string | null;
    onRetry?: () => void;
    retryLabel?: string;
    /** État vide — pour l'armateur c'est une bonne nouvelle, pas une absence. */
    emptyMessage: string;
    /** Nombre de squelettes en chargement, aux dimensions des lignes réelles. */
    skeletonRows?: number;
    className?: string;
}

function tracks<T>(columns: OsGridColumn<T>[], all: boolean): string {
    return columns.filter((c) => all || !c.secondary).map((c) => c.width).join(' ');
}

/**
 * Tableau dense en grille — les colonnes s'alignent au pixel entre l'en-tête et
 * les lignes, ce qu'un `<table>` ne garantit pas quand une cellule porte deux
 * niveaux de texte (nom du navire au-dessus de son IMO).
 *
 * Trois paliers : toutes les colonnes au-delà de 1280 px, les colonnes
 * secondaires tombent en dessous, et sous 768 px chaque ligne devient une carte
 * libellé/valeur.
 *
 * Le clic sur la ligne ouvre le détail ; les boutons portés par une cellule
 * arrêtent la propagation et déclenchent leur action sans passer par le détail.
 */
export function OsGridTable<T>({
    columns, rows, keyExtractor, rowAccent, onRowClick, rowLabel,
    loading = false, error = null, onRetry, retryLabel = 'Réessayer',
    emptyMessage, skeletonRows = 5, className = '',
}: OsGridTableProps<T>) {
    const gridVars = {
        ['--os-grid-cols-lg' as string]: tracks(columns, true),
        ['--os-grid-cols-md' as string]: tracks(columns, false),
    } as React.CSSProperties;

    return (
        <div className={`os-card overflow-hidden ${className}`}>
            <div
                style={gridVars}
                className="os-grid-row os-grid-head gap-3 border-b border-[var(--os-border)] bg-[var(--os-surface-sunken)] px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--os-text-muted)]"
            >
                {columns.map((col) => (
                    <span
                        key={col.key}
                        className={`${col.secondary ? 'os-col-secondary' : ''} ${col.align === 'end' ? 'text-right' : ''}`}
                    >
                        {col.header}
                    </span>
                ))}
            </div>

            {error ? (
                <div className="flex flex-col items-start gap-2.5 px-[18px] py-8">
                    <p className="text-[13px] text-[var(--os-red)]">{error}</p>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="h-10 rounded-lg border border-[var(--os-border-strong)] px-3.5 text-[13px] text-[var(--os-text-secondary)] transition-colors duration-150 hover:bg-[var(--os-surface-2)]"
                        >
                            {retryLabel}
                        </button>
                    )}
                </div>
            ) : loading ? (
                Array.from({ length: skeletonRows }, (_, i) => (
                    <div
                        key={i}
                        aria-hidden
                        style={gridVars}
                        className="os-grid-row gap-3 border-b border-[var(--os-border-row)] px-[18px] py-[13px] last:border-b-0"
                    >
                        {columns.map((col) => (
                            <span key={col.key} className={col.secondary ? 'os-col-secondary' : ''}>
                                <span className="block h-3.5 animate-pulse rounded bg-[var(--os-surface-2)]" />
                            </span>
                        ))}
                    </div>
                ))
            ) : rows.length === 0 ? (
                <p className="px-[18px] py-10 text-center text-[13px] text-[var(--os-text-muted)]">
                    {emptyMessage}
                </p>
            ) : (
                rows.map((row) => {
                    const accent = rowAccent?.(row) ?? null;
                    const clickable = !!onRowClick;
                    return (
                        <div
                            key={keyExtractor(row)}
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            aria-label={clickable ? rowLabel?.(row) : undefined}
                            onClick={clickable ? () => onRowClick(row) : undefined}
                            onKeyDown={clickable ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onRowClick(row);
                                }
                            } : undefined}
                            style={accent ? accentStyle(accent, gridVars) : gridVars}
                            className={[
                                'os-grid-row items-center gap-3 border-b border-[var(--os-border-row)] px-[18px] py-[13px] last:border-b-0',
                                accent ? 'os-accent-border-l' : '',
                                clickable
                                    ? 'cursor-pointer text-left transition-colors duration-150 hover:bg-[var(--os-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--os-brand-green)]'
                                    : '',
                            ].join(' ')}
                        >
                            {columns.map((col) => (
                                <span
                                    key={col.key}
                                    data-label={col.primary ? undefined : col.header}
                                    className={[
                                        'min-w-0',
                                        col.secondary ? 'os-col-secondary' : '',
                                        col.primary ? 'os-col-primary' : '',
                                        col.align === 'end' ? 'justify-self-end text-right' : 'justify-self-start',
                                    ].join(' ')}
                                >
                                    {col.render(row)}
                                </span>
                            ))}
                        </div>
                    );
                })
            )}
        </div>
    );
}
