'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { provisionOwnerAccount } from '@/services/ownerProvisioning';
import { assertContactAllowed, SanctionedContactError } from '@/domain/sanctions/contactGuard';
import { writeAuditLog } from '@/services/auditService';
import {
    clampToGranter, DEFAULT_INVITE_PRIVILEGES, PRIVILEGE_COLUMN, PRIVILEGE_KEYS, type OwnerPrivileges,
} from '@/lib/auth/ownerPrivileges';
import { notifyOwner } from '@/services/notificationService';
import { sendMemberAccessEmail } from '@/services/emailService';

const schema = z.object({
    email: z.string().trim().email(),
    fullName: z.string().trim().min(2).max(120),
    // Permissif sur le paiement (mig 148) : un appel qui ne dit rien accorde
    // « payer », et seulement ça. Retirer ce droit est un geste explicite.
    privileges: z.object({
        canPay: z.boolean().default(DEFAULT_INVITE_PRIVILEGES.canPay),
        canDispute: z.boolean().default(DEFAULT_INVITE_PRIVILEGES.canDispute),
        canManageVessels: z.boolean().default(DEFAULT_INVITE_PRIVILEGES.canManageVessels),
        canInvite: z.boolean().default(DEFAULT_INVITE_PRIVILEGES.canInvite),
    }).default(DEFAULT_INVITE_PRIVILEGES),
});

export type InviteOwnerMemberResult =
    | { ok: true; memberId: string; granted: OwnerPrivileges }
    | { ok: false; reason: string };

/**
 * Invite un collègue à travailler sur le compte armateur.
 *
 * Appelable par le titulaire ET par un membre portant `can_invite` — c'est la
 * délégation transitive retenue. Elle est bornée par `clampToGranter` : nul ne
 * peut accorder ce qu'il ne détient pas. Sans cette borne, un membre porteur du
 * seul `can_invite` créerait un compte muni de `can_pay` puis s'y connecterait.
 *
 * Deux refus qui ne sautent pas aux yeux :
 *   — inviter le titulaire d'un autre compte est **inerte**. La propriété
 *     l'emporte sur l'appartenance (mig 135), l'invitation ne changerait rien
 *     pour lui. Mieux vaut le dire que de créer une ligne qui ne fera rien.
 *   — une personne n'a qu'UNE appartenance active. L'index unique de la mig 135
 *     le garantit ; on le détecte avant pour rendre un motif lisible plutôt
 *     qu'une violation de contrainte.
 */
export async function inviteOwnerMember(raw: unknown): Promise<InviteOwnerMemberResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const principal = await requirePrincipal();
    if (principal.kind !== 'operator') return { ok: false, reason: 'not_an_operator' };
    if (!principal.privileges.canInvite) return { ok: false, reason: 'forbidden' };

    const granted = clampToGranter(parsed.data.privileges, principal.privileges);
    const email = parsed.data.email.toLowerCase();
    const owner = principal.shipowner;

    // On ne s'invite pas soi-même.
    if (email === (principal.email ?? '').toLowerCase()) {
        return { ok: false, reason: 'self' };
    }

    const admin = createPlatformClient();

    // Garde sanctions AVANT toute écriture : ouvrir un canal de contact
    // supplémentaire sur un armateur sanctionné est exactement ce que la règle
    // interdit, quel que soit celui qui le demande.
    try {
        assertContactAllowed(owner as never);
    } catch (e: unknown) {
        if (e instanceof SanctionedContactError) {
            await writeAuditLog(admin, {
                user_id: principal.userId,
                user_full_name: principal.email,
                action: 'SANCTIONS_CONTACT_BLOCKED',
                severity: 'CRITICAL',
                entity_type: 'Shipowner',
                entity_id: owner.id,
                jurisdiction_id: principal.jurisdictionId,
                details_json: { code: e.code, attempted: 'INVITE_MEMBER', email },
            });
            return { ok: false, reason: `sanctioned: ${e.message}` };
        }
        throw e;
    }

    let provisioned;
    try {
        provisioned = await provisionOwnerAccount(admin, { email, fullName: parsed.data.fullName });
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'provisioning failed' };
    }

    // Titulaire d'un autre compte : l'invitation serait inerte (cf. en-tête).
    const { data: ownsSomething } = await admin
        .from('shipowners')
        .select('id')
        .eq('profile_id', provisioned.profileId)
        .maybeSingle();
    if (ownsSomething) {
        return {
            ok: false,
            reason: (ownsSomething as { id: string }).id === owner.id ? 'already_holder' : 'holds_other_account',
        };
    }

    // Appartenance active ailleurs — détectée ici pour un motif lisible.
    const { data: existing } = await admin
        .from('owner_members')
        .select('id, shipowner_id')
        .eq('profile_id', provisioned.profileId)
        .eq('active', true)
        .maybeSingle();

    const row = existing as { id: string; shipowner_id: string } | null;
    if (row && row.shipowner_id !== owner.id) {
        return { ok: false, reason: 'member_of_other_account' };
    }

    const flags = Object.fromEntries(
        (Object.keys(PRIVILEGE_COLUMN) as (keyof typeof PRIVILEGE_COLUMN)[])
            .map((key) => [PRIVILEGE_COLUMN[key], granted[key]]),
    );

    // Déjà membre de CE compte : on met ses droits à jour plutôt que de refuser.
    // C'est le geste attendu quand on ré-invite quelqu'un avec d'autres cases.
    let memberId: string;
    if (row) {
        const { error } = await admin.from('owner_members').update(flags).eq('id', row.id);
        if (error) return { ok: false, reason: error.message };
        memberId = row.id;
    } else {
        const { data: created, error } = await admin
            .from('owner_members')
            .insert({
                shipowner_id: owner.id,
                profile_id: provisioned.profileId,
                invited_by: principal.userId,
                ...flags,
            })
            .select('id')
            .single();
        if (error) return { ok: false, reason: error.message };
        memberId = (created as { id: string }).id;
    }

    // La délégation est transitive : sans trace, on ne saurait plus remonter
    // la chaîne quand un accès est contesté.
    await writeAuditLog(admin, {
        user_id: principal.userId,
        user_full_name: principal.email,
        action: 'USER_CREATED',
        severity: 'WARNING',
        entity_type: 'Shipowner',
        entity_id: owner.id,
        jurisdiction_id: principal.jurisdictionId,
        details_json: {
            event: row ? 'OWNER_MEMBER_UPDATED' : 'OWNER_MEMBER_INVITED',
            member_email: email,
            granted,
            granted_by_member: principal.isMember,
        },
    });

    // La personne invitée doit apprendre qu'elle a un accès, et pouvoir entrer.
    //
    // `provisionOwnerAccount` crée le compte DÉLIBÉRÉMENT en silence — c'est son
    // contrat, écrit pour le rattrapage de la campagne du 19 août, où le lien
    // arrivait par la relance suivante. Réutilisée telle quelle pour un geste
    // qui s'appelle « inviter », elle laissait le membre avec un accès dont il
    // ignorait l'existence. L'envoi manquait, il est ici.
    //
    // Un échec d'envoi n'annule pas l'invitation : la ligne est créée, le droit
    // existe, et le titulaire peut ré-inviter. Mais il est journalisé.
    try {
        const { data: link } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email,
            options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard` },
        });
        const action = link?.properties?.action_link;
        const code = link?.properties?.email_otp;
        if (action && code) {
            await sendMemberAccessEmail({
                to: email,
                recipientName: parsed.data.fullName,
                accountName: owner.name ?? 'Green Gate',
                invitedBy: principal.email ?? '—',
                granted: PRIVILEGE_KEYS.filter((key) => granted[key]),
                link: action,
                code,
            });
        } else {
            console.error('[inviteOwnerMember] lien non généré pour', email);
        }
    } catch (e) {
        console.error("[inviteOwnerMember] envoi au membre invité", e);
    }

    // Quand c'est un MEMBRE qui ouvre un accès, le titulaire doit l'apprendre.
    // Le journal d'audit garde la trace, mais personne ne le lit au quotidien :
    // sans ce fait, un accès qu'il n'a pas accordé lui resterait invisible. Le
    // titulaire qui invite lui-même n'a rien à apprendre.
    if (principal.isMember) {
        try {
            await notifyOwner(admin, {
                shipownerId: owner.id,
                kind: 'MEMBER_INVITED',
                params: {
                    member_email: email,
                    member_name: parsed.data.fullName,
                    invited_by: principal.email,
                    granted: PRIVILEGE_KEYS.filter((key) => granted[key]),
                    updated: Boolean(row),
                },
                deepLink: '/owner/profile',
            });
        } catch (e) {
            // L'invitation est faite et valide : un avis manqué ne l'annule pas.
            console.error('[inviteOwnerMember] notifyOwner', e);
        }
    }

    revalidatePath('/owner/profile');
    return { ok: true, memberId, granted };
}
