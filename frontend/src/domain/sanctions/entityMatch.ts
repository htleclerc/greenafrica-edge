/**
 * Mots vides des raisons sociales maritimes : formes juridiques et termes de
 * secteur, trop répandus pour discriminer. NAVIGATION en est volontairement
 * absent : il reste porteur de sens (« Morgan Navigation »).
 */
const STOP_WORDS = new Set([
    'SHIPPING', 'SHIP', 'SHIPS', 'MARITIME', 'MARINE', 'COMPANY', 'GROUP',
    'MANAGEMENT', 'MGMT', 'SERVICES', 'SERVICE', 'TRADING', 'ENERGY',
    'INTERNATIONAL', 'HOLDING', 'HOLDINGS', 'LINES', 'LINE', 'AGENCY',
    'SARL', 'LTD', 'LLC', 'INC', 'PTE', 'FZE', 'FZCO', 'DMCC', 'GMBH', 'CORP',
]);

/** Jetons discriminants d'une raison sociale : majuscules, ≥ 3 lettres, hors mots vides. */
export function significantTokens(name: string): Set<string> {
    return new Set(
        String(name ?? '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, ' ')
            .split(' ')
            .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    );
}

/**
 * Vrai si le candidat contient TOUS les jetons significatifs d'au moins une des
 * dénominations de référence. Le sens est asymétrique : la référence (le nom
 * sanctionné du référentiel, souvent plus court) doit être incluse dans le
 * candidat (le nom VesselFinder, souvent enrichi de suffixes).
 *
 * En cas de doute la fonction penche vers le rapprochement : un faux positif
 * bloque un envoi et provoque une revue humaine ; un faux négatif enverrait une
 * facture à une entité sous sanctions.
 */
export function matchesSanctionedEntity(
    candidateName: string,
    referenceNames: readonly string[],
): boolean {
    const candidate = significantTokens(candidateName);
    if (candidate.size === 0) return false;
    return referenceNames.some((reference) => {
        const ref = significantTokens(reference);
        if (ref.size === 0) return false;
        return [...ref].every((token) => candidate.has(token));
    });
}
