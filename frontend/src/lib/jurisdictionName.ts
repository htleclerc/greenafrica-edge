import type { SupabaseClient } from '@supabase/supabase-js';

// Legacy fallback used when jurisdiction_id is absent (pre-W2 rows) or the
// lookup fails.  Never reached for properly stamped transactions (W2+).
const LEGACY_FALLBACK = 'Republic of Somaliland';

// Module-level 60-second LRU-lite cache.  The jurisdictions table is tiny and
// hot-path (every PDF generation hits it), so one Supabase round-trip per id
// per minute is well within acceptable cost.
const cache = new Map<string, { name: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Resolves a jurisdiction display name by id.
 *
 * - Returns the stored `name` from the `jurisdictions` table.
 * - Results are cached for 60 s per id (module-level, resets on cold start).
 * - Returns LEGACY_FALLBACK when `jurisdictionId` is null / undefined, when the
 *   row is not found, or when the query fails — with a comment in-code below.
 */
export async function fetchJurisdictionName(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<string> {
    if (!jurisdictionId) {
        // legacy fallback: pre-W2 rows; never reached for properly stamped transactions
        return LEGACY_FALLBACK;
    }

    const now = Date.now();
    const cached = cache.get(jurisdictionId);
    if (cached && cached.expiresAt > now) {
        return cached.name;
    }

    const { data, error } = await client
        .from('jurisdictions')
        .select('name')
        .eq('id', jurisdictionId)
        .maybeSingle();

    if (error || !data?.name) {
        // legacy fallback: pre-W2 rows; never reached for properly stamped transactions
        return LEGACY_FALLBACK;
    }

    cache.set(jurisdictionId, { name: data.name, expiresAt: now + CACHE_TTL_MS });
    return data.name;
}

/** Exposed only for tests — wipes the in-process cache. */
export function _clearCacheForTest(): void {
    cache.clear();
}
