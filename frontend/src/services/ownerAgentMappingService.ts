import type { SupabaseClient } from '@supabase/supabase-js';

export interface OwnerAgentMapping {
  id: string;
  shipowner_id: string;
  shipowner_name: string;
  agent_profile_id: string;
  agent_name: string;
  priority: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
}

const SELECT = `
  id, shipowner_id, agent_profile_id,
  priority, valid_from, valid_until, active, created_at,
  shipowner:shipowners ( name ),
  agent:profiles!owner_agent_mappings_agent_profile_id_fkey ( full_name, email )
`;

interface RawRow {
  id: string;
  shipowner_id: string;
  agent_profile_id: string;
  priority: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
  shipowner: { name: string } | { name: string }[] | null;
  agent: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
}

function flatten(raw: RawRow): OwnerAgentMapping {
  const so = Array.isArray(raw.shipowner) ? raw.shipowner[0] : raw.shipowner;
  const ag = Array.isArray(raw.agent) ? raw.agent[0] : raw.agent;
  return {
    id: raw.id,
    shipowner_id: raw.shipowner_id,
    shipowner_name: so?.name ?? '—',
    agent_profile_id: raw.agent_profile_id,
    agent_name: ag?.full_name ?? ag?.email ?? '—',
    priority: raw.priority,
    valid_from: raw.valid_from,
    valid_until: raw.valid_until,
    active: raw.active,
    created_at: raw.created_at,
  };
}

export async function listMappings(
  db: SupabaseClient,
  opts: { activeOnly?: boolean } = {},
): Promise<OwnerAgentMapping[]> {
  let q = db.from('owner_agent_mappings').select(SELECT).order('created_at', { ascending: false });
  if (opts.activeOnly) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as RawRow[]).map(flatten);
}

export async function createMapping(
  db: SupabaseClient,
  input: {
    shipownerId: string;
    agentProfileId: string;
    priority?: number;
    validFrom?: string;
    validUntil?: string | null;
  },
): Promise<OwnerAgentMapping> {
  const { data, error } = await db
    .from('owner_agent_mappings')
    .insert({
      shipowner_id: input.shipownerId,
      agent_profile_id: input.agentProfileId,
      priority: input.priority ?? 100,
      valid_from: input.validFrom ?? new Date().toISOString().slice(0, 10),
      valid_until: input.validUntil ?? null,
      active: true,
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  return flatten(data as unknown as RawRow);
}

export async function deactivateMapping(
  db: SupabaseClient,
  mappingId: string,
): Promise<void> {
  const { error } = await db
    .from('owner_agent_mappings')
    .update({ active: false })
    .eq('id', mappingId);
  if (error) throw error;
}
