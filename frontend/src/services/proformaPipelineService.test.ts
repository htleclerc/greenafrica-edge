import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { runProformaPipeline } from './proformaPipelineService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080';

describe('proformaPipelineService.runProformaPipeline', () => {
  if (!key) {
    it.skip('SERVICE_ROLE_KEY unset', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  let alertId: string;

  beforeAll(async () => {
    // Fixture: vessel + alert in MATCHED_AUTO
    const { data: v } = await admin
      .from('vessels')
      .upsert({
        mmsi: '999700001', imo_number: 'TEST-PIPE',
        name: 'MV PIPE', call_sign: 'TP01', flag_code: 'SO', category: 'CARGO',
        gross_tonnage_dwt: 30000, engine_power_kw: 15000,
        design_speed_knots: 14.0, compliance_status: 'APPROACHING',
      }, { onConflict: 'imo_number' })
      .select('id').single();

    // Clean up any lingering alert for this vessel
    await admin.from('arrival_alerts').delete().eq('vessel_id', v!.id);

    const { data: agent } = await admin
      .from('profiles').select('id').eq('role', 'SHIPPING_AGENT').limit(1).single();
    const { data: alert } = await admin
      .from('arrival_alerts').insert({
        vessel_id: v!.id, imo_number: 'TEST-PIPE',
        detected_lat: 11, detected_lng: 46, distance_to_port_nm: 480,
        estimated_route_nm: 140,
        status: 'MATCHED_AUTO',
        matched_agent_id: agent!.id, matched_via: 'AUTO_MAPPING',
      }).select('id').single();
    alertId = alert!.id;
  });

  it('creates PROFORMA transaction, sets alert to PROFORMA_SENT, uploads PDF, stubs email', async () => {
    const result = await runProformaPipeline({
      alertId,
      adminClient: admin,
      taxApiUrl: apiUrl,
      dryRunEmail: true,
      dryRunStorage: true,
    });

    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[proformaPipelineTest] failed:', result.reason);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.transactionId).toBeTruthy();

    const { data: txn } = await admin
      .from('transactions').select('document_type, status, tax_amount_usd, arrival_alert_id')
      .eq('id', result.transactionId).single();
    expect(txn!.document_type).toBe('PROFORMA');
    expect(txn!.status).toBe('PENDING');
    expect(txn!.arrival_alert_id).toBe(alertId);
    expect(Number(txn!.tax_amount_usd)).toBeGreaterThan(0);

    const { data: a } = await admin
      .from('arrival_alerts').select('status, proforma_transaction_id')
      .eq('id', alertId).single();
    expect(a!.status).toBe('PROFORMA_SENT');
    expect(a!.proforma_transaction_id).toBe(result.transactionId);
  });
});
