'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';
import { createPlatformClient } from '@/lib/supabase/tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Wedge 2 — Task 10: createTariffVersion
//
// Appends a new ACTIVE tariff row and closes the previous open version.
// SUPERADMIN: may act on any jurisdiction.
// FINANCE_ADMIN: confined to their own jurisdiction (assertAdminCanActOn).
//
// Sequence:
//   1. Validate effectiveFrom is TODAY or FUTURE (past dates retro-reprice).
//   2. Close current ACTIVE NULL-effective_to row for (jurisdiction, mode, category).
//   3. INSERT the new ACTIVE row.
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    jurisdictionId: z.string().uuid(),
    mode: z.enum(['MARITIME', 'AIR']),
    ratePerTco2: z.number().positive(),
    assetCategory: z.string().min(1).optional(),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
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

    // Validate effectiveFrom is today or in the future.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    if (effectiveFrom < today) {
        return { ok: false, error: 'past_date' };
    }

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

    // 1. Close the current open version.
    //    ACTIVE-row immutability trigger ALLOWS setting effective_to on ACTIVE rows.
    //    asset_category comparison: IS NOT DISTINCT FROM handles NULL correctly.
    const categoryFilter = assetCategory ?? null;
    await platform
        .from('tariffs')
        .update({ effective_to: effectiveFrom })
        .eq('jurisdiction_id', jurisdictionId)
        .eq('mode', mode)
        .eq('status', 'ACTIVE')
        .is('effective_to', null)
        // PostgREST: filter NULL-safe using .is() for null, or .eq() for non-null
        .filter(
            'asset_category',
            categoryFilter === null ? 'is' : 'eq',
            categoryFilter === null ? null : categoryFilter,
        );

    // 2. INSERT the new ACTIVE version.
    const { error: insertError } = await platform.from('tariffs').insert({
        jurisdiction_id: jurisdictionId,
        mode,
        asset_category: assetCategory ?? null,
        zone: null,
        rate_per_tco2: ratePerTco2,
        currency: 'USD',
        effective_from: effectiveFrom,
        effective_to: null,
        status: 'ACTIVE',
        decree_ref: decreeRef,
        created_by: auth.user.id,
    });

    if (insertError) {
        // Exclusion constraint violation (overlapping active window).
        if (
            insertError.code === '23P01' ||
            insertError.message?.includes('tariffs_no_overlap')
        ) {
            return { ok: false, error: 'overlap' };
        }
        return { ok: false, error: insertError.message };
    }

    // Best-effort audit log.
    try {
        await platform.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: auth.user.fullName,
            action: 'TARIFF_CREATED',
            severity: 'INFO',
            entity_type: 'Tariff',
            entity_id: jurisdictionId,
            details_json: {
                event: 'TARIFF_VERSION_CREATED',
                mode,
                ratePerTco2,
                effectiveFrom,
            },
        });
    } catch {
        // best-effort
    }

    return { ok: true };
}
