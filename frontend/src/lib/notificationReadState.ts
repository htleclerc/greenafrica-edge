/**
 * État « lu » des notifications dérivées du staff.
 *
 * Les armateurs ont une vraie table (`owner_notifications.read_at`) : leur lu
 * est persisté côté serveur. Le staff, lui, n'a pas encore de table — ses
 * notifications sont recalculées depuis l'état courant (inscriptions en
 * attente, factures échues, navires non conformes) à chaque rafraîchissement.
 *
 * Sans mémoire, chaque recalcul les rendait toutes non lues : « tout marquer
 * comme lu » ne survivait pas soixante secondes. On garde donc localement les
 * identifiants déjà vus, et on les réapplique après chaque lecture.
 *
 * C'est un pansement assumé, pas une table : le lu reste attaché au navigateur.
 * Il tombera le jour où les notifications staff seront persistées côté serveur.
 */

export const READ_STATE_KEY = 'africgreen_notifications_read';

/**
 * Nombre d'identifiants conservés. Les notifications dérivées sont bornées
 * (quelques dizaines), mais leurs identifiants changent avec les données : sans
 * plafond la liste enflerait indéfiniment dans le stockage du navigateur.
 * Les plus récemment marqués sont gardés.
 */
export const MAX_REMEMBERED = 200;

/** Fusionne les identifiants déjà lus avec les nouveaux, les plus récents en tête. */
export function mergeReadIds(
    existing: readonly string[],
    incoming: readonly string[],
    max: number = MAX_REMEMBERED,
): string[] {
    // Les nouveaux d'abord : à la troncature, ce sont les plus vieux qui sautent.
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const id of [...incoming, ...existing]) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= max) break;
    }
    return merged;
}

/** Repose le drapeau `read` sur des éléments fraîchement recalculés. */
export function applyReadState<T extends { id: string; read: boolean }>(
    items: readonly T[],
    readIds: ReadonlySet<string>,
): T[] {
    return items.map((item) => (readIds.has(item.id) ? { ...item, read: true } : item));
}

/** Normalise ce que porte le stockage, qui peut être n'importe quoi. */
export function parseReadIds(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

// ── Accès au stockage ────────────────────────────────────────────────────────
// Enveloppes minces autour des fonctions pures ci-dessus. Toutes tolèrent un
// stockage indisponible (navigation privée, quota) : une notification relue
// n'est pas une erreur qui vaille d'interrompre l'écran.

export function loadReadIds(): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        return new Set(parseReadIds(localStorage.getItem(READ_STATE_KEY)));
    } catch {
        return new Set();
    }
}

export function persistReadIds(ids: readonly string[]): Set<string> {
    if (typeof window === 'undefined') return new Set(ids);
    try {
        const merged = mergeReadIds(parseReadIds(localStorage.getItem(READ_STATE_KEY)), ids);
        localStorage.setItem(READ_STATE_KEY, JSON.stringify(merged));
        return new Set(merged);
    } catch {
        return new Set(ids);
    }
}
