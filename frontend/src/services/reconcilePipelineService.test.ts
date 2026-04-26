import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { runReconcilePipeline } from './reconcilePipelineService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080';

describe('runReconcilePipeline', () => {
  if (!key) {
    it.skip('SERVICE_ROLE_KEY unset', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let alertId: string;
  let proformaId: string;

  beforeAll(async () => {
    const { data: v } = await admin.from('vessels').upsert({
      mmsi: '999810001', imo_number: 'TEST-RECON-SVC',
      name: 'MV RECON SVC', call_sign: 'TRS01', flag_code: 'SO', category: 'CARGO',
      gross_tonnage_dwt: 30000, engine_power_kw: 15000, design_speed_knots: 14,
      compliance_status: 'APPROACHING',
    }, { onConflict: 'imo_number' }).select('id').single();
    const vesselId = v!.id;

    // Break FK cycles before deleting — arrival_alerts.proforma_transaction_id /
    // final_transaction_id point at transactions; transactions.arrival_alert_id
    // points back at arrival_alerts. Null out both sides first, then delete.
    await admin.from('arrival_alerts')
      .update({ proforma_transaction_id: null, final_transaction_id: null })
      .eq('vessel_id', vesselId);
    await admin.from('transactions').delete().eq('vessel_id', vesselId);
    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);
    await admin.from('vessel_positions').delete().eq('vessel_id', vesselId);

    const { data: agent } = await admin.from('profiles')
      .select('id').eq('role', 'SHIPPING_AGENT').limit(1).single();

    // Two positions 60 NM apart inside EEZ bounding box — feeds distance-final RPC
    await admin.from('vessel_positions').insert([
      { vessel_id: vesselId, lat: 11, lng: 45, heading: 90, speed_knots: 12,
        zone: 'EEZ', recorded_at: new Date(Date.now() - 50 * 60 * 1000).toISOString() },
      { vessel_id: vesselId, lat: 11, lng: 46, heading: 90, speed_knots: 12,
        zone: 'EEZ', recorded_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    ]);

    const { data: a, error: aErr } = await admin.from('arrival_alerts').insert({
      vessel_id: vesselId, imo_number: 'TEST-RECON-SVC',
      detected_lat: 11, detected_lng: 46, distance_to_port_nm: 0,
      status: 'DEPARTED_EEZ',
      arrived_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      departed_eez_at: new Date().toISOString(),
      matched_agent_id: agent!.id, matched_via: 'AUTO_MAPPING',
    }).select('id').single();
    if (aErr || !a) {
      // eslint-disable-next-line no-console
      console.error('[reconcilePipelineTest] alert insert failed:', aErr);
      throw aErr ?? new Error('alert insert returned null');
    }
    alertId = a.id;

    const { data: p } = await admin.from('transactions').insert({
      vessel_id: vesselId, vessel_name: 'MV RECON SVC', vessel_imo: 'TEST-RECON-SVC',
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: 13.3, tax_amount_usd: 532.0,
      status: 'PENDING', collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: alertId,
      agent_profile_id: agent!.id,
      distance_eez_nm: 140, rate_usd_per_tco2: 40,
    }).select('id').single();
    proformaId = p!.id;

    await admin.from('arrival_alerts')
      .update({ proforma_transaction_id: proformaId })
      .eq('id', alertId);
  });

  it('transitions alert to RECONCILED and issues FINAL/COMPLEMENT/REFUND', async () => {
    const result = await runReconcilePipeline({
      alertId,
      adminClient: admin,
      taxApiUrl: apiUrl,
      dryRunEmail: true,
      dryRunStorage: true,
    });
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[reconcilePipelineTest] failed:', result.reason);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const { data: a } = await admin.from('arrival_alerts')
      .select('status, final_transaction_id').eq('id', alertId).single();
    expect(a!.status).toBe('RECONCILED');
    expect(a!.final_transaction_id).toBe(result.transactionId);

    const { data: txn } = await admin.from('transactions')
      .select('document_type, related_transaction_id, tax_amount_usd')
      .eq('id', result.transactionId).single();
    expect(['FINAL', 'COMPLEMENT', 'REFUND']).toContain(txn!.document_type);
    expect(txn!.related_transaction_id).toBe(proformaId);
  });
});
