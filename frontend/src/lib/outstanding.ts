// Definition unique du « reste du » sur une ligne fiscale.
//
// Elle doit dire EXACTEMENT la meme chose que la vue `v_transaction_outstanding`
// (migrations 132 et 134). Deux definitions d'une meme somme finissent toujours
// par diverger, et c'est l'armateur qui lit l'ecart.
//
// D'ou vient le montant encaisse :
//   · les paiements CONFIRMED — seule source depuis le rail v7 ;
//   · `transactions.partial_paid_usd` — seule source AVANT lui. La table
//     `payments` a demarre vide (mig 048) ; le backfill de la mig 022 a inscrit
//     dans cette colonne le montant reglé des factures deja soldees a cette
//     date. La mig 089 l'a ensuite gelee : elle n'est plus jamais ecrite, mais
//     elle reste la trace de cette epoque-la.
//
// On retient le PLUS GRAND des deux, jamais leur somme : ils couvrent deux
// periodes, pas deux reglements distincts d'une meme facture.

/** Statuts qui n'ouvrent aucune creance : rien n'est du, rien n'est reclamable. */
export const NON_CLAIMABLE_STATUSES = ['VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED'] as const;

/**
 * Statuts qui ne laissent rien a devoir. PAID s'y ajoute :
 * `recompute_transaction_status` (mig 051) ne le pose que lorsque les
 * encaissements couvrent le montant du. C'est l'affirmation de reglement de la
 * plateforme — une facture marquee payee dont la trace manque est une anomalie
 * a signaler, pas une somme a reclamer au debiteur.
 */
export const SETTLED_STATUSES = [...NON_CLAIMABLE_STATUSES, 'PAID'] as const;

/**
 * Une facture reclamable entre dans les totaux facture/paye d'un dossier. PAID
 * en fait partie : l'en sortir ferait diminuer le total facture d'un armateur a
 * mesure qu'il regle.
 */
export function isClaimable(status: string | null | undefined): boolean {
    return !(NON_CLAIMABLE_STATUSES as readonly string[]).includes(String(status));
}

export interface OutstandingColumns {
    status: string | null;
    tax_amount_usd: number | string | null;
    partial_paid_usd?: number | string | null;
}

/**
 * Montant deja encaisse sur la ligne, toutes epoques confondues. NON borne au
 * montant de la facture : un trop-percu doit rester visible pour etre
 * rembourse, pas etre silencieusement absorbe.
 */
export function paidUsd(row: OutstandingColumns, confirmedPaidUsd = 0): number {
    return Math.max(Number(row.partial_paid_usd ?? 0), confirmedPaidUsd);
}

/**
 * Somme encore due. Zero sur un statut qui ne doit rien, sinon le montant taxe
 * diminue de l'encaissement connu. Jamais negatif : un sur-encaissement se
 * regle par un remboursement, il ne doit pas venir effacer une autre facture
 * dans un total.
 */
export function outstandingUsd(row: OutstandingColumns, confirmedPaidUsd = 0): number {
    if ((SETTLED_STATUSES as readonly string[]).includes(String(row.status))) return 0;
    const due = Number(row.tax_amount_usd ?? 0) - paidUsd(row, confirmedPaidUsd);
    return due > 0 ? due : 0;
}
