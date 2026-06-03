'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const schema = z.object({
    operatorId: z.string().uuid(),
    aocNumber: z.string().trim().min(2).max(64),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'MANAGER'] as const;

export type SetOperatorAocResult = { ok: true } | { ok: false; reason: string };

/**
 * Pre-seed (or update) the expected AOC number on an operator. Admin-only
 * (SUPERADMIN / MANAGER). Non-SUPERADMIN admins are confined to their own
 * jurisdiction. This is the value the air self-service auto-claim matches against.
 */
export async function setOperatorAocNumber(raw: unknown): Promise<SetOperatorAocResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const platform = createPlatformClient();
    const { data: owner, error: ownerErr } = await platform
        .from('shipowners')
        .select('id, jurisdiction_id')
        .eq('id', parsed.data.operatorId)
        .single();
    if (ownerErr || !owner) return { ok: false, reason: 'operator not found' };

    const jurisdictionId = (owner as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, reason: 'forbidden: operator belongs to another jurisdiction' };
        }
    }

    const admin = createTenantClient(jurisdictionId);
    const { error } = await admin
        .from('shipowners')
        .update({ aoc_number: parsed.data.aocNumber.toUpperCase() })
        .eq('id', parsed.data.operatorId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}
