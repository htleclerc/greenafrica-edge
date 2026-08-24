import * as React from 'react';

export interface OsKpiCell {
    label: string;
    value: string;
    /** Note de contexte sous la valeur (« 21 factures », « cible 15 j »). */
    note?: string;
    /** Colore la valeur — `danger` pour un encours en souffrance. */
    tone?: 'default' | 'danger' | 'success';
    /** Colore la note plutôt que la valeur (variation « +9% vs juillet »). */
    noteTone?: 'default' | 'danger' | 'success';
}

const VALUE_TONE = {
    default: 'text-[var(--os-text-primary)]',
    danger:  'text-[var(--os-red)]',
    success: 'text-[var(--os-green)]',
} as const;

const NOTE_TONE = {
    default: 'text-[var(--os-text-secondary)]',
    danger:  'text-[var(--os-red)]',
    success: 'text-[var(--os-green)]',
} as const;

/**
 * Bandeau de contexte : **une** carte scindée par des filets internes, jamais N
 * cartes détachées. La distinction est intentionnelle — un bandeau se lit comme
 * une ligne de contexte, quatre cartes se liraient comme quatre appels à
 * l'action, et l'action de l'écran est ailleurs (la file de travail au-dessus).
 *
 * Les filets sont le fond du conteneur laissé visible par un `gap: 1px` : ils
 * restent justes quel que soit le nombre de colonnes après repli (1 sous 768 px,
 * 2 jusqu'à 1280 px, `cells.length` au-delà).
 */
export function OsKpiBand({ cells, className = '' }: { cells: OsKpiCell[]; className?: string }) {
    return (
        <div
            className={`os-kpi-band ${className}`}
            style={{ ['--os-kpi-cols' as string]: cells.length } as React.CSSProperties}
        >
            {cells.map((c) => (
                <div key={c.label} className="flex flex-col gap-1.5 bg-[var(--os-surface)] px-[18px] py-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
                        {c.label}
                    </span>
                    <span className={`font-mono text-[23px] font-semibold leading-none tabular-nums ${VALUE_TONE[c.tone ?? 'default']}`}>
                        {c.value}
                    </span>
                    {c.note && (
                        <span className={`text-xs ${NOTE_TONE[c.noteTone ?? 'default']}`}>{c.note}</span>
                    )}
                </div>
            ))}
        </div>
    );
}
