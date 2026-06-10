'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ACTIVE_JURISDICTION_COOKIE } from '@/lib/auth/tenantContext';

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

    // Verify the caller is actually a member of the requested jurisdiction.
    // The session client can read the caller's own user_jurisdictions rows via RLS.
    const { data: membership } = await supabase
        .from('user_jurisdictions')
        .select('jurisdiction_id')
        .eq('user_id', user.id)
        .eq('jurisdiction_id', jurisdictionId)
        .maybeSingle();

    if (!membership) {
        return { ok: false, error: 'not a member of this jurisdiction' };
    }

    const { cookies } = await import('next/headers');
    (await cookies()).set(ACTIVE_JURISDICTION_COOKIE, jurisdictionId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
    });

    return { ok: true };
}
