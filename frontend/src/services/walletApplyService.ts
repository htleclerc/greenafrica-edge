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
 * réconcilier) et l'écriture PROFORMA_APPLY correspondante au grand livre,
 * dont le trigger resynchronise le solde.
 *
 * Extrait de l'action `applyWallet` pour être partagé avec `initiatePayment` :
 * un paiement mixte (une partie au portefeuille, le reste par carte) doit
 * poser exactement la même écriture qu'une application intégrale.
 *
 * Le montant n'est pas contraint à couvrir la facture entière — un paiement
 * partiel est un cas normal, `recompute_transaction_status` classera la
 * facture en PARTIALLY_PAID.
 *
 * @throws si le portefeuille n'existe pas, si le solde est insuffisant, ou sur
 * erreur SQL. L'appelant doit traiter tout throw comme « rien n'a été débité »
 * — hormis l'échec du recompute final, journalisé et non bloquant (le trigger
 * de `payments` recalcule aussi).
 */
export async function applyWalletCredit(
    admin: SupabaseClient,
    params: ApplyWalletCreditParams,
): Promise<ApplyWalletCreditResult> {
    const { transactionId, shipownerId, actorUserId, amountMinor } = params;

    const { data: wallet, error: wErr } = await admin
        .from('wallets')
        .select('id, balance_usd_minor')
        .eq('shipowner_id', shipownerId)
        .maybeSingle();
    if (wErr) throw wErr;
    if (!wallet) {
        log.warn('wallet_insufficient_funds', {
            transactionId,
            shipownerId,
            reason: 'no_wallet',
            requestedUsdMinor: amountMinor,
        });
        throw new Error('Insufficient wallet balance');
    }

    const balance = wallet.balance_usd_minor ?? 0;
    if (balance < amountMinor) {
        log.warn('wallet_insufficient_funds', {
            transactionId,
            shipownerId,
            walletId: wallet.id,
            balanceUsdMinor: balance,
            requestedUsdMinor: amountMinor,
        });
        throw new Error('Insufficient wallet balance');
    }

    const confirmedAt = new Date().toISOString();
    const { data: payment, error: payErr } = await admin
        .from('payments')
        .insert({
            transaction_id: transactionId,
            shipowner_id: shipownerId,
            declared_by: actorUserId,
            amount_minor: amountMinor,
            currency: 'USD',
            amount_usd_minor: amountMinor,
            rail: 'WALLET',
            status: 'CONFIRMED',
            confirmed_by: actorUserId,
            confirmed_at: confirmedAt,
            rail_details: { applied_by_owner: true },
        })
        .select('id')
        .single();
    if (payErr) {
        log.error('wallet_apply_db_error', {
            transactionId,
            walletId: wallet.id,
            stage: 'payments_insert',
            error: payErr.message,
        });
        throw payErr;
    }

    // Débit signé négatif — le trigger du grand livre resynchronise le solde.
    const { error: ledgErr } = await admin.from('wallet_ledger').insert({
        wallet_id: wallet.id,
        kind: 'PROFORMA_APPLY',
        amount_signed_usd_minor: -amountMinor,
        created_by: actorUserId,
    });
    if (ledgErr) {
        log.error('wallet_apply_db_error', {
            transactionId,
            walletId: wallet.id,
            stage: 'wallet_ledger_insert',
            error: ledgErr.message,
        });
        throw ledgErr;
    }

    const { error: rpcErr } = await admin.rpc('recompute_transaction_status', {
        p_txn_id: transactionId,
    });
    if (rpcErr) {
        // Le trigger de `payments` recalcule aussi — journaliser, ne pas annuler.
        log.error('recompute_transaction_status_failed', {
            transactionId,
            walletId: wallet.id,
            error: rpcErr.message,
        });
    }

    log.info('wallet_applied', {
        transactionId,
        walletId: wallet.id,
        amountUsdMinor: amountMinor,
    });

    return { walletId: wallet.id, paymentId: (payment as { id: string }).id };
}
