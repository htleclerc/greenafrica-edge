import type { SupabaseClient } from '@supabase/supabase-js';
import type { Dispute } from '@/types/secure';
import type { DisputeRow } from '@/types/database';
import { rowToDispute } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getDisputes(client: Client): Promise<Dispute[]> {
    const { data } = await client
        .from('disputes')
        .select('*')
        .order('created_at', { ascending: false });
    return ((data ?? []) as DisputeRow[]).map(rowToDispute);
}

export async function getDisputesBySubmitter(client: Client, userId: string): Promise<Dispute[]> {
    const { data } = await client
        .from('disputes')
        .select('*')
        .eq('submitted_by', userId)
        .order('created_at', { ascending: false });
    return ((data ?? []) as DisputeRow[]).map(rowToDispute);
}

export async function getDisputeByTransaction(client: Client, transactionId: string): Promise<Dispute | null> {
    const { data } = await client
        .from('disputes')
        .select('*')
        .eq('transaction_id', transactionId)
        .maybeSingle();
    return data ? rowToDispute(data as DisputeRow) : null;
}

export async function createDispute(
    client: Client,
    input: Record<string, unknown>,
): Promise<Dispute | null> {
    const { data } = await client.from('disputes').insert(input).select().single();
    return data ? rowToDispute(data as DisputeRow) : null;
}

export async function updateDisputeStatus(
    client: Client,
    id: string,
    status: string,
    reviewNote?: string | null,
    revisedAmountUsd?: number | null,
    reviewerId?: string | null,
): Promise<Dispute | null> {
    const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (reviewNote !== undefined) update.review_note = reviewNote;
    if (revisedAmountUsd !== undefined) update.revised_amount_usd = revisedAmountUsd;
    if (reviewerId !== undefined) update.reviewer_id = reviewerId;
    const { data } = await client.from('disputes').update(update).eq('id', id).select().single();
    return data ? rowToDispute(data as DisputeRow) : null;
}
