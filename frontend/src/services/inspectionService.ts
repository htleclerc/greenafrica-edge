import type { SupabaseClient } from '@supabase/supabase-js';
import type { Inspection } from '@/types/secure';
import type { InspectionRow } from '@/types/database';
import { rowToInspection } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getInspections(client: Client): Promise<Inspection[]> {
    const { data } = await client
        .from('inspections')
        .select('*')
        .order('created_at', { ascending: false });
    return ((data ?? []) as InspectionRow[]).map(rowToInspection);
}

export async function getInspectionsByInspector(client: Client, inspectorId: string): Promise<Inspection[]> {
    const { data } = await client
        .from('inspections')
        .select('*')
        .eq('inspector_id', inspectorId)
        .order('created_at', { ascending: false });
    return ((data ?? []) as InspectionRow[]).map(rowToInspection);
}

export async function getInspectionsByVessel(client: Client, vesselId: string): Promise<Inspection[]> {
    const { data } = await client
        .from('inspections')
        .select('*')
        .eq('vessel_id', vesselId)
        .order('created_at', { ascending: false });
    return ((data ?? []) as InspectionRow[]).map(rowToInspection);
}

export async function createInspection(
    client: Client,
    input: Record<string, unknown>,
): Promise<Inspection | null> {
    const { data } = await client.from('inspections').insert(input).select().single();
    return data ? rowToInspection(data as InspectionRow) : null;
}

export async function updateInspection(
    client: Client,
    id: string,
    updates: Record<string, unknown>,
): Promise<Inspection | null> {
    const { data } = await client.from('inspections').update(updates).eq('id', id).select().single();
    return data ? rowToInspection(data as InspectionRow) : null;
}
