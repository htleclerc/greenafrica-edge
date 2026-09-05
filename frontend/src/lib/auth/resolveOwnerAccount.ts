import type { SupabaseClient } from '@supabase/supabase-js';
import {
    OWNER_ALL_PRIVILEGES, privilegesFromMember, type OwnerPrivileges,
} from '@/lib/auth/ownerPrivileges';

/**
 * Colonnes lues sur `shipowners` pour décrire le compte d'un appelant.
 * Partagées par `requireOwner` et les routes API du portail.
 */
export const OWNER_ACCOUNT_COLUMNS =
    'id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at, kyc_level_c_completed_at, aoc_number, jurisdiction_id';

export interface OwnerAccountRow {
    id: string;
    name: string | null;
    official_email: string | null;
    account_state: string;
    jurisdiction_id: string;
    [column: string]: unknown;
}

export interface ResolvedOwnerAccount {
    shipowner: OwnerAccountRow;
    /** Sous-permissions de l'appelant sur ce compte. Le titulaire les a toutes. */
    privileges: OwnerPrivileges;
    /** Vrai quand l'appelant est un membre invité, pas le titulaire. */
    isMember: boolean;
}

/**
 * Le compte armateur d'un utilisateur : le sien s'il en est titulaire, sinon
 * celui dont il est membre actif (mig 135).
 *
 * Même préséance que `current_shipowner_id()` côté base — la propriété
 * d'abord, l'appartenance ensuite. Les deux résolutions doivent répondre la
 * même chose, sans quoi l'écran montrerait un compte et la RLS un autre.
 *
 * Ne juge ni l'état du compte ni les droits : c'est à l'appelant de décider
 * ce qu'il fait d'un compte suspendu (redirection pour une page, 404 pour une
 * API). Rend `null` quand l'utilisateur n'a aucun compte.
 *
 * Toutes les lectures passent par le client de SESSION : la RLS borne déjà
 * `shipowners` à `current_shipowner_id()`, la lecture par identifiant ne peut
 * donc rendre que le compte dont la personne est membre.
 */
export async function resolveOwnerAccount(
    supabase: SupabaseClient,
    userId: string,
): Promise<ResolvedOwnerAccount | null> {
    const { data: owned } = await supabase
        .from('shipowners')
        .select(OWNER_ACCOUNT_COLUMNS)
        .eq('profile_id', userId)
        .maybeSingle();

    if (owned) {
        return { shipowner: owned as OwnerAccountRow, privileges: OWNER_ALL_PRIVILEGES, isMember: false };
    }

    const { data: membership } = await supabase
        .from('owner_members')
        .select('shipowner_id, can_pay, can_dispute, can_manage_vessels, can_invite')
        .eq('profile_id', userId)
        .eq('active', true)
        .maybeSingle();
    if (!membership) return null;

    const memberRow = membership as { shipowner_id: string };
    const { data: memberOwner } = await supabase
        .from('shipowners')
        .select(OWNER_ACCOUNT_COLUMNS)
        .eq('id', memberRow.shipowner_id)
        .maybeSingle();
    if (!memberOwner) return null;

    return {
        shipowner: memberOwner as OwnerAccountRow,
        privileges: privilegesFromMember(membership),
        isMember: true,
    };
}
