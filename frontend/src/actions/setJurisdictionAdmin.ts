'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { isCountryStaffRole } from '@/lib/auth/jurisdictionAdmin';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('setJurisdictionAdmin');

const schema = z.object({
    userId: z.string().uuid(),
    jurisdictionId: z.string().uuid(),
    isAdmin: z.boolean(),
});

export type SetJurisdictionAdminResult =
    | { ok: true }
    | { ok: false; reason: 'invalid_input' | 'not_authenticated' | 'forbidden' | 'not_staff' | 'not_found' | 'failed' };

/**
 * Donne ou retire à un membre du personnel le droit d'administrer un pays.
 *
 * Réservé à l'administrateur général. Un administrateur de pays ne nomme pas
 * ses pairs : s'il le pouvait, un seul compte compromis en créerait d'autres.
 *
 * La personne doit déjà être rattachée au pays : on ne rattache pas et on ne
 * promeut pas dans le même geste.
 */
export async function setJurisdictionAdmin(raw: unknown): Promise<SetJurisdictionAdminResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_input' };
    const { userId, jurisdictionId, isAdmin } = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { data: me } = await supabase
        .from('profiles')
        .select('role, full_name, is_active')
        .eq('id', auth.user.id)
        .single();
    if (!me || me.is_active !== true || me.role !== 'SUPERADMIN') {
        return { ok: false, reason: 'forbidden' };
    }

    const platform = createPlatformClient();

    const { data: target, error: targetErr } = await platform
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
    if (targetErr) {
        log.error('profil illisible', { err: targetErr.message });
        return { ok: false, reason: 'failed' };
    }
    if (!isCountryStaffRole((target as { role: string } | null)?.role)) {
        return { ok: false, reason: 'not_staff' };
    }

    const { data: updated, error: updateErr } = await platform
        .from('user_jurisdictions')
        .update({ is_admin: isAdmin })
        .eq('user_id', userId)
        .eq('jurisdiction_id', jurisdictionId)
        .select('user_id');
    if (updateErr) {
        log.error('mise à jour impossible', { err: updateErr.message });
        return { ok: false, reason: 'failed' };
    }
    if ((updated ?? []).length === 0) return { ok: false, reason: 'not_found' };

    try {
        await platform.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: me.full_name,
            action: 'TRANSACTION_UPDATED', // audit_action est une énumération : valeur générique, l'événement réel est dans details_json.
            severity: 'WARNING',
            entity_type: 'Profile',
            entity_id: userId,
            jurisdiction_id: jurisdictionId,
            details_json: { event: isAdmin ? 'JURISDICTION_ADMIN_GRANTED' : 'JURISDICTION_ADMIN_REVOKED' },
        });
    } catch {
        // Le journal est tenu au mieux : il ne fait pas échouer le changement.
    }

    revalidatePath('/admin/staff');
    return { ok: true };
}
