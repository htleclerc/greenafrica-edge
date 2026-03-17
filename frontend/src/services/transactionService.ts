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
