'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, reason: 'service role not configured' };
    }
    const admin = createServiceRole(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    // app_config.value is JSONB; round-trip through JSON to drop any
    // non-serializable residue (Date, undefined, functions).
    const jsonValue = JSON.parse(JSON.stringify(parsed.data.value));

    const { error } = await admin
        .from('app_config')
        .update({
            value: jsonValue,
            updated_at: new Date().toISOString(),
        })
        .eq('key', parsed.data.key);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}
