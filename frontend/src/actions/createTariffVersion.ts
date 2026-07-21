'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';
import { createPlatformClient } from '@/lib/supabase/tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Wedge 2 — createTariffVersion
//
// Closes the current open version and inserts its successor ATOMICALLY via the
// create_tariff_version RPC (mig 084). Two separate PostgREST calls leave a
// real corruption surface; the SECURITY DEFINER RPC serialises concurrent
// versioning per logical key with SELECT … FOR UPDATE.
//
// Auth-first convention (M7): requireRole / assertAdminCanActOn are called
// BEFORE any DB work beyond Zod parse.
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    jurisdictionId: z.string().uuid(),
    mode: z.enum(['MARITIME', 'AIR']),
    ratePerTco2: z.number().positive(),
    assetCategory: z.string().min(1).optional(),
    effectiveFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
        .refine((v) => {
            // Kills impossible dates like 2026-02-31
            const d = new Date(v + 'T00:00:00Z');
            return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
        }, 'invalid calendar date'),
    decreeRef: z.string().min(1),
});

type CreateTariffVersionResult =
    | { ok: true }
    | { ok: false; error: 'overlap' | 'past_date' | 'forbidden' | string };

export async function createTariffVersion(
    input: unknown,
): Promise<CreateTariffVersionResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const { jurisdictionId, mode, ratePerTco2, assetCategory, effectiveFrom, decreeRef } =
        parsed.data;

    // Auth-first: role check before any DB work.
    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) return { ok: false, error: 'forbidden' };

    // Non-SUPERADMIN: must be member of the target jurisdiction.
    if (auth.user.role !== UserRole.SUPERADMIN) {
        try {
            await assertAdminCanActOn(auth.user, jurisdictionId);
        } catch {
            return { ok: false, error: 'forbidden' };
        }
    }

    const platform = createPlatformClient();

    // Single atomic RPC call — close + insert in one transaction.
    const { data, error: rpcError } = await platform.rpc('create_tariff_version', {
        p_jurisdiction_id: jurisdictionId,
        p_mode: mode,
        p_asset_category: assetCategory ?? null,
        p_rate: ratePerTco2,
        p_effective_from: effectiveFrom,
        p_decree_ref: decreeRef,
        p_actor: auth.user.id,
    });

    if (rpcError) {
        const msg = rpcError.message ?? '';
        const code = rpcError.code ?? '';
        // SECURITY DEFINER role check failed
        // audit_action is an enum (mig 003) — generic value + real event in details_json (house pattern).
        if (code === '42501' || msg.includes('forbidden')) {
            return { ok: false, error: 'forbidden' };
        }
        // Overlapping active window
        if (
            code === '23P01' ||
            code === 'exclusion_violation' ||
            msg.includes('already exists at/after') ||
            msg.includes('tariffs_no_overlap')
        ) {
            return { ok: false, error: 'overlap' };
        }
        // Same-day or past date
        if (msg.includes('strictly future') || code === '23514') {
            return { ok: false, error: 'past_date' };
        }
        return { ok: false, error: msg };
    }

    // Best-effort audit log — includes both IDs from RPC result.
    const row = Array.isArray(data) ? data[0] : data;
    try {
        await platform.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: auth.user.fullName,
            action: 'TAX_RATE_UPDATED', // audit_action is an enum (mig 003) — generic value + real event in details_json (house pattern).
            severity: 'INFO',
            entity_type: 'Tariff',
            entity_id: jurisdictionId,
            jurisdiction_id: jurisdictionId,
            details_json: {
                event: 'TARIFF_VERSION_CREATED',
                new_id: row?.new_id ?? null,
                closed_id: row?.closed_id ?? null,
                mode,
                rate: ratePerTco2,
                effective_from: effectiveFrom,
            },
        });
    } catch {
        // best-effort
    }

    return { ok: true };
}
