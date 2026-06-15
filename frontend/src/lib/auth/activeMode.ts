import { cache } from 'react';
import { cookies } from 'next/headers';

/**
 * Cookie name for the mode filter (maritime / air / both).
 * httpOnly, sameSite=lax, max-age 1 year.
 * Written by the setActiveMode server action.
 */
export const ACTIVE_MODE_COOKIE = 'gg-active-mode';

export type ActiveMode = 'MARITIME' | 'AIR' | 'BOTH';

/**
 * Normalise a raw cookie value to a valid ActiveMode.
 * Any unrecognised or absent value defaults to BOTH (show everything).
 */
export function normalizeActiveMode(raw: string | null | undefined): ActiveMode {
    return raw === 'MARITIME' || raw === 'AIR' || raw === 'BOTH' ? raw : 'BOTH';
}

/** Uncached implementation — exported for tests. */
export async function _getServerActiveModeImpl(): Promise<ActiveMode> {
    const store = await cookies();
    return normalizeActiveMode(store.get(ACTIVE_MODE_COOKIE)?.value);
}

/**
 * Server read of the active mode filter. Per-request memoised via React cache().
 * BOTH (no filter) is the safe default — never fail-closed on a display preference.
 */
export const getServerActiveMode = cache(_getServerActiveModeImpl);

/**
 * Convert an ActiveMode to a SQL equality filter value, or null if no filter
 * should be applied (BOTH = show all transport modes).
 */
export function modeFilter(mode: ActiveMode): 'MARITIME' | 'AIR' | null {
    return mode === 'BOTH' ? null : mode;
}
