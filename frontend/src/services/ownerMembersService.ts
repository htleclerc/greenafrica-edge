import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase.generated';
import { privilegesFromMember, type OwnerPrivileges } from '@/lib/auth/ownerPrivileges';

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
export async function listOwnerMembers(
    db: SupabaseClient<Database>,
    shipownerId: string,
): Promise<OwnerMemberView[]> {
    const { data, error } = await db
        .from('owner_members')
        .select(
            'id, profile_id, can_pay, can_dispute, can_manage_vessels, can_invite, active, created_at, revoked_at, profiles!inner(email, full_name)',
        )
        .eq('shipowner_id', shipownerId)
        .order('active', { ascending: false })
        .order('created_at', { ascending: true });

    // Une liste vide plutôt qu'une page en erreur : les membres sont une
    // section du profil, pas la page. On journalise pour que l'échec ne soit
    // pas muet côté serveur.
    if (error) {
        console.error('[listOwnerMembers]', error.message);
        return [];
    }

    return (data ?? []).map((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
            id: row.id,
            profileId: row.profile_id,
            email: profile?.email ?? '—',
            fullName: profile?.full_name ?? null,
            privileges: privilegesFromMember(row),
            invitedAt: row.created_at,
            active: row.active,
            revokedAt: row.revoked_at,
        };
    });
}
