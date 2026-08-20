import * as React from 'react';

export type OsSort = { key: string; dir: 'asc' | 'desc' };

export interface OsColumn<T> {
    key: string;
    header: string;
    render: (row: T) => React.ReactNode;
    className?: string;
    /** Rend l'en-tête cliquable. Sans `sortValue`, seul un tri contrôlé fonctionne. */
    sortable?: boolean;
    /** Clé de tri pour le tri client (`useClientSort`). */
    sortValue?: (row: T) => string | number | null;
}

interface OsTableProps<T> {
    columns: OsColumn<T>[];
    rows: T[];
    keyExtractor: (row: T) => string;
    onRowClick?: (row: T) => void;
    emptyMessage?: string;
    loading?: boolean;
    sort?: OsSort | null;
    onSortChange?: (next: OsSort) => void;
}

export function OsTable<T>({ columns, rows, keyExtractor, onRowClick, emptyMessage = 'No data', loading = false, sort = null, onSortChange }: OsTableProps<T>) {
    return (
        <div className="overflow-x-auto rounded-xl border border-[var(--os-border)]">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        {columns.map((col) => {
                            const active = sort?.key === col.key;
                            const interactive = col.sortable && !!onSortChange;
                            return (
                                <th
                                    key={col.key}
                                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                                    className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] ${col.className ?? ''}`}
                                >
                                    {interactive ? (
                                        <button
                                            type="button"
                                            onClick={() => onSortChange({
                                                key: col.key,
                                                dir: active && sort.dir === 'asc' ? 'desc' : 'asc',
                                            })}
                                            className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-[var(--os-text-primary)] transition-colors"
                                        >
                                            {col.header}
                                            <span aria-hidden className={active ? 'opacity-100' : 'opacity-30'}>
                                                {active && sort.dir === 'desc' ? '↓' : '↑'}
                                            </span>
                                        </button>
                                    ) : col.header}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {loading && (
                        <tr>
                            <td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--os-text-muted)]">
                                <div className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-[#00D97E]/30 border-t-[#00D97E] rounded-full animate-spin" />
                                    Loading…
                                </div>
                            </td>
                        </tr>
                    )}
                    {!loading && rows.length === 0 && (
                        <tr>
                            <td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--os-text-muted)] text-xs">
                                {emptyMessage}
                            </td>
                        </tr>
                    )}
                    {!loading && rows.map((row) => (
                        <tr
                            key={keyExtractor(row)}
                            onClick={() => onRowClick?.(row)}
                            className={`
                                border-b border-[var(--os-border)] last:border-0
                                transition-colors
                                ${onRowClick ? 'cursor-pointer hover:bg-[var(--os-surface-2)]' : ''}
                            `}
                        >
                            {columns.map((col) => (
                                <td key={col.key} className={`px-4 py-3 text-[var(--os-text-primary)] ${col.className ?? ''}`}>
                                    {col.render(row)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
