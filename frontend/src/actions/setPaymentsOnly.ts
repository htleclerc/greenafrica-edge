'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('setPaymentsOnly');

const schema = z.object({
    profileId: z.string().uuid(),
    enabled: z.boolean(),
});

/**
 * Pose ou retire « encaissements seulement » (mig 154) sur un profil staff.
 *
 * SUPERADMIN seul, comme les droits de règlement : c'est une décision sur ce
 * qu'une personne a le droit de voir. Le retrait comme la pose sont tracés —
 * lever la restriction rouvre les créances à quelqu'un qui ne devait pas les
 * voir, c'est un événement au même titre que la pose.
 */
export async function setPaymentsOnly(input: { profileId: string; enabled: boolean }) {
    const parsed = schema.parse(input);
    const auth = await requireRole([UserRole.SUPERADMIN]);
    if (auth.error) throw new Error('Not authorized');

    const admin = createPlatformClient();
    const { data: target, error: readErr } = await admin
        .from('profiles')
        .select('id, role, full_name, is_active')
        .eq('id', parsed.profileId)
        .maybeSingle();
    if (readErr) throw readErr;
    if (!target) throw new Error('Profile not found');
    if (target.role === 'SHIPPING_AGENT') throw new Error('Payments-only is staff-only');
    if (target.id === auth.user.id) throw new Error('Cannot restrict your own account');

    const { error: updErr } = await admin
        .from('profiles')
        .update({ payments_only: parsed.enabled })
        .eq('id', parsed.profileId);
    if (updErr) throw updErr;

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'SETTLEMENT_RIGHTS_UPDATED',
        severity: 'WARNING',
        entity_type: 'Profile',
        entity_id: parsed.profileId,
        details_json: {
            event: parsed.enabled ? 'PAYMENTS_ONLY_ENABLED' : 'PAYMENTS_ONLY_DISABLED',
            target_role: target.role,
            target_name: target.full_name,
        },
    });
    log.info('payments_only_updated', {
        profileId: parsed.profileId, enabled: parsed.enabled, targetRole: target.role, byUserId: auth.user.id,
    });

    revalidatePath('/admin/staff');
    return { ok: true as const };
}
