'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { createPlatformClient } from '@/lib/supabase/tenant';

const ALLOWED_LANGS = ['en', 'fr', 'ar', 'pt', 'sw'] as const;
const ALLOWED_DOC_TYPES = ['TRADE_REGISTER', 'CERT_INCORPORATION', 'MOA', 'OTHER'] as const;

const registerShipownerSchema = z.object({
    email: z.string().email().max(254),
    name: z.string().min(2).max(200),
    imo_company_no: z.string().regex(/^\d{7}$/, '7 digits required'),
    country_code: z.string().length(2),
    address: z.string().min(5).max(500),
    proof_imo_vessel_imo: z.string().regex(/^\d{7}$/, '7 digits required'),
    proof_doc_storage_path: z.string().min(1),
    proof_doc_type: z.enum(ALLOWED_DOC_TYPES),
    phone_e164: z.string().regex(/^\+\d{8,15}$/).optional(),
    preferred_language: z.enum(ALLOWED_LANGS),
    recaptcha_token: z.string().min(1),
});

type RegisterShipownerInput = z.infer<typeof registerShipownerSchema>;

interface RegisterShipownerResult {
    ok: boolean;
    /** Generic message for ALL non-auto-claim paths (anti-enumeration). */
    message: string;
    /** Only set on successful AUTO-CLAIM. */
    autoClaimedId?: string;
}

const GENERIC_MESSAGE = 'Demande reçue. Vous recevrez un email sous 48h après validation.';

async function verifyRecaptcha(token: string): Promise<boolean> {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
        if (process.env.NODE_ENV !== 'production') return true;
        return false;
    }
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    if (!r.ok) return false;
    const data = await r.json() as { success: boolean; score?: number };
    return data.success === true && (data.score ?? 0) >= 0.5;
}

export async function registerShipowner(
    input: RegisterShipownerInput,
    clientIp: string,
): Promise<RegisterShipownerResult> {
    // Plan 7H-1 Task 5.1 — defense-in-depth flag check.
    // Even if the UI redirect is bypassed (direct POST), refuse to write.
    const flags = await readPortalFeatureFlags();
    if (!flags.selfServiceEnabled) {
        return { ok: false, message: 'Self-service signup is not currently enabled.' };
    }

    const rl = await enforceRateLimit('signup-shipowner', clientIp);
    if (!rl.allowed) return { ok: false, message: 'Too many attempts. Try again later.' };

    const parsed = registerShipownerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Invalid input.' };
    const data = parsed.data;

    const captchaOk = await verifyRecaptcha(data.recaptcha_token);
    if (!captchaOk) return { ok: false, message: GENERIC_MESSAGE };

    // Anonymous signup — no tenant context yet. Sanctioned unscoped client; new operator
    // rows inherit jurisdiction via the column DEFAULT (Somaliland) while signup is
    // single-country. Multi-country signup (subdomain -> jurisdiction) is a follow-up
    // tied to dropping that DEFAULT.
    const supabase = createPlatformClient();

    const { data: vessel } = await supabase
        .from('vessels')
        .select('id, shipowner_id')
        .eq('imo_number', data.proof_imo_vessel_imo)
        .maybeSingle();

    // Branch A: vessel found + shipowner attached
    if (vessel?.shipowner_id) {
        const { data: shipowner } = await supabase
            .from('shipowners')
            .select('id, account_state, imo_company_no')
            .eq('id', vessel.shipowner_id)
            .single();

        if (shipowner?.account_state === 'GHOST'
            && shipowner.imo_company_no === data.imo_company_no) {
            return await autoClaim(supabase, shipowner.id, data);
        }
        if (shipowner?.account_state === 'GHOST') {
            // GHOST mismatch — insert PENDING_REVIEW for admin to investigate
            await insertPendingReview(supabase, data);
            return { ok: true, message: GENERIC_MESSAGE };
        }
        // Non-GHOST (ACTIVE/INVITED/SUSPENDED/REJECTED) → no insert (anti-takeover)
        // No audit_log here (anonymous user, NOT NULL constraint on user_id).
        return { ok: true, message: GENERIC_MESSAGE };
    }

    // Branch B: vessel found but no shipowner
    // Branch C: vessel not found
    await insertPendingReview(supabase, data);
    return { ok: true, message: GENERIC_MESSAGE };
}

async function autoClaim(
    supabase: SupabaseClient,
    shipownerId: string,
    data: RegisterShipownerInput,
): Promise<RegisterShipownerResult> {
    const { data: claimed, error: upErr } = await supabase
        .from('shipowners')
        .update({
            name: data.name,
            address: data.address,
            country_code: data.country_code,
            phone_e164: data.phone_e164 ?? null,
            preferred_language: data.preferred_language,
            proof_imo_vessel_imo: data.proof_imo_vessel_imo,
            proof_doc_url: data.proof_doc_storage_path,
            proof_doc_type: data.proof_doc_type,
            imo_company_no_verified_at: new Date().toISOString(),
            kyc_level_b_completed_at: new Date().toISOString(),
            account_state: 'ACTIVE',
        })
        .eq('id', shipownerId)
        .eq('account_state', 'GHOST')                       // race-safe: only flip if still GHOST
        .select('id');
    if (upErr) return { ok: false, message: GENERIC_MESSAGE };

    // Lost the race — another concurrent caller already claimed.
    if (!claimed || claimed.length === 0) {
        return { ok: true, message: GENERIC_MESSAGE };
    }

    const inviteResp = await supabase.auth.admin.inviteUserByEmail(
        data.email,
        { redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/owner/auth/callback` },
    );
    if (inviteResp.error) {
        await supabase.from('shipowners')
            .update({ account_state: 'GHOST' })
            .eq('id', shipownerId)
            .eq('account_state', 'ACTIVE');                 // ADD guard: only rollback if still ACTIVE
        return { ok: false, message: 'Email delivery failed. Try again later.' };
    }

    // Use the user object from the invite response directly
    const newUser = inviteResp.data?.user;
    if (newUser) {
        await supabase.from('profiles').upsert({
            id: newUser.id,
            email: data.email,
            full_name: data.name,
            role: 'SHIPOWNER',
            is_active: true,
        });
        await supabase.from('shipowners')
            .update({ profile_id: newUser.id })
            .eq('id', shipownerId);
        await supabase.from('wallets').insert({ shipowner_id: shipownerId });

        // Audit log: now we have a user_id, write the audit row using the
        // project's existing pattern (action enum constrained to 10 values).
        // event detail goes in details_json.event.
        await supabase.from('audit_logs').insert({
            user_id: newUser.id,
            user_full_name: data.name,
            action: 'USER_CREATED',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: shipownerId,
            details_json: {
                event: 'SHIPOWNER_AUTO_CLAIM',
                imo_company_no: data.imo_company_no,
            },
        });
    }

    return { ok: true, message: GENERIC_MESSAGE, autoClaimedId: shipownerId };
}

async function insertPendingReview(
    supabase: SupabaseClient,
    data: RegisterShipownerInput,
): Promise<void> {
    await supabase.from('shipowners').insert({
        name: data.name,
        imo_company_no: data.imo_company_no,
        country_code: data.country_code,
        address: data.address,
        official_email: data.email,
        official_email_source: 'AGENT_CLAIM',
        phone_e164: data.phone_e164 ?? null,
        preferred_language: data.preferred_language,
        proof_imo_vessel_imo: data.proof_imo_vessel_imo,
        proof_doc_url: data.proof_doc_storage_path,
        proof_doc_type: data.proof_doc_type,
        kyc_level_b_completed_at: new Date().toISOString(),
        account_state: 'PENDING_REVIEW',
    });
    // No audit_log — anonymous user violates NOT NULL on user_id.
    // The shipowners row's created_at + account_state IS the audit trail.
}
