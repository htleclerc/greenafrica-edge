// Definition unique du « reste du » sur une ligne fiscale.
//
// Elle vivait en deux exemplaires qui ne disaient pas la meme chose : le releve
// et les ecrans staff retranchent `partial_paid_usd`, la flotte de l'armateur
// sommait le montant plein. Pire, AUCUNE des deux n'etait juste : la migration
// 089 gele `partial_paid_usd` (« mig 022 one-time backfill ONLY [...] the
// recompute RPC does NOT write this column ») et la 051 passe le statut a
// PARTIALLY_PAID sans jamais l'ecrire. La colonne vaut donc zero sur toute
// facture en cours, et `tax_amount_usd - partial_paid_usd` reclame le montant
// plein d'une facture deja reglee en partie.
//
// Le montant encaisse se lit dans les paiements CONFIRMED
// (services/confirmedPayments.ts), jamais sur la transaction.

/** Statuts qui laissent une somme a devoir. */
export const OUTSTANDING_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const;

export function isOutstanding(status: string | null | undefined): boolean {
    return (OUTSTANDING_STATUSES as readonly string[]).includes(String(status));
}

export interface OutstandingColumns {
    status: string | null;
    tax_amount_usd: number | string | null;
    partial_paid_usd?: number | string | null;
}

/**
 * Somme encore due sur une ligne : zero si son statut ne doit rien, sinon le
 * montant taxe diminue de ce qui a deja ete encaisse dessus.
 *
 * `confirmedPaidUsd` vient des paiements CONFIRMED. On retient le PLUS GRAND
 * des deux montants encaisses connus plutot que leur somme : les additionner
 * compterait deux fois une ligne que le backfill de la migration 022 a
 * renseignee — ce backfill n'a vise que des factures deja soldees, pour
 * lesquelles la question ne se pose pas. Les deux colonnes ne portent jamais
 * deux reglements distincts.
 *
 * Jamais negatif : un sur-encaissement se regle par un remboursement, il ne
 * doit pas venir effacer une autre facture dans un total.
 */
export function outstandingUsd(row: OutstandingColumns, confirmedPaidUsd = 0): number {
    if (!isOutstanding(row.status)) return 0;
    const paid = Math.max(Number(row.partial_paid_usd ?? 0), confirmedPaidUsd);
    const due = Number(row.tax_amount_usd ?? 0) - paid;
    return due > 0 ? due : 0;
}
