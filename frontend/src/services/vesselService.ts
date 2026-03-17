import type { SupabaseClient } from '@supabase/supabase-js';
import type { SecureVessel, VesselPosition } from '@/types/secure';
import type { VesselRow, VesselPositionRow } from '@/types/database';
import { rowToSecureVessel, rowToVesselPosition } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getVessels(client: Client): Promise<SecureVessel[]> {
    const { data: vessels, error } = await client
        .from('vessels')
        .select('*')
        .order('name');
    if (error || !vessels) return [];

    const vesselIds = (vessels as VesselRow[]).map((v) => v.id);
    const { data: positions } = await client
        .from('vessel_positions')
        .select('*')
        .in('vessel_id', vesselIds)
        .order('recorded_at', { ascending: false });

    const latestPos = new Map<string, VesselPositionRow>();
    if (positions) {
        for (const p of positions as VesselPositionRow[]) {
            if (!latestPos.has(p.vessel_id)) latestPos.set(p.vessel_id, p);
        }
    }

    return (vessels as VesselRow[]).map((v) =>
        rowToSecureVessel(v, latestPos.get(v.id) ?? null),
    );
}

export async function getVesselById(client: Client, id: string): Promise<SecureVessel | null> {
    const { data: vessel } = await client.from('vessels').select('*').eq('id', id).single();
    if (!vessel) return null;

    const { data: pos } = await client
        .from('vessel_positions')
        .select('*')
        .eq('vessel_id', id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();

    return rowToSecureVessel(vessel as VesselRow, (pos as VesselPositionRow) ?? null);
}

export async function getVesselsByOwner(client: Client, ownerId: string): Promise<SecureVessel[]> {
    const { data: vessels } = await client
        .from('vessels')
        .select('*')
        .eq('owner_id', ownerId)
        .order('name');
    if (!vessels) return [];

    const vesselIds = (vessels as VesselRow[]).map((v) => v.id);
    const { data: positions } = await client
        .from('vessel_positions')
        .select('*')
        .in('vessel_id', vesselIds)
        .order('recorded_at', { ascending: false });

    const latestPos = new Map<string, VesselPositionRow>();
    if (positions) {
        for (const p of positions as VesselPositionRow[]) {
            if (!latestPos.has(p.vessel_id)) latestPos.set(p.vessel_id, p);
        }
    }

    return (vessels as VesselRow[]).map((v) =>
        rowToSecureVessel(v, latestPos.get(v.id) ?? null),
    );
}

export async function getVesselPositionHistory(
    client: Client,
    vesselId: string,
    since: string,
): Promise<VesselPosition[]> {
    const { data } = await client
        .from('vessel_positions')
        .select('*')
        .eq('vessel_id', vesselId)
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: true });

    return ((data ?? []) as VesselPositionRow[]).map(rowToVesselPosition);
}
