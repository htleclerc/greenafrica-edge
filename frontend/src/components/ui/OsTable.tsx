import * as React from 'react';

export interface OsColumn<T> {
    key: string;
    header: string;
    render: (row: T) => React.ReactNode;
    className?: string;
}

interface OsTableProps<T> {
    columns: OsColumn<T>[];
    rows: T[];
    keyExtractor: (row: T) => string;
    onRowClick?: (row: T) => void;
    emptyMessage?: string;
    loading?: boolean;
}

export function OsTable<T>({ columns, rows, keyExtractor, onRowClick, emptyMessage = 'No data', loading = false }: OsTableProps<T>) {
    return (
        <div className="overflow-x-auto rounded-xl border border-[var(--os-border)]">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        {columns.map((col) => (
                            <th
                                key={col.key}
                                className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] ${col.className ?? ''}`}
                            >
                                {col.header}
                            </th>
                        ))}
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
