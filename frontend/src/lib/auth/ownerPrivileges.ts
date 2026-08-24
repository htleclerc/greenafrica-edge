/**
 * Sous-permissions d'une personne sur un compte armateur (mig 135).
 *
 * Drapeaux additifs, jamais un rôle : c'est la règle posée par la mig 130 pour
 * `can_settle_payments`, et elle vaut ici pour la même raison — un compte ne
 * peut pas cumuler deux rôles, alors qu'un collègue peut très bien payer sans
 * pouvoir inviter.
 */
export interface OwnerPrivileges {
    canPay: boolean;
    canDispute: boolean;
    canManageVessels: boolean;
    canInvite: boolean;
}

/**
 * Le titulaire du compte a tout.
 *
 * Il ne s'invite pas lui-même : aucune ligne `owner_members` ne le décrit, et
 * exiger qu'il s'en crée une produirait des comptes verrouillés dont plus
 * personne ne peut rien faire.
 */
export const OWNER_ALL_PRIVILEGES: OwnerPrivileges = {
    canPay: true,
    canDispute: true,
    canManageVessels: true,
    canInvite: true,
};

/** Un membre sans aucun droit coché : il voit le compte, il n'agit pas dessus. */
export const NO_PRIVILEGES: OwnerPrivileges = {
    canPay: false,
    canDispute: false,
    canManageVessels: false,
    canInvite: false,
};

/** Une ligne `owner_members`, telle que la rend PostgREST. */
export interface OwnerMemberRow {
    can_pay?: boolean | null;
    can_dispute?: boolean | null;
    can_manage_vessels?: boolean | null;
    can_invite?: boolean | null;
}

/**
 * Traduit une ligne d'appartenance en privilèges.
 *
 * Tout ce qui n'est pas explicitement `true` vaut `false` : une colonne absente
 * — une ligne lue avec un `select` partiel, un drapeau ajouté plus tard et pas
 * encore rempli — ne doit jamais accorder un droit par accident.
 */
export function privilegesFromMember(row: OwnerMemberRow | null | undefined): OwnerPrivileges {
    if (!row) return NO_PRIVILEGES;
    return {
        canPay: row.can_pay === true,
        canDispute: row.can_dispute === true,
        canManageVessels: row.can_manage_vessels === true,
        canInvite: row.can_invite === true,
    };
}

/** Clés des privilèges, pour les écrans qui les listent. */
export const PRIVILEGE_KEYS = ['canPay', 'canDispute', 'canManageVessels', 'canInvite'] as const;
export type PrivilegeKey = (typeof PRIVILEGE_KEYS)[number];

/** Colonne correspondante, pour composer une écriture. */
export const PRIVILEGE_COLUMN: Record<PrivilegeKey, string> = {
    canPay: 'can_pay',
    canDispute: 'can_dispute',
    canManageVessels: 'can_manage_vessels',
    canInvite: 'can_invite',
};

/**
 * Un membre ne peut jamais accorder plus que ce qu'il détient.
 *
 * Sans cette borne, la délégation transitive serait une escalade : un membre
 * porteur du seul `can_invite` créerait un compte muni de `can_pay`, puis s'y
 * connecterait. Le titulaire, lui, détient tout — la borne est alors sans effet.
 */
export function clampToGranter(
    requested: OwnerPrivileges,
    granter: OwnerPrivileges,
): OwnerPrivileges {
    return {
        canPay: requested.canPay && granter.canPay,
        canDispute: requested.canDispute && granter.canDispute,
        canManageVessels: requested.canManageVessels && granter.canManageVessels,
        canInvite: requested.canInvite && granter.canInvite,
    };
}
