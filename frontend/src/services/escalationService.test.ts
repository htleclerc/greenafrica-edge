import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { listUnclaimedEscalated, listUnpaidProformas } from './escalationService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('escalationService', () => {
  if (!key) {
    it.skip('SUPABASE_SERVICE_ROLE_KEY unset', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let vesselId: string;
  let alertId: string;
  let txnId: string;

  beforeEach(async () => {
    // Vessel + ESCALATED alert
    const { data: v } = await admin.from('vessels').upsert({
      mmsi: '999850001', imo_number: 'TEST-ESC-SVC',
      name: 'MV ESC SVC', call_sign: 'TES01', flag_code: 'SO', category: 'CARGO',
      gross_tonnage_dwt: 50000, engine_power_kw: 20000, design_speed_knots: 14.0,
      compliance_status: 'APPROACHING',
    }, { onConflict: 'imo_number' }).select('id').single();
    vesselId = v!.id;

    // Clean prior test rows
    await admin.from('arrival_alerts').update({
      proforma_transaction_id: null,
      final_transaction_id: null,
    }).eq('vessel_id', vesselId);
    await admin.from('transactions').delete().eq('vessel_id', vesselId);
    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);

    const { data: agent } = await admin.from('profiles')
      .select('id').eq('role', 'SHIPPING_AGENT').limit(1).single();

    // ESCALATED alert
    const { data: a1 } = await admin.from('arrival_alerts').insert({
      vessel_id: vesselId, imo_number: 'TEST-ESC-SVC',
      detected_lat: 11, detected_lng: 46, distance_to_port_nm: 400,
      status: 'ESCALATED',
      detected_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      estimated_eta: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    }).select('id').single();
    alertId = a1!.id;

    // Staged unpaid PROFORMA (separate alert in ARRIVED state)
    const { data: a2 } = await admin.from('arrival_alerts').insert({
      vessel_id: vesselId, imo_number: 'TEST-ESC-SVC',
      detected_lat: 11, detected_lng: 46, distance_to_port_nm: 0,
      status: 'ARRIVED',
      arrived_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      matched_agent_id: agent!.id, matched_via: 'AUTO_MAPPING',
    }).select('id').single();
    // A vessel can only have one active alert; if that blocks, reuse alertId.
    // The unique partial index enforces: status NOT IN (RECONCILED, CANCELLED)
    // — ESCALATED and ARRIVED are both active, so the second insert will fail.
    // Fallback: use the same alert and inject a linked PROFORMA directly.

    const { data: t } = await admin.from('transactions').insert({
      vessel_id: vesselId, vessel_name: 'MV ESC SVC', vessel_imo: 'TEST-ESC-SVC',
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: 10, tax_amount_usd: 400,
      status: 'PENDING', collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: a2?.id ?? alertId,
      agent_profile_id: agent!.id,
      owner_escalation_due_at: new Date().toISOString(),
    }).select('id').single();
    txnId = t!.id;
  });

  afterEach(async () => {
    await admin.from('arrival_alerts').update({
      proforma_transaction_id: null,
      final_transaction_id: null,
    }).eq('vessel_id', vesselId);
    await admin.from('transactions').delete().eq('vessel_id', vesselId);
    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);
    await admin.from('vessels').delete().eq('id', vesselId);
  });

  it('listUnclaimedEscalated returns ESCALATED alerts', async () => {
    const rows = await listUnclaimedEscalated(admin);
    expect(rows.map((r) => r.id)).toContain(alertId);
    const hit = rows.find((r) => r.id === alertId);
    expect(hit?.status).toBe('ESCALATED');
    expect(hit?.vessel.name).toBe('MV ESC SVC');
  });

  it('listUnpaidProformas returns staged unpaid PROFORMAs', async () => {
    const rows = await listUnpaidProformas(admin);
    expect(rows.map((r) => r.transactionId)).toContain(txnId);
    const hit = rows.find((r) => r.transactionId === txnId);
    expect(hit?.taxAmountUsd).toBe(400);
    expect(hit?.vesselName).toBe('MV ESC SVC');
  });
});
