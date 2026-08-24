/**
 * Rails pour lesquels un justificatif de paiement est EXIGE a la soumission.
 *
 * Ce sont les rails ou l'armateur DECLARE un versement que la plateforme n'a
 * pas vu passer : le virement, le mobile money, le paiement par un tiers. Sans
 * piece, une declaration n'est qu'une affirmation — le service financier n'a
 * rien a rapprocher, et la facture reste ouverte pendant que l'armateur croit
 * l'avoir reglee. C'est exactement le malentendu que la piece supprime.
 *
 * STRIPE et PAYPAL en sont exclus : la plateforme constate elle-meme
 * l'encaissement (webhook, capture au retour), la preuve est cote systeme.
 * WALLET aussi : l'imputation est une ecriture interne, il n'y a pas de
 * versement exterieur a prouver.
 */
export const RAILS_REQUIRING_PROOF = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY'] as const;

export type RailRequiringProof = typeof RAILS_REQUIRING_PROOF[number];

export function railRequiresProof(rail: string | null | undefined): boolean {
    return (RAILS_REQUIRING_PROOF as readonly string[]).includes(String(rail));
}
