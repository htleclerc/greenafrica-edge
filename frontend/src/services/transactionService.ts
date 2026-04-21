import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transaction } from '@/types/secure';
import type { TransactionRow } from '@/types/database';
import { rowToTransaction } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getTransactions(client: Client): Promise<Transaction[]> {
    const { data } = await client
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false });
    return ((data ?? []) as TransactionRow[]).map(rowToTransaction);
}

export async function getTransactionsByVessel(client: Client, vesselId: string): Promise<Transaction[]> {
    const { data } = await client
        .from('transactions')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });
    return ((data ?? []) as TransactionRow[]).map(rowToTransaction);
}

/**
 * Oldest PENDING transaction. When SSR-scoped as a SHIPPING_AGENT, RLS filters
 * to own fleet automatically. Returns null when there's no PENDING tx — caller
 * renders the "Compte à jour" empty state for armateurs.
 *
 * Used by NextPaymentCard to show days-remaining based on a 30-day due-window
 * (created_at + 30d). PR-2 NET-30 will replace this with a stored due_date.
 */
export async function getNextPendingTransaction(client: Client): Promise<Transaction | null> {
    const { data } = await client
        .from('transactions')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    return data ? rowToTransaction(data as TransactionRow) : null;
}

export async function createTransaction(
    client: Client,
    input: Record<string, unknown>,
): Promise<Transaction | null> {
    const { data } = await client.from('transactions').insert(input).select().single();
    return data ? rowToTransaction(data as TransactionRow) : null;
}

export async function updateTransactionStatus(
    client: Client,
    id: string,
    status: string,
    paidAt?: string,
): Promise<Transaction | null> {
    const update: Record<string, unknown> = { status };
    if (paidAt) update.paid_at = paidAt;
    const { data } = await client.from('transactions').update(update).eq('id', id).select().single();
    return data ? rowToTransaction(data as TransactionRow) : null;
}
