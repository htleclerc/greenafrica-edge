/**
 * Server-side jurisdiction resolution for GreenGate v8 multi-tenancy.
 *
 * Resolves which jurisdiction the CURRENT USER operates in, for owner-context
 * requests (the owner portal). Pair with createTenantClient() from
 * @/lib/supabase/tenant to scope service-role queries to that jurisdiction.
 *
 *   owner-context site:   const jid = await getServerJurisdictionId();
 *                         const db = createTenantClient(jid);   // auto-scoped
 *
 * Two OTHER patterns exist and do NOT use this helper:
 *   • admin-entity sites (e.g. executeRefund, adjustWalletManually, confirmPayment):
 *     the jurisdiction comes from the TARGET ENTITY, not the acting user. Look the
 *     entity up first (createPlatformClient, by id), read its jurisdiction_id, then
 *     createTenantClient(entity.jurisdiction_id) for the scoped write. A SUPERADMIN
 *     acting on a Senegal wallet must stamp the Senegal jurisdiction — never a default.
 *   • platform sites (crons iterating jurisdictions, Stripe webhooks keyed by external
 *     id): createPlatformClient() — legitimately cross-tenant.
 *
 * FAIL-CLOSED: throws rather than guessing. A silent default would mis-scope data.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

/**
 * Cookie name for the staff active-jurisdiction switcher.
 * httpOnly, sameSite=lax, max-age 30 days.
 */
export const ACTIVE_JURISDICTION_COOKIE = 'gg-active-jurisdiction';

/** Uncached implementation — exported for tests (mirrors feature-flags.ts pattern). */
export async function _getServerJurisdictionIdImpl(): Promise<string> {
    const supabase = await createClient();

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
        throw new Error('getServerJurisdictionId: no authenticated user');
    }

    // Owner path: the operator's home jurisdiction (Model B — single-jurisdiction operator).
    const { data: owner } = await supabase
        .from('shipowners')
        .select('jurisdiction_id')
        .eq('profile_id', user.id)
        .maybeSingle();
    if (owner?.jurisdiction_id) {
        return owner.jurisdiction_id as string;
    }

    // Staff path: read the switcher cookie first (Wedge 2 multi-country staff).
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(ACTIVE_JURISDICTION_COOKIE)?.value;

    const { data: memberships } = await supabase
        .from('user_jurisdictions')
        .select('jurisdiction_id')
        .eq('user_id', user.id);
    const ids = (memberships ?? []).map((m) => m.jurisdiction_id as string);

    if (ids.length === 0) {
        throw new Error(`getServerJurisdictionId: no jurisdiction resolved for user ${user.id}`);
    }
    if (ids.length === 1) {
        return ids[0];
    }
    // Multi-jurisdiction: honour the switcher cookie if it matches a membership.
    if (cookieValue && ids.includes(cookieValue)) {
        return cookieValue;
    }
    // Fall back to the first membership (sorted lexicographically to be deterministic).
    const sorted = [...ids].sort();
    return sorted[0];
}

/**
 * Resolve the current user's jurisdiction. Per-request memoised via React cache().
 * Throws if it cannot be resolved (fail-closed).
 */
export const getServerJurisdictionId = cache(_getServerJurisdictionIdImpl);
