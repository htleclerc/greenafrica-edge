'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('setSettlementRights');

const schema = z.object({
    profileId: z.string().uuid(),
    enabled: z.boolean(),
});

/**
 * Coche ou décoche la sous-permission « valider les encaissements » sur un
 * compte staff (mig 130).
 *
 * Réservé au SUPERADMIN : c'est une délégation de droit sur le rail monétaire.
 * Un FINANCE_ADMIN ne peut pas s'en faire des adjoints.
 *
 * L'écriture passe par le client plateforme : le trigger
 * `profiles_privileged_column_guard` (mig 119/130) refuse cette colonne à tout
 * chemin authentifié non-SUPERADMIN, et l'appelant est ici déjà SUPERADMIN —
 * mais le client plateforme garde l'écriture hors de portée des politiques RLS
 * de lecture croisée, comme les autres gestes staff (approbation, invitation).
 */
export async function setSettlementRights(input: { profileId: string; enabled: boolean }) {
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

    // Un armateur n'a rien à faire dans le back-office : la sous-permission ne
    // s'accorde qu'à du personnel.
    if (target.role === 'SHIPPING_AGENT') {
        throw new Error('Settlement rights are staff-only');
    }

    const { error: updErr } = await admin
        .from('profiles')
        .update({ can_settle_payments: parsed.enabled })
        .eq('id', parsed.profileId);
    if (updErr) throw updErr;

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'SETTLEMENT_RIGHTS_UPDATED',
        // Une délégation sur le rail monétaire mérite mieux qu'INFO : c'est ce
        // qu'on relit quand on cherche qui a pu valider un encaissement.
        severity: 'WARNING',
        entity_type: 'Profile',
        entity_id: parsed.profileId,
        details_json: {
            event: parsed.enabled ? 'SETTLEMENT_RIGHTS_GRANTED' : 'SETTLEMENT_RIGHTS_REVOKED',
            target_role: target.role,
            target_name: target.full_name,
        },
    });

    log.info('settlement_rights_updated', {
        profileId: parsed.profileId,
        enabled: parsed.enabled,
        targetRole: target.role,
        byUserId: auth.user.id,
    });

    revalidatePath('/admin/staff');
    return { ok: true as const };
}
