import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Qui administre quoi.
 *
 * Deux niveaux (mig 174) :
 *
 *   • l'administrateur GÉNÉRAL (rôle SUPERADMIN) administre tous les pays, sans
 *     y être rattaché ;
 *   • l'administrateur D'UN PAYS est un membre du personnel dont le
 *     rattachement à ce pays porte `is_admin`. Dans ce pays, il invite et
 *     retire du personnel, et modifie les réglages et les tarifs. Il ne donne
 *     ni ne retire ce droit : seul l'administrateur général le fait.
 *
 * La base applique la même règle (`admin_jurisdiction_ids()`). Ce module est
 * son pendant côté application : les actions écrivent avec la clé de service,
 * elles doivent donc poser elles-mêmes la question avant d'écrire.
 */

/** Les rôles du personnel d'un pays. Ni l'administrateur général, ni les armateurs. */
export const COUNTRY_STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'] as const;
export type CountryStaffRole = (typeof COUNTRY_STAFF_ROLES)[number];

const GENERAL_ADMIN_ROLE = 'SUPERADMIN';

export function isCountryStaffRole(role: string | null | undefined): role is CountryStaffRole {
    return (COUNTRY_STAFF_ROLES as readonly string[]).includes(role ?? '');
}

export interface AdminScope {
    /** Vrai pour l'administrateur général : tous les pays. */
    isGeneralAdmin: boolean;
    /** Les pays administrés. Vide pour l'administrateur général : il n'a pas de liste. */
    jurisdictionIds: string[];
}

const NO_SCOPE: AdminScope = { isGeneralAdmin: false, jurisdictionIds: [] };

/**
 * @param platform client à clé de service. L'appelant a déjà vérifié que le
 *   compte est actif ; un compte inactif ne doit jamais arriver ici.
 * @throws si la lecture échoue — ne jamais prendre une erreur pour « aucun droit »
 *   en silence : l'appelant décide quoi répondre.
 */
export async function getAdminScope(
    platform: SupabaseClient,
    userId: string,
    role: string | null | undefined,
): Promise<AdminScope> {
    if (role === GENERAL_ADMIN_ROLE) {
        return { isGeneralAdmin: true, jurisdictionIds: [] };
    }
    if (!isCountryStaffRole(role)) {
        return NO_SCOPE;
    }

    const { data, error } = await platform
        .from('user_jurisdictions')
        .select('jurisdiction_id')
        .eq('user_id', userId)
        .eq('is_admin', true);
    if (error) {
        throw new Error(`getAdminScope: rattachements illisibles — ${error.message}`);
    }

    const jurisdictionIds = ((data ?? []) as Array<{ jurisdiction_id: string }>).map(
        (row) => row.jurisdiction_id,
    );
    return { isGeneralAdmin: false, jurisdictionIds };
}

export function canAdminister(scope: AdminScope, jurisdictionId: string): boolean {
    return scope.isGeneralAdmin || scope.jurisdictionIds.includes(jurisdictionId);
}

/** Vrai si la personne administre au moins un pays, ou tous. */
export function administersSomething(scope: AdminScope): boolean {
    return scope.isGeneralAdmin || scope.jurisdictionIds.length > 0;
}
