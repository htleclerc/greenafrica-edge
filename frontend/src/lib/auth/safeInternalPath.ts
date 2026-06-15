/**
 * Returns `path` if it is a safe internal path (starts with "/" but not "//"
 * nor "/\"), otherwise returns null.
 *
 * Use this to validate a ?redirectTo= query param before navigating to it,
 * guarding against open-redirect attacks.
 */
export function safeInternalPath(path: string | null | undefined): string | null {
    if (!path) return null;
    if (!path.startsWith('/')) return null;
    if (path.startsWith('//')) return null;
    if (path.startsWith('/\\')) return null;
    return path;
}
