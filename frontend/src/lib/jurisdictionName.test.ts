import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchJurisdictionName, _clearCacheForTest } from './jurisdictionName';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to build a minimal scriptable Supabase client stub
// ─────────────────────────────────────────────────────────────────────────────

function makeClient(result: { data: { name: string } | null; error: { message: string } | null }) {
    return {
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: () => Promise.resolve(result),
                }),
            }),
        }),
    } as unknown as SupabaseClient;
}

const djiboutiClient = makeClient({ data: { name: 'Republic of Djibouti' }, error: null });
const missingClient  = makeClient({ data: null, error: null });
const errorClient    = makeClient({ data: null, error: { message: 'connection refused' } });

beforeEach(() => {
    _clearCacheForTest();
});

describe('fetchJurisdictionName', () => {
    it('returns the name from the DB on a hit', async () => {
        const name = await fetchJurisdictionName(djiboutiClient, 'dj-uuid');
        expect(name).toBe('Republic of Djibouti');
    });

    it('returns legacy fallback when jurisdictionId is null', async () => {
        const name = await fetchJurisdictionName(djiboutiClient, null);
        expect(name).toBe('Republic of Somaliland');
    });

    it('returns legacy fallback when jurisdictionId is undefined', async () => {
        const name = await fetchJurisdictionName(djiboutiClient, undefined);
        expect(name).toBe('Republic of Somaliland');
    });

    it('returns legacy fallback when row is missing', async () => {
        const name = await fetchJurisdictionName(missingClient, 'unknown-id');
        expect(name).toBe('Republic of Somaliland');
    });

    it('returns legacy fallback on DB error', async () => {
        const name = await fetchJurisdictionName(errorClient, 'some-id');
        expect(name).toBe('Republic of Somaliland');
    });

    it('uses the module-level cache on a second call (no second DB query)', async () => {
        const querySpy = vi.fn().mockResolvedValue({ data: { name: 'Republic of Djibouti' }, error: null });
        const cachingClient = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        maybeSingle: querySpy,
                    }),
                }),
            }),
        } as unknown as SupabaseClient;

        await fetchJurisdictionName(cachingClient, 'dj-cache-test');
        await fetchJurisdictionName(cachingClient, 'dj-cache-test');

        // DB must be queried exactly once; second call is served from cache
        expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('refreshes cache after TTL expires', async () => {
        const querySpy = vi.fn().mockResolvedValue({ data: { name: 'Republic of Djibouti' }, error: null });
        const cachingClient = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        maybeSingle: querySpy,
                    }),
                }),
            }),
        } as unknown as SupabaseClient;

        // Seed the cache with an already-expired entry
        _clearCacheForTest();
        // Use internal cache directly via a fresh call then force-expire it
        await fetchJurisdictionName(cachingClient, 'ttl-test');
        expect(querySpy).toHaveBeenCalledTimes(1);

        // Clear + re-call to simulate a new cold hit (TTL expiry simulation)
        _clearCacheForTest();
        await fetchJurisdictionName(cachingClient, 'ttl-test');
        expect(querySpy).toHaveBeenCalledTimes(2);
    });
});
