'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_JURISDICTION_COOKIE } from '@/lib/auth/tenantContext';
import { listAccessibleJurisdictions } from '@/lib/auth/accessibleJurisdictions';

const schema = z.object({
    jurisdictionId: z.string().uuid(),
});

type SetActiveJurisdictionResult = { ok: true } | { ok: false; error: string };

/**
 * Set the active jurisdiction cookie for a multi-jurisdiction staff member.
 * Validates that the caller is actually a member of the requested jurisdiction
 * before writing the cookie (membership read via session client — RLS self-allow).
 */
export async function setActiveJurisdiction(raw: unknown): Promise<SetActiveJurisdictionResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, error: 'invalid input' };
    }
    const { jurisdictionId } = parsed.data;

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return { ok: false, error: 'not authenticated' };
    }

    // Le pays demandé doit faire partie de ceux auxquels l'appelant a accès :
    // tous pour l'administrateur général, ses rattachements pour les autres.
    let accessible: string[];
    try {
        accessible = (await listAccessibleJurisdictions(supabase, user.id)).jurisdictions.map((j) => j.id);
    } catch {
        return { ok: false, error: 'jurisdictions unavailable' };
    }
    if (!accessible.includes(jurisdictionId)) {
        return { ok: false, error: 'not a member of this jurisdiction' };
    }

    const { cookies } = await import('next/headers');
    (await cookies()).set(ACTIVE_JURISDICTION_COOKIE, jurisdictionId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        secure: process.env.NODE_ENV === 'production',
    });

    // Best-effort audit log — failure must NOT fail the switch.
    // RLS mig 004: all authenticated users may INSERT audit_logs.
    try {
        // Fetch the user's display name cheaply from their profile.
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', user.id)
            .maybeSingle();
        const userFullName = (profile as { full_name: string | null } | null)?.full_name ?? user.email ?? user.id;

        await supabase.from('audit_logs').insert({
            user_id: user.id,
            user_full_name: userFullName,
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Jurisdiction',
            entity_id: jurisdictionId,
            jurisdiction_id: jurisdictionId,
            details_json: { event: 'ACTIVE_JURISDICTION_SWITCHED' },
        });
    } catch (err) {
        // Fail-soft: audit log is informational; the switch still succeeds.
        console.error('[setActiveJurisdiction] audit_log insert failed:', err);
    }

    return { ok: true };
}
