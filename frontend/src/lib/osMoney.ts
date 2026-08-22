/**
 * Formats monétaires des écrans denses.
 *
 * Les montants y sont rendus en monospace et alignés à droite : un séparateur
 * de milliers étroit (espace insécable, convention francophone) garde les
 * colonnes lisibles là où `$128,400.00` les fait déborder. Les centimes ne
 * figurent pas — à l'échelle d'un encours ils n'informent personne, et le
 * détail exact reste sur la fiche.
 */

const GROUPED = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** `$128 400` — montant de ligne, de total, de KPI. */
export function usdGrouped(amount: number): string {
    return `$${GROUPED.format(Math.round(amount))}`;
}

/**
 * `$1,42 M` au-delà du million, `$684 300` en dessous.
 *
 * Réservé aux cellules KPI, où la place est comptée et où l'ordre de grandeur
 * suffit. Jamais sur une ligne de facture : un montant dû se lit en entier.
 */
export function usdCompact(amount: number): string {
    if (Math.abs(amount) >= 1_000_000) return `$${COMPACT.format(amount / 1_000_000)} M`;
    return usdGrouped(amount);
}

/** `+$4 200` / `−$4 200` — mouvement signé, avec le vrai signe moins typographique. */
export function usdSigned(amount: number): string {
    const sign = amount < 0 ? '−' : '+';
    return `${sign}${usdGrouped(Math.abs(amount))}`;
}
