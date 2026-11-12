import type { SupabaseClient } from '@supabase/supabase-js';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('walletApply');

export interface ApplyWalletCreditParams {
    /** Facture à créditer. */
    transactionId: string;
    /** Armateur propriétaire du portefeuille ET de la facture. */
    shipownerId: string;
    /** Utilisateur à l'origine du geste — `declared_by` / `confirmed_by`. */
    actorUserId: string;
    /** Montant à débiter du portefeuille, en cents USD. */
    amountMinor: number;
}

export interface ApplyWalletCreditResult {
    walletId: string;
    paymentId: string;
}

/**
 * Débite le portefeuille de l'armateur au profit d'une facture : une ligne
 * `payments` WALLET déjà CONFIRMED (l'argent est là, il n'y a rien à
 * réconcilier) et l'écriture PROFORMA_APPLY correspondante au grand livre.
 *
 * Extrait de l'action `applyWallet` pour être partagé avec `initiatePayment` :
 * un paiement mixte (une partie au portefeuille, le reste par carte) doit
 * poser exactement la même écriture qu'une application intégrale.
 *
 * Le débit et l'insertion du paiement se font atomiquement dans la RPC SQL
 * `apply_wallet_credit` (mig 167) : elle verrouille d'abord la ligne du
 * portefeuille (`FOR UPDATE`), ce qui sérialise les applications concurrentes
 * et empêche la race de double règlement. Le trigger AFTER INSERT de
 * `payments` (mig 051) recalcule le statut de la facture dans la même
 * transaction — le montant n'est pas contraint à couvrir la facture entière,
 * un paiement partiel est un cas normal qui classera la facture en
 * PARTIALLY_PAID.
 *
 * @throws si le portefeuille n'existe pas, si le solde est insuffisant, ou sur
 * erreur SQL — dans tous les cas rien n'a été débité (la RPC est atomique).
 */
export async function applyWalletCredit(
    admin: SupabaseClient,
    params: ApplyWalletCreditParams,
): Promise<ApplyWalletCreditResult> {
    const { transactionId, shipownerId, actorUserId, amountMinor } = params;

    const { data, error } = await admin.rpc('apply_wallet_credit', {
        p_txn_id: transactionId,
        p_shipowner_id: shipownerId,
        p_actor_user_id: actorUserId,
        p_amount_minor: amountMinor,
    });
    if (error) {
        const insufficient = /insufficient|wallet not found/i.test(error.message);
        log.warn(insufficient ? 'wallet_insufficient_funds' : 'wallet_apply_db_error', {
            transactionId,
            shipownerId,
            requestedUsdMinor: amountMinor,
            error: error.message,
        });
        throw new Error(insufficient ? 'Insufficient wallet balance' : error.message);
    }

    const row = (data as { payment_id: string; wallet_id: string }[] | null)?.[0];
    if (!row) {
        log.error('wallet_apply_db_error', { transactionId, shipownerId, stage: 'rpc_empty_result' });
        throw new Error('wallet application returned no row');
    }

    log.info('wallet_applied', {
        transactionId,
        walletId: row.wallet_id,
        amountUsdMinor: amountMinor,
    });

    return { walletId: row.wallet_id, paymentId: row.payment_id };
}
