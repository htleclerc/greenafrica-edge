import type { SupabaseClient } from '@supabase/supabase-js';
import type { CarbonProject } from '@/types/secure';
import type { CarbonProjectRow } from '@/types/database';
import { rowToCarbonProject } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getCarbonProjects(client: Client): Promise<CarbonProject[]> {
    const { data } = await client
        .from('carbon_projects')
        .select('*')
        .order('name');
    return ((data ?? []) as CarbonProjectRow[]).map(rowToCarbonProject);
}

export async function getCarbonProjectById(client: Client, id: string): Promise<CarbonProject | null> {
    const { data } = await client.from('carbon_projects').select('*').eq('id', id).single();
    return data ? rowToCarbonProject(data as CarbonProjectRow) : null;
}
