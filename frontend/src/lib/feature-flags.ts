// server-only — uses the Supabase service-role key.
//
// Plan 7H-1 — Task 4 (+ W1-E). Typed reader for the 6 shipowner portal feature flags
// defined in master spec §12.2. Reads `app_config` in a single SELECT and
// returns a strongly-typed struct. Missing rows default to `false`
// (defensive: a deploy with no seed migration is still safe).
//
// Memoization: `readPortalFeatureFlags` is wrapped in React 19 `cache()`
// which memoizes the result for the duration of a single server-render
// request. Cross-request leak is impossible (cache is request-scoped).
//
// For the middleware (Edge runtime) where `cache()` does not apply, callers
// should layer a module-scoped TTL cache on top — see Plan 7H-1 Task 5 for
// the gate wiring.

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';

export interface PortalFeatureFlags {
    portalV1Enabled: boolean;
    selfServiceEnabled: boolean;
    onlinePaymentStripeEnabled: boolean;
    walletTopupEnabled: boolean;
    notificationSmsEnabled: boolean;
    airSelfServiceEnabled: boolean;
}

/**
 * Mapping from typed field names to `app_config.key` values. Kept private —
 * callers should use `readPortalFeatureFlags()` / `isFeatureEnabled()`.
 */
const FLAG_KEYS: Record<keyof PortalFeatureFlags, string> = {
    portalV1Enabled: 'feature.shipowner_portal_v1_enabled',
    selfServiceEnabled: 'feature.shipowner_self_service_enabled',
    onlinePaymentStripeEnabled: 'feature.online_payment_stripe_enabled',
    walletTopupEnabled: 'feature.wallet_topup_enabled',
    notificationSmsEnabled: 'feature.notification_sms_enabled',
    airSelfServiceEnabled: 'feature.air_self_service_enabled',
};

const ALL_KEYS = Object.values(FLAG_KEYS);

function defaultFlags(): PortalFeatureFlags {
    return {
        portalV1Enabled: false,
        selfServiceEnabled: false,
        onlinePaymentStripeEnabled: false,
        walletTopupEnabled: false,
        notificationSmsEnabled: false,
        airSelfServiceEnabled: false,
    };
}

/**
 * Internal implementation. Exported for unit tests so they can bypass the
 * per-request `cache()` wrapper.
 *
 * @internal
 */
export async function _readPortalFeatureFlagsImpl(): Promise<PortalFeatureFlags> {
    // `app_config` is a global control-plane table (not tenant-scoped), so the
    // UNSCOPED platform factory is correct. It throws when the service-role env
    // is missing — swallow that and fail-SECURE (everything off) rather than
    // open the gates on a misconfigured deploy.
    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return defaultFlags();
    }

    const { data, error } = await admin
        .from('app_config')
        .select('key, value')
        .in('key', ALL_KEYS);

    if (error || !data) {
        // Same defensive default — never fail-open on read errors.
        return defaultFlags();
    }

    const byKey = new Map<string, unknown>();
    for (const row of data as Array<{ key: string; value: unknown }>) {
        byKey.set(row.key, row.value);
    }

    const flags = defaultFlags();
    for (const field of Object.keys(FLAG_KEYS) as Array<keyof PortalFeatureFlags>) {
        const raw = byKey.get(FLAG_KEYS[field]);
        flags[field] = raw === true;
    }
    return flags;
}

/**
 * Read all 6 portal feature flags in a single SELECT.
 *
 * Memoized per-request via React 19 `cache()`. Safe to call from multiple
 * server components / server actions in the same request — the SELECT runs
 * at most once.
 *
 * Missing keys default to `false`.
 */
export const readPortalFeatureFlags = cache(_readPortalFeatureFlagsImpl);

/**
 * Convenience: read a single flag by typed key.
 */
export async function isFeatureEnabled(
    flag: keyof PortalFeatureFlags,
): Promise<boolean> {
    const flags = await readPortalFeatureFlags();
    return flags[flag];
}
