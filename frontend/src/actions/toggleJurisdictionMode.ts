'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { createPlatformClient } from '@/lib/supabase/tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Wedge 2 — Task 10: toggleJurisdictionMode
//
// Enable or disable a transport mode (MARITIME / AIR) for a given jurisdiction.
// Contract-level change → SUPERADMIN only.
//
// When enabling: sets activated_at = NOW() if not already set.
// When disabling: preserves the existing activated_at (historical record).
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    jurisdictionId: z.string().uuid(),
    mode: z.enum(['MARITIME', 'AIR']),
    enabled: z.boolean(),
});

type ToggleJurisdictionModeResult =
    | { ok: true }
    | { ok: false; error: string };

export async function toggleJurisdictionMode(
    input: unknown,
): Promise<ToggleJurisdictionModeResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const { jurisdictionId, mode, enabled } = parsed.data;

    const auth = await requireRole([UserRole.SUPERADMIN]);
    if (auth.error) return { ok: false, error: 'insufficient role' };

    const platform = createPlatformClient();

    // Build the update payload: when enabling, stamp activated_at if it was NULL.
    // When disabling, leave activated_at as-is (preserve historical activation date).
    const updatePayload: Record<string, unknown> = { enabled };
    if (enabled) {
        // COALESCE logic: only set activated_at when enabling and not already set.
        // We read the current row first to avoid overwriting an existing timestamp.
        const { data: existing } = await platform
            .from('jurisdiction_mode_config')
            .select('activated_at')
            .eq('jurisdiction_id', jurisdictionId)
            .eq('mode', mode)
            .single();
        if (existing && !(existing as { activated_at: string | null }).activated_at) {
            updatePayload.activated_at = new Date().toISOString();
        }
    }

    const { data, error } = await platform
        .from('jurisdiction_mode_config')
        .update(updatePayload)
        .eq('jurisdiction_id', jurisdictionId)
        .eq('mode', mode)
        .select('jurisdiction_id')
        .single();

    if (error || !data) {
        // M6: return structured error keys; never leak raw DB messages.
        const code = error?.code ?? '';
        const msg = error?.message ?? '';
        if (code === 'PGRST116' || msg.includes('no rows') || !data) {
            return { ok: false, error: 'not_found' };
        }
        return { ok: false, error: 'unknown' };
    }

    // Best-effort audit log — never fail the action if this errors.
    try {
        await platform.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: auth.user.fullName,
            action: 'TRANSACTION_UPDATED', // audit_action is an enum (mig 003) — generic value + real event in details_json (house pattern).
            severity: 'INFO',
            entity_type: 'Jurisdiction',
            entity_id: jurisdictionId,
            jurisdiction_id: jurisdictionId,
            details_json: { event: 'MODE_TOGGLED', mode, enabled },
        });
    } catch {
        // best-effort
    }

    return { ok: true };
}
