import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resolve a "system actor" profile id to satisfy the
 * `payments_confirmed_audit` CHECK constraint (Plan 7A mig 048), which
 * requires `confirmed_by NOT NULL` whenever a payment row reaches status
 * 'CONFIRMED'.
 *
 * Some flows have no human actor — e.g. WALLET auto-apply (mig 059
 * trigger), the Stripe webhook handler (Task 6), and the Stripe reconcile
 * cron (Task 8). Mig 059 introduced the stopgap of picking the oldest
 * active SUPERADMIN/FINANCE_ADMIN profile. This helper mirrors that
 * stopgap in TS so server actions / route handlers / crons share one
 * implementation.
 *
 * TECH_DEBT (same as mig 059): long-term, prefer one of:
 *  - Relax `payments_confirmed_audit` for system-initiated rails (WALLET,
 *    STRIPE webhook).
 *  - Add a sentinel SYSTEM profile + use its id everywhere.
 *  - Add `system_actor_kind` enum column to `payments`.
 *
 * @returns profile id (uuid string) or null if no active SUPERADMIN /
 *   FINANCE_ADMIN exists. Caller should treat null as a hard error.
 */
export async function resolveSystemActor(
    admin: SupabaseClient,
): Promise<string | null> {
    const { data } = await admin
        .from('profiles')
        .select('id')
        .eq('is_active', true)
        .in('role', ['SUPERADMIN', 'FINANCE_ADMIN'])
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    return (data?.id as string | undefined) ?? null;
}
