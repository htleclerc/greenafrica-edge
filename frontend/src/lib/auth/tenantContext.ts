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
 * Multi-jurisdiction staff: resolved via the ACTIVE_JURISDICTION_COOKIE set by the
 * jurisdiction switcher UI. Fail-closed (throws) when the cookie is absent or invalid —
 * staff must explicitly select an active jurisdiction before any tenant-scoped action.
 */
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/** Cookie name used by the jurisdiction switcher to persist the active jurisdiction. */
export const ACTIVE_JURISDICTION_COOKIE = 'gg-active-jid';

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

    // Staff path: the single active jurisdiction membership. Multi-jurisdiction staff
    // need an explicit active-jurisdiction selection (the switcher from the design
    // review) — until that exists, fail closed rather than guess.
    const { data: memberships } = await supabase
        .from('user_jurisdictions')
        .select('jurisdiction_id')
        .eq('user_id', user.id);
    const ids = (memberships ?? []).map((m) => m.jurisdiction_id as string);
    if (ids.length === 1) {
        return ids[0];
    }
    if (ids.length > 1) {
        const { cookies } = await import('next/headers');
        const cookieStore = await cookies();
        const active = cookieStore.get(ACTIVE_JURISDICTION_COOKIE)?.value;
        if (active && ids.includes(active)) {
            return active;
        }
        throw new Error(
            'getServerJurisdictionId: multi-jurisdiction user — select an active jurisdiction (switcher)'
        );
    }
    throw new Error(`getServerJurisdictionId: no jurisdiction resolved for user ${user.id}`);
}

/**
 * Resolve the current user's jurisdiction. Per-request memoised via React cache().
 * Throws if it cannot be resolved (fail-closed).
 */
export const getServerJurisdictionId = cache(_getServerJurisdictionIdImpl);
