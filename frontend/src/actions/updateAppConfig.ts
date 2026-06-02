'use server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * Allowlist of app_config keys editable from the Carbon Tax Pipeline UI.
 * Keep in sync with `CarbonTaxPipelineSection` labels + seeds from
 * migrations 027 and 035.
 */
const ALLOWED_KEYS = new Set<string>([
    'carbon_tax.rate_usd_per_tco2',
    'arrival.corridor_radius_nm',
    'arrival.claim_sla_hours',
    'arrival.escalation_eta_buffer_h',
    'reconciliation.tolerance_pct',
    'reconciliation.check_interval_min',
    'owner_escalation.delay_days',
    'owner_escalation.reminder_count',
    'proforma.languages_default',
    'feature.ais_global_enabled',
    'feature.equasis_scraper_enabled',
    'feature.vessel_detention_enabled',
    'feature.shipowner_portal_enabled',
    // Plan 7H-1: shipowner portal v1 feature flags (master spec §12.2).
    // Rows do not need pre-seeding — missing keys default to false at read
    // time via lib/feature-flags.ts. Writing here UPSERTs the row.
    'feature.shipowner_portal_v1_enabled',
    'feature.shipowner_self_service_enabled',
    'feature.online_payment_stripe_enabled',
    'feature.wallet_topup_enabled',
    'feature.notification_sms_enabled',
    'feature.air_self_service_enabled',
    'queue.worker_url',
    'queue.worker_secret',
]);

const inputSchema = z.object({
    key: z
        .string()
        .refine((k) => ALLOWED_KEYS.has(k), { message: 'key not allowlisted' }),
    // app_config.value is JSONB — accept number, boolean, string, or string[].
    value: z.union([
        z.number(),
        z.boolean(),
        z.string(),
        z.array(z.string()),
    ]),
});

export async function updateAppConfig(
    raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            reason: parsed.error.issues[0]?.message ?? 'invalid input',
        };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (profile?.role !== 'SUPERADMIN') {
        return { ok: false, reason: 'only SUPERADMIN can edit tax settings' };
    }

    // `app_config` is a global control-plane table (not tenant-scoped). Mint the
    // service-role client via the sanctioned platform factory; it throws when the
    // service-role env is missing, which we surface as a graceful failure.
    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // app_config.value is JSONB; round-trip through JSON to drop any
    // non-serializable residue (Date, undefined, functions).
    const jsonValue = JSON.parse(JSON.stringify(parsed.data.value));

    // UPSERT (rather than UPDATE) so admins can persist a newly introduced
    // allowlisted key even if no seed migration has run. `key` is the PK on
    // `app_config` (mig 009). Read side defaults missing keys to false via
    // `lib/feature-flags.ts`, so this UPSERT also covers Plan 7H-1's new
    // portal feature flags without requiring a seed migration.
    const { error } = await admin
        .from('app_config')
        .upsert(
            {
                key: parsed.data.key,
                value: jsonValue,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'key' },
        );
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}
