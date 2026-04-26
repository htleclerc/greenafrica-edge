import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  listMappings, createMapping, deactivateMapping,
} from './ownerAgentMappingService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('ownerAgentMappingService', () => {
  if (!key) {
    it.skip('SUPABASE_SERVICE_ROLE_KEY unset', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let shipownerId: string;
  let agentId: string;

  beforeEach(async () => {
    const { data: so } = await admin
      .from('shipowners')
      .insert({ name: `Test Owner ${Date.now()}`, account_state: 'GHOST' })
      .select('id')
      .single();
    shipownerId = so!.id;

    const { data: p } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'SHIPPING_AGENT')
      .limit(1)
      .single();
    agentId = p!.id;
  });

  afterEach(async () => {
    // Clean the test-created mappings and shipowner
    await admin.from('owner_agent_mappings').delete().eq('shipowner_id', shipownerId);
    await admin.from('shipowners').delete().eq('id', shipownerId);
  });

  it('createMapping + listMappings round-trip', async () => {
    const mapping = await createMapping(admin, {
      shipownerId,
      agentProfileId: agentId,
    });
    expect(mapping.shipowner_id).toBe(shipownerId);
    expect(mapping.agent_profile_id).toBe(agentId);
    expect(mapping.active).toBe(true);

    const rows = await listMappings(admin);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(mapping.id);
    expect(rows.find((r) => r.id === mapping.id)!.shipowner_name).toBeTruthy();
    expect(rows.find((r) => r.id === mapping.id)!.agent_name).toBeTruthy();
  });

  it('deactivateMapping hides from activeOnly listing', async () => {
    const m = await createMapping(admin, {
      shipownerId,
      agentProfileId: agentId,
    });
    await deactivateMapping(admin, m.id);

    const all = await listMappings(admin);
    const active = await listMappings(admin, { activeOnly: true });

    expect(all.find((r) => r.id === m.id)?.active).toBe(false);
    expect(active.find((r) => r.id === m.id)).toBeUndefined();
  });
});
