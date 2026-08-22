import type { LedgerRow, NextTaxPrediction } from './walletService';

/**
 * Un mouvement du portefeuille, augmenté du solde qu'il laisse derrière lui.
 *
 * Le solde courant après opération est ce qui rend un relevé vérifiable : sans
 * lui, l'armateur ne peut que faire confiance à la colonne des montants.
 */
export interface Movement {
    id: string;
    createdAt: string;
    kind: LedgerRow['kind'];
    /** Montant signé, en dollars. Négatif pour une sortie. */
    amountUsd: number;
    /** Solde après cette opération, en dollars. */
    balanceAfterUsd: number;
    transactionId: string | null;
    paymentId: string | null;
    refundId: string | null;
    justification: string | null;
}

/**
 * Reconstitue le solde courant après chaque mouvement, à rebours du solde actuel.
 *
 * La table `wallet_ledger` ne stocke que des deltas : le solde d'une ligne se
 * déduit du solde d'aujourd'hui moins tous les mouvements postérieurs. On part
 * donc du plus récent, à qui revient le solde actuel, et on remonte.
 *
 * `rows` est attendu **du plus récent au plus ancien** — l'ordre de lecture d'un
 * relevé. La fonction ne le suppose pas : elle trie elle-même, pour qu'un
 * appelant qui change son `.order()` ne fausse pas silencieusement les soldes.
 */
export function withRunningBalances(rows: LedgerRow[], currentBalanceUsdMinor: number): Movement[] {
    const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

    let balanceMinor = currentBalanceUsdMinor;
    return sorted.map((r) => {
        const movement: Movement = {
            id: r.id,
            createdAt: r.created_at,
            kind: r.kind,
            amountUsd: r.amount_signed_usd_minor / 100,
            balanceAfterUsd: balanceMinor / 100,
            transactionId: r.transaction_id,
            paymentId: r.payment_id,
            refundId: r.refund_id,
            justification: r.justification,
        };
        // Le solde d'avant cette ligne, qui sera celui de la ligne suivante
        // (plus ancienne) : on défait le mouvement en remontant le temps.
        balanceMinor -= r.amount_signed_usd_minor;
        return movement;
    });
}

export interface Provision {
    /** Ce que les 30 prochains jours vont réclamer. */
    dueSoonUsd: number;
    balanceUsd: number;
    /** Ce qu'il manque. `0` quand le solde couvre déjà les échéances. */
    gapUsd: number;
    /** Vrai quand il y a quelque chose à provisionner — pilote l'affichage de la carte. */
    short: boolean;
    confidence: NextTaxPrediction['confidence'];
    estimatedCount: number;
}

/**
 * Provision recommandée : ce qu'il faut ajouter pour couvrir les 30 prochains jours.
 *
 * C'est le seul endroit du produit où l'on anticipe au lieu de constater — d'où
 * l'écart énoncé en une phrase et le bouton qui porte le montant exact. Un
 * portefeuille suffisamment garni ne montre pas la carte : il n'y a rien à
 * décider.
 */
export function computeProvision(
    prediction: NextTaxPrediction,
    balanceUsd: number,
): Provision {
    const dueSoonUsd = prediction.estimated_amount_30d_usd;
    const gapUsd = Math.max(0, dueSoonUsd - balanceUsd);
    return {
        dueSoonUsd,
        balanceUsd,
        gapUsd,
        short: gapUsd > 0,
        confidence: prediction.confidence,
        estimatedCount: prediction.estimated_count_30d,
    };
}
