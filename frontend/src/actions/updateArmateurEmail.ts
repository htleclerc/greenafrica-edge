'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { upsertShipownerEmail } from '@/services/shipownerService';

const schema = z.object({
    shipownerId: z.string().uuid(),
    email: z.email(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'] as const;

export type UpdateArmateurEmailResult = { ok: true } | { ok: false; reason: string };

/**
 * Admin-side correction of an armateur's official email (staff-sourced,
 * trust tier PORT_OFFICER — see shipownerService.upsertShipownerEmail).
 * Staff isolation: a non-SUPERADMIN admin is confined to their own jurisdiction.
 */
export async function updateArmateurEmail(raw: unknown): Promise<UpdateArmateurEmailResult> {
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
        .eq('id', parsed.data.shipownerId)
        .single();
    if (ownerErr || !owner) return { ok: false, reason: 'shipowner not found' };

    const jurisdictionId = (owner as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, reason: 'forbidden: shipowner belongs to another jurisdiction' };
        }
    }

    const admin = createTenantClient(jurisdictionId);
    try {
        await upsertShipownerEmail(admin, parsed.data.shipownerId, parsed.data.email.trim().toLowerCase(), 'PORT_OFFICER');
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'update failed' };
    }

    revalidatePath('/admin/armateurs');
    return { ok: true };
}
