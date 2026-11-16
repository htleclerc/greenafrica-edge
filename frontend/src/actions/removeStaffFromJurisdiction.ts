'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { canAdminister, getAdminScope } from '@/lib/auth/jurisdictionAdmin';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('removeStaffFromJurisdiction');

const schema = z.object({
    userId: z.string().uuid(),
    jurisdictionId: z.string().uuid(),
});

export type RemoveStaffResult =
    | { ok: true }
    | { ok: false; reason: 'invalid_input' | 'not_authenticated' | 'forbidden' | 'self' | 'not_found' | 'failed' };

/**
 * Retire un membre du personnel d'un pays.
 *
 * Ouvert à l'administrateur général et à l'administrateur de CE pays. Garde-fous :
 *   • on ne se retire pas soi-même — un pays ne doit pas se retrouver sans
 *     administrateur par une fausse manœuvre ;
 *   • un administrateur de pays ne retire pas un autre administrateur : seul
 *     l'administrateur général touche à ce droit.
 *
 * Le geste ne retire que le rattachement. Il ne désactive PAS le compte, même
 * s'il ne lui reste aucun pays : sans cela, rattacher puis retirer quelqu'un
 * suffirait à un administrateur de pays pour fermer le compte d'une personne
 * qui ne relève pas de lui. Du personnel sans pays ne voit de toute façon
 * aucune donnée cloisonnée (mig 173) ; désactiver un compte reste le geste de
 * l'administrateur général.
 */
export async function removeStaffFromJurisdiction(raw: unknown): Promise<RemoveStaffResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_input' };
    const { userId, jurisdictionId } = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { data: me } = await supabase
        .from('profiles')
        .select('role, full_name, is_active')
        .eq('id', auth.user.id)
        .single();
    if (!me || me.is_active !== true) return { ok: false, reason: 'forbidden' };

    const platform = createPlatformClient();
    let scope;
    try {
        scope = await getAdminScope(platform, auth.user.id, me.role);
    } catch (e) {
        log.error('droits illisibles', { err: e });
        return { ok: false, reason: 'failed' };
    }
    if (!canAdminister(scope, jurisdictionId)) return { ok: false, reason: 'forbidden' };
    if (userId === auth.user.id) return { ok: false, reason: 'self' };

    const { data: membership, error: readErr } = await platform
        .from('user_jurisdictions')
        .select('is_admin')
        .eq('user_id', userId)
        .eq('jurisdiction_id', jurisdictionId)
        .maybeSingle();
    if (readErr) {
        log.error('rattachement illisible', { err: readErr.message });
        return { ok: false, reason: 'failed' };
    }
    if (!membership) return { ok: false, reason: 'not_found' };
    if ((membership as { is_admin: boolean }).is_admin && !scope.isGeneralAdmin) {
        return { ok: false, reason: 'forbidden' };
    }

    // La condition « n'est pas administrateur » est répétée DANS la suppression :
    // si le droit a été donné entre la lecture ci-dessus et maintenant, la
    // suppression ne touche aucune ligne au lieu de retirer un administrateur.
    let removal = platform
        .from('user_jurisdictions')
        .delete()
        .eq('user_id', userId)
        .eq('jurisdiction_id', jurisdictionId);
    if (!scope.isGeneralAdmin) {
        removal = removal.eq('is_admin', false);
    }
    const { data: removed, error: deleteErr } = await removal.select('user_id');
    if (deleteErr) {
        log.error('retrait impossible', { err: deleteErr.message });
        return { ok: false, reason: 'failed' };
    }
    if ((removed ?? []).length === 0) return { ok: false, reason: 'forbidden' };

    try {
        await platform.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: me.full_name,
            action: 'TRANSACTION_UPDATED', // audit_action est une énumération : valeur générique, l'événement réel est dans details_json.
            severity: 'WARNING',
            entity_type: 'Profile',
            entity_id: userId,
            jurisdiction_id: jurisdictionId,
            details_json: { event: 'STAFF_REMOVED_FROM_JURISDICTION' },
        });
    } catch {
        // Le journal est tenu au mieux : il ne fait pas échouer le retrait.
    }

    revalidatePath('/admin/staff');
    return { ok: true };
}
