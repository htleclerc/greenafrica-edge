'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { createPlatformClient } from '@/lib/supabase/tenant';

const ALLOWED_LANGS = ['en', 'fr', 'ar', 'pt', 'sw', 'so'] as const;

const registerAirOperatorSchema = z.object({
    email: z.string().email().max(254),
    name: z.string().min(2).max(200),
    aoc_number: z.string().min(2).max(64),
    // registration (tail) or icao24 (Mode S hex). Alphanumerics + hyphen only —
    // also prevents PostgREST .or() filter injection.
    aircraft_ident: z.string().regex(/^[A-Za-z0-9-]{2,32}$/),
    country_code: z.string().length(2),
    address: z.string().min(5).max(500),
    proof_doc_storage_path: z.string().min(1),
    phone_e164: z.string().regex(/^\+\d{8,15}$/).optional(),
    preferred_language: z.enum(ALLOWED_LANGS),
    recaptcha_token: z.string().min(1),
});

type RegisterAirOperatorInput = z.infer<typeof registerAirOperatorSchema>;

interface RegisterAirOperatorResult {
    ok: boolean;
    /** Generic message for ALL non-auto-claim paths (anti-enumeration). */
    message: string;
    /** Only set on a successful AUTO-CLAIM. */
    autoClaimedId?: string;
}

const GENERIC_MESSAGE = 'Demande reçue. Vous recevrez un email sous 48h après validation.';

function normalizeAoc(v: string): string {
    return v.trim().toUpperCase();
}

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

export async function registerAirOperator(
    input: RegisterAirOperatorInput,
    clientIp: string,
): Promise<RegisterAirOperatorResult> {
    const flags = await readPortalFeatureFlags();
    if (!flags.airSelfServiceEnabled) {
        return { ok: false, message: 'Self-service signup is not currently enabled.' };
    }

    const rl = await enforceRateLimit('signup-air-operator', clientIp);
    if (!rl.allowed) return { ok: false, message: 'Too many attempts. Try again later.' };

    const parsed = registerAirOperatorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Invalid input.' };
    const data = parsed.data;

    const captchaOk = await verifyRecaptcha(data.recaptcha_token);
    if (!captchaOk) return { ok: false, message: GENERIC_MESSAGE };

    // Anonymous signup — no tenant context. Sanctioned unscoped client; new
    // operator rows inherit Somaliland via the column DEFAULT (single-country).
    const supabase = createPlatformClient();

    // Match the aircraft by registration (as entered) or icao24 (lowercased hex).
    const v = data.aircraft_ident.trim();
    const { data: aircraftRows } = await supabase
        .from('aircraft')
        .select('id, operator_id')
        .or(`registration.eq.${v},icao24.eq.${v.toLowerCase()}`)
        .limit(2);

    const aircraft = aircraftRows && aircraftRows.length === 1
        ? (aircraftRows[0] as { id: string; operator_id: string | null })
        : null;

    if (aircraft?.operator_id) {
        const { data: operator } = await supabase
            .from('shipowners')
            .select('id, account_state, aoc_number')
            .eq('id', aircraft.operator_id)
            .single();

        if (operator?.account_state === 'GHOST'
            && operator.aoc_number
            && normalizeAoc(operator.aoc_number) === normalizeAoc(data.aoc_number)) {
            return await autoClaimAir(supabase, operator.id, data);
        }
        if (operator?.account_state === 'GHOST') {
            // GHOST but AOC mismatch — admin must verify.
            await insertPendingReviewAir(supabase, data);
            return { ok: true, message: GENERIC_MESSAGE };
        }
        // Non-GHOST (ACTIVE/INVITED/...) → no write (anti-takeover).
        return { ok: true, message: GENERIC_MESSAGE };
    }

    // No (or ambiguous) aircraft match → cold signup, admin review.
    await insertPendingReviewAir(supabase, data);
    return { ok: true, message: GENERIC_MESSAGE };
}

async function autoClaimAir(
    supabase: SupabaseClient,
    operatorId: string,
    data: RegisterAirOperatorInput,
): Promise<RegisterAirOperatorResult> {
    // We deliberately do NOT set applicable_modes here: the claimed GHOST operator
    // was created by W1-C ADS-B detection already carrying ['AIR']. (Contrast with
    // insertPendingReviewAir, which sets ['AIR'] because it inserts a brand-new row
    // that would otherwise inherit the ['MARITIME'] column default from mig 071.)
    const { data: claimed, error: upErr } = await supabase
        .from('shipowners')
        .update({
            name: data.name,
            address: data.address,
            country_code: data.country_code,
            phone_e164: data.phone_e164 ?? null,
            preferred_language: data.preferred_language,
            // Persist the operator's email on the shipowners row: the proforma
            // reminder cron (mig 065) + notification-email-loop resolve the
            // recipient via shipowners.official_email — without this, an
            // auto-claimed operator never receives any proforma email.
            official_email: data.email,
            official_email_source: 'AGENT_CLAIM',
            proof_doc_url: data.proof_doc_storage_path,
            proof_doc_type: 'AOC',
            kyc_level_b_completed_at: new Date().toISOString(),
            account_state: 'ACTIVE',
        })
        .eq('id', operatorId)
        .eq('account_state', 'GHOST')           // race-safe: only flip if still GHOST
        .select('id');
    if (upErr) return { ok: false, message: GENERIC_MESSAGE };

    // Lost the race — another caller already claimed.
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
            .eq('id', operatorId)
            .eq('account_state', 'ACTIVE');
        return { ok: false, message: 'Email delivery failed. Try again later.' };
    }

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
            .eq('id', operatorId);
        await supabase.from('wallets').insert({ shipowner_id: operatorId });
        await supabase.from('audit_logs').insert({
            user_id: newUser.id,
            user_full_name: data.name,
            action: 'USER_CREATED',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: operatorId,
            details_json: { event: 'AIR_OPERATOR_AUTO_CLAIM', aoc_number: data.aoc_number },
        });
    }

    return { ok: true, message: GENERIC_MESSAGE, autoClaimedId: operatorId };
}

async function insertPendingReviewAir(
    supabase: SupabaseClient,
    data: RegisterAirOperatorInput,
): Promise<void> {
    await supabase.from('shipowners').insert({
        name: data.name,
        aoc_number: data.aoc_number,
        country_code: data.country_code,
        address: data.address,
        official_email: data.email,
        official_email_source: 'AGENT_CLAIM',
        phone_e164: data.phone_e164 ?? null,
        preferred_language: data.preferred_language,
        proof_doc_url: data.proof_doc_storage_path,
        proof_doc_type: 'AOC',
        kyc_level_b_completed_at: new Date().toISOString(),
        account_state: 'PENDING_REVIEW',
        applicable_modes: ['AIR'],
    });
    // No audit_log — anonymous user violates audit_logs.user_id NOT NULL (same as maritime).
}
