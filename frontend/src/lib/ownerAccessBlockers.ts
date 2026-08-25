/**
 * Pourquoi ce débiteur ne paie-t-il pas ?
 *
 * Un poste de recouvrement relance des armateurs qui, parfois, ne peuvent
 * matériellement pas payer : on n'a jamais eu leur adresse, leur compte n'a
 * jamais été activé, ou un régime de sanctions interdit de les contacter.
 * Relancer dans ces cas-là n'est pas seulement inutile, c'est trompeur — le
 * registre enregistre une relance que personne n'a reçue.
 *
 * Ces empêchements se déduisent de données déjà présentes sur la fiche. Les
 * nommer explicitement évite au gestionnaire de les reconstituer de tête.
 */
export type OwnerBlocker =
    /** Aucune adresse de facturation : la relance ne part vers personne. */
    | 'NO_EMAIL'
    /** Compte jamais créé — l'armateur n'a aucun accès au portail. */
    | 'NO_ACCOUNT'
    /** Invitation envoyée mais jamais acceptée : il ne s'est jamais connecté. */
    | 'INVITE_PENDING'
    /** Sanctions OFAC / UN : la prise de contact est interdite. */
    | 'SANCTIONED';

export interface OwnerAccessInput {
    officialEmail: string | null;
    accountState: string;
    isOfacSdn: boolean;
    isUnProhibited: boolean;
}

/**
 * Les empêchements, du plus bloquant au moins bloquant.
 *
 * `SANCTIONED` vient en tête : c'est le seul qui interdit d'agir plutôt que
 * de constater une impossibilité technique.
 */
export function ownerAccessBlockers(input: OwnerAccessInput): OwnerBlocker[] {
    const blockers: OwnerBlocker[] = [];

    if (input.isOfacSdn || input.isUnProhibited) blockers.push('SANCTIONED');

    const email = input.officialEmail?.trim();
    if (!email) blockers.push('NO_EMAIL');

    if (input.accountState === 'GHOST') blockers.push('NO_ACCOUNT');
    else if (input.accountState === 'INVITED') blockers.push('INVITE_PENDING');

    return blockers;
}

/** `true` quand une relance atteindrait réellement quelqu'un. */
export function isReachable(input: OwnerAccessInput): boolean {
    const blockers = ownerAccessBlockers(input);
    return !blockers.includes('NO_EMAIL') && !blockers.includes('SANCTIONED');
}
