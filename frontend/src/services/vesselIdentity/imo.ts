/**
 * Somme de contrôle IMO (résolution A.1078(28)) : les six premiers chiffres sont
 * pondérés par 7, 6, 5, 4, 3, 2 ; le dernier chiffre de la somme est la clé.
 *
 * Sert de prédicat « ce navire est identifié » : les trois formes de non-identité
 * du portefeuille (`UNVERIFIED-<seed-id>`, « à confirmer », « Hors registre
 * Equasis ») échouent toutes ici, ce qui évite de tester chaque forme séparément.
 */
export function isValidImo(value: string): boolean {
    if (!/^\d{7}$/.test(value)) return false;
    let sum = 0;
    for (let i = 0; i < 6; i += 1) {
        sum += Number(value[i]) * (7 - i);
    }
    return sum % 10 === Number(value[6]);
}
