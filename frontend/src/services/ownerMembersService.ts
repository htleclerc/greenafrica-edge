import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase.generated';
import { privilegesFromMember, type OwnerPrivileges } from '@/lib/auth/ownerPrivileges';

/** Ce que rend `owner_members_with_identity()` (mig 141). */
interface RawMember {
    id: string;
    profile_id: string;
    email: string | null;
    full_name: string | null;
    can_pay: boolean | null;
    can_dispute: boolean | null;
    can_manage_vessels: boolean | null;
    can_invite: boolean | null;
    active: boolean;
    created_at: string;
    revoked_at: string | null;
}

export interface OwnerMemberView {
    id: string;
    profileId: string;
    email: string;
    fullName: string | null;
    privileges: OwnerPrivileges;
    invitedAt: string;
    /** Vrai tant que l'accès vaut ; une révocation garde la ligne, datée. */
    active: boolean;
    revokedAt: string | null;
}

/**
 * Liste les membres d'un compte armateur, actifs d'abord.
 *
 * Les révoqués restent : savoir qui a eu accès, et jusqu'à quand, fait partie
 * du compte — c'est la première chose qu'on cherche quand on se demande qui a
 * pu voir quoi. RLS (mig 135) borne déjà la lecture au compte de l'appelant ;
 * le filtre explicite est une seconde barrière, pas la première.
 */
export async function listOwnerMembers(db: SupabaseClient): Promise<OwnerMemberView[]> {
    // Passe par la fonction bornée de la mig 141 plutôt que par la table : RLS
    // n'accorde à un armateur la lecture que de SON propre profil, donc un JOIN
    // depuis `owner_members` rendait des identités vides et l'écran affichait
    // deux tirets à la place du nom et de l'adresse.
    //
    // La fonction ne prend aucun paramètre : sa portée vient de la session, il
    // n'y a donc rien à falsifier pour lire les membres d'un autre compte.
    const { data, error } = await db.rpc('owner_members_with_identity');

    // Une liste vide plutôt qu'une page en erreur : les membres sont une
    // section du compte, pas la page. On journalise pour que l'échec ne soit
    // pas muet côté serveur.
    if (error) {
        console.error('[listOwnerMembers]', error.message);
        return [];
    }

    return ((data ?? []) as RawMember[]).map((row) => ({
        id: row.id,
        profileId: row.profile_id,
        email: row.email ?? '—',
        fullName: row.full_name,
        privileges: privilegesFromMember(row),
        invitedAt: row.created_at,
        active: row.active,
        revokedAt: row.revoked_at,
    }));
}

