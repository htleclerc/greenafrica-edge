import * as React from 'react';
import type { OsColumn, OsSort } from '@/components/ui/OsTable';

/**
 * Comparateur de tri client. `null` est toujours relégué en fin, dans les deux
 * sens : une donnée absente n'est pas une valeur extrême, et la voir occuper la
 * tête d'un tri décroissant induirait le lecteur en erreur.
 */
export function compareValues(
    a: string | number | null,
    b: string | number | null,
    dir: 'asc' | 'desc',
): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const raw = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    return dir === 'asc' ? raw : -raw;
}

/**
 * Tri en mémoire pour les écrans qui chargent l'intégralité de leurs lignes.
 * Les écrans paginés côté serveur ne doivent PAS l'utiliser : ils ne trieraient
 * que la page affichée.
 */
export function useClientSort<T>(rows: T[], columns: OsColumn<T>[]): {
    sort: OsSort | null;
    onSortChange: (next: OsSort) => void;
    sortedRows: T[];
} {
    const [sort, setSort] = React.useState<OsSort | null>(null);
    // Typage explicite : `setSort` seul serait un Dispatch<SetStateAction<…>>,
    // assignable mais déroutant à la lecture des appelants.
    const onSortChange = React.useCallback((next: OsSort) => setSort(next), []);

    const sortedRows = React.useMemo(() => {
        if (!sort) return rows;
        const col = columns.find((c) => c.key === sort.key);
        if (!col?.sortValue) return rows;
        const get = col.sortValue;
        return [...rows].sort((x, y) => compareValues(get(x), get(y), sort.dir));
    }, [rows, columns, sort]);

    return { sort, onSortChange, sortedRows };
}
