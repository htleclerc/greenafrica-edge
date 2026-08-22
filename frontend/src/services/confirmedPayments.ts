import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Montant reellement encaisse par facture, lu la ou il vit : les paiements
 * CONFIRMED.
 *
 * `transactions.partial_paid_usd` NE PORTE PAS cette information. La migration
 * 089 la gele explicitement (« mig 022 one-time backfill ONLY [...] the
 * recompute RPC does NOT write this column »), et
 * `recompute_transaction_status` (mig 051) se contente de passer le statut a
 * PARTIALLY_PAID sans jamais toucher la colonne. Toute somme calculee en
 * `tax_amount_usd - partial_paid_usd` reclame donc le montant PLEIN d'une
 * facture deja reglee en partie.
 *
 * Le client passe ici doit etre celui de la session : la RLS (mig 058)
 * restreint `payments` a l'armateur proprietaire.
 */
export async function confirmedPaidUsdByTransaction(
    supabase: SupabaseClient,
    transactionIds: string[],
): Promise<Map<string, number>> {
    const paid = new Map<string, number>();
    if (transactionIds.length === 0) return paid;

    const { data, error } = await supabase
        .from('payments')
        .select('transaction_id, amount_usd_minor')
        .in('transaction_id', transactionIds)
        .eq('status', 'CONFIRMED');
    if (error) throw new Error(`paiements confirmes : ${error.message}`);

    for (const row of (data ?? []) as { transaction_id: string | null; amount_usd_minor: number | string | null }[]) {
        if (!row.transaction_id) continue;
        const cents = Number(row.amount_usd_minor ?? 0);
        paid.set(row.transaction_id, (paid.get(row.transaction_id) ?? 0) + cents / 100);
    }
    return paid;
}
