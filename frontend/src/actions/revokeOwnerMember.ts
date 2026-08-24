'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';
import { notifyOwner } from '@/services/notificationService';

const schema = z.object({ memberId: z.string().uuid() });

export type RevokeOwnerMemberResult = { ok: true } | { ok: false; reason: string };

/**
 * Retire l'accès d'un membre au compte.
 *
 * Révoquer, jamais supprimer : la ligne reste, `active` passe à faux et
 * `revoked_at` est daté. Un accès passé doit rester lisible — c'est la première
 * chose qu'on cherche quand on se demande qui a pu voir quoi, et une ligne
 * effacée ne répond pas à cette question.
 *
 * Le droit de révoquer suit celui d'inviter : qui peut ouvrir la porte peut la
 * refermer. Sans quoi un titulaire absent laisserait son équipe sans recours
 * après le départ d'un collègue.
 *
 * La portée vient de la session : le filtre sur `shipowner_id` interdit de
 * révoquer le membre d'un autre compte, même en forgeant l'identifiant.
 */
export async function revokeOwnerMember(raw: unknown): Promise<RevokeOwnerMemberResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid input' };

    const principal = await requirePrincipal();
    if (principal.kind !== 'operator') return { ok: false, reason: 'not_an_operator' };
    if (!principal.privileges.canInvite) return { ok: false, reason: 'forbidden' };

    const admin = createPlatformClient();

    const { data: member } = await admin
        .from('owner_members')
        .select('id, profile_id, shipowner_id, active, profiles!inner(email)')
        .eq('id', parsed.data.memberId)
        .eq('shipowner_id', principal.shipowner.id)
        .maybeSingle();

    const row = member as {
        id: string; profile_id: string; active: boolean;
        profiles: { email: string | null } | { email: string | null }[] | null;
    } | null;
    if (!row) return { ok: false, reason: 'not_found' };
    if (!row.active) return { ok: true };  // déjà révoqué — rien à faire, pas une erreur

    // Se révoquer soi-même fermerait la porte de l'intérieur : un membre resterait
    // sans accès et sans personne pour le lui rendre s'il était le seul invitant.
    if (row.profile_id === principal.userId) return { ok: false, reason: 'self' };

    const { error } = await admin
        .from('owner_members')
        .update({ active: false, revoked_at: new Date().toISOString() })
        .eq('id', row.id);
    if (error) return { ok: false, reason: error.message };

    await writeAuditLog(admin, {
        user_id: principal.userId,
        user_full_name: principal.email,
        action: 'USER_CREATED',
        severity: 'WARNING',
        entity_type: 'Shipowner',
        entity_id: principal.shipowner.id,
        jurisdiction_id: principal.jurisdictionId,
        details_json: {
            event: 'OWNER_MEMBER_REVOKED',
            member_profile_id: row.profile_id,
            revoked_by_member: principal.isMember,
        },
    });

    // Même raison que pour l'invitation : `can_invite` porte aussi la
    // révocation, donc un membre peut fermer l'accès d'un autre. Le titulaire
    // qui révoque lui-même n'a rien à apprendre.
    if (principal.isMember) {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        try {
            await notifyOwner(admin, {
                shipownerId: principal.shipowner.id,
                kind: 'MEMBER_REVOKED',
                params: {
                    member_email: profile?.email ?? row.profile_id,
                    revoked_by: principal.email,
                },
                deepLink: '/owner/profile',
            });
        } catch (e) {
            // La révocation a pris effet : un avis manqué ne la défait pas.
            console.error('[revokeOwnerMember] notifyOwner', e);
        }
    }

    revalidatePath('/owner/profile');
    return { ok: true };
}
