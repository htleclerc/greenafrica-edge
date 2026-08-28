import * as React from 'react';
import Link from 'next/link';

export interface OsCrumb {
    label: string;
    /** Absent sur le dernier maillon : la page courante ne se lie pas à elle-même. */
    href?: string;
}

/**
 * Fil d'Ariane des écrans d'administration.
 *
 * Rendu dans un `<nav>` porteur d'un `aria-label`, avec `aria-current="page"`
 * sur le maillon final : un lecteur d'écran annonce alors la position dans
 * l'arborescence au lieu d'énumérer une suite de liens sans statut.
 *
 * Les séparateurs sont `aria-hidden` — ils sont décoratifs, et les faire lire
 * transformerait « Armateurs / ACME » en « Armateurs barre oblique ACME ».
 */
export function OsBreadcrumb({ items, className = '' }: { items: OsCrumb[]; className?: string }) {
    if (items.length === 0) return null;
    return (
        <nav aria-label="breadcrumb" className={className}>
            <ol className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--os-text-muted)]">
                {items.map((item, i) => {
                    const last = i === items.length - 1;
                    return (
                        <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
                            {item.href && !last ? (
                                <Link
                                    href={item.href}
                                    className="hover:text-[var(--os-text-primary)] transition-colors underline-offset-2 hover:underline"
                                >
                                    {item.label}
                                </Link>
                            ) : (
                                <span
                                    aria-current={last ? 'page' : undefined}
                                    className={last ? 'text-[var(--os-text-secondary)]' : undefined}
                                >
                                    {item.label}
                                </span>
                            )}
                            {!last && <span aria-hidden className="text-[var(--os-border-strong)]">/</span>}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
