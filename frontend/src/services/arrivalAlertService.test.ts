import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { listUnclaimedAlerts, claimAlert, getAlert } from './arrivalAlertService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('arrivalAlertService', () => {
  if (!key) {
    it.skip('SUPABASE_SERVICE_ROLE_KEY unset — skipping integration tests', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let vesselId: string;
  let alertId: string;
  let agentId: string;

  beforeEach(async () => {
    const { data: v } = await admin
      .from('vessels')
      .upsert({
        mmsi: '999600001',
        imo_number: 'TEST-SVC-1',
        name: 'MV SVC',
        call_sign: 'TSV01',
        flag_code: 'SO',
        category: 'CARGO',
        gross_tonnage_dwt: 50000,
        engine_power_kw: 20000,
        design_speed_knots: 14.0,
        compliance_status: 'APPROACHING',
      }, { onConflict: 'imo_number' })
      .select('id')
      .single();
    vesselId = v!.id;

    // Clean up any lingering alert from a previous run
    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);

    const { data: a } = await admin
      .from('arrival_alerts')
      .insert({
        vessel_id: vesselId,
        imo_number: 'TEST-SVC-1',
        detected_lat: 11, detected_lng: 46, distance_to_port_nm: 400,
        status: 'UNCLAIMED',
      })
      .select('id')
      .single();
    alertId = a!.id;

    const { data: p } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'SHIPPING_AGENT')
      .limit(1)
      .single();
    agentId = p!.id;
  });

  it('listUnclaimedAlerts returns our seeded row', async () => {
    const rows = await listUnclaimedAlerts(admin);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(alertId);
  });

  it('getAlert returns the row', async () => {
    const a = await getAlert(admin, alertId);
    expect(a?.status).toBe('UNCLAIMED');
  });

  it('claimAlert moves UNCLAIMED → CLAIMED and rejects double claim', async () => {
    const first = await claimAlert(admin, alertId, agentId);
    expect(first.ok).toBe(true);
    const second = await claimAlert(admin, alertId, agentId);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toMatch(/already claimed|not found/i);
    }
  });
});
