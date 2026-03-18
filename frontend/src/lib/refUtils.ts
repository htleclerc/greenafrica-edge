/**
 * Resolve an entity reference for display.
 * Prefers entityRef from detailsJson, falls back to entityId,
 * and masks long UUIDs to avoid exposing technical keys.
 */
export function entityDisplayRef(
    entityType: string,
    entityId: string,
    entityRef?: string,
): string {
    if (entityRef) return entityRef;
    // If it looks like a UUID (36 chars with dashes), mask it
    if (entityId.length > 20 && entityId.includes('-')) {
        return `${entityType} …${entityId.slice(-4)}`;
    }
    return entityId;
}
