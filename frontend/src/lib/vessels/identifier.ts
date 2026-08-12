import { isValidImo } from '@/services/vesselIdentity/imo';

export type VesselIdentifier =
    | { kind: 'IMO'; value: string }
    | { kind: 'MMSI'; value: string };

/**
 * Normalise ce qu'un armateur colle dans le champ de recherche. Les saisies
 * arrivent d'un e-mail, d'un PDF de pro-forma ou d'un site AIS : « IMO 9424223 »,
 * « imo-9424223 », « 9424223 » désignent le même navire.
 *
 * 7 chiffres → IMO (avec vérification de la somme de contrôle : c'est la seule
 * protection contre une faute de frappe qui afficherait le navire d'un tiers).
 * 9 chiffres → MMSI. Toute autre longueur → null, rejeté sans appel serveur et
 * sans consommer de quota de rate-limit.
 */
export function normalizeVesselIdentifier(raw: string): VesselIdentifier | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 7) {
        return isValidImo(digits) ? { kind: 'IMO', value: digits } : null;
    }
    if (digits.length === 9) {
        return { kind: 'MMSI', value: digits };
    }
    return null;
}
