import type { SupabaseClient } from '@supabase/supabase-js';
import type { Exemption } from '@/types/secure';
import type { ExemptionRow } from '@/types/database';
import { rowToExemption } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getExemptions(client: Client): Promise<Exemption[]> {
    const { data } = await client
        .from('exemptions')
        .select('*')
        .order('created_at', { ascending: false });
    return ((data ?? []) as ExemptionRow[]).map(rowToExemption);
}

export async function createExemption(
    client: Client,
    input: Record<string, unknown>,
): Promise<Exemption | null> {
    const { data } = await client.from('exemptions').insert(input).select().single();
    return data ? rowToExemption(data as ExemptionRow) : null;
}
