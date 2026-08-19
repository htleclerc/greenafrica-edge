import { isValidImo } from '@/services/vesselIdentity/imo';

export type VesselIdentifier =
    | { kind: 'IMO'; value: string }
    | { kind: 'MMSI'; value: string };

/**
 * Raison précise du rejet, pour affichage à l'utilisateur :
 * - FORMAT : le nombre de chiffres n'est ni 7 ni 9 (y compris saisie vide ou
 *   sans aucun chiffre).
 * - IMO_CHECKSUM : exactement 7 chiffres, mais la clé de contrôle ne
 *   correspond pas — le cas le plus trompeur, car la longueur est correcte.
 */
export type VesselIdentifierProblem = 'FORMAT' | 'IMO_CHECKSUM';

/**
 * Classe ce qu'un armateur colle dans le champ de recherche. Les saisies
 * arrivent d'un e-mail, d'un PDF de pro-forma ou d'un site AIS : « IMO 9424223 »,
 * « imo-9424223 », « 9424223 » désignent le même navire.
 *
 * 7 chiffres → IMO (avec vérification de la somme de contrôle : c'est la seule
 * protection contre une faute de frappe qui afficherait le navire d'un tiers).
 * 9 chiffres → MMSI. Toute autre longueur → problème de format, rejeté sans
 * appel serveur et sans consommer de quota de rate-limit.
 *
 * Seule implémentation de la règle : `normalizeVesselIdentifier` s'appuie
 * dessus plutôt que de dupliquer la logique.
 */
export function classifyVesselIdentifier(raw: string):
    | { ok: true; identifier: VesselIdentifier }
    | { ok: false; problem: VesselIdentifierProblem } {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 7) {
        return isValidImo(digits)
            ? { ok: true, identifier: { kind: 'IMO', value: digits } }
            : { ok: false, problem: 'IMO_CHECKSUM' };
    }
    if (digits.length === 9) {
        return { ok: true, identifier: { kind: 'MMSI', value: digits } };
    }
    return { ok: false, problem: 'FORMAT' };
}

/**
 * Normalise ce qu'un armateur colle dans le champ de recherche, sans exposer
 * la raison du rejet. Signature et comportement externes inchangés : consommé
 * par `vesselTeaserService.ts`, `requestVesselAccessCode.ts` et
 * `verifyVesselAccessCode.ts`.
 */
export function normalizeVesselIdentifier(raw: string): VesselIdentifier | null {
    const result = classifyVesselIdentifier(raw);
    return result.ok ? result.identifier : null;
}
