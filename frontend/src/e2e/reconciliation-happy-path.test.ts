/**
 * End-to-end happy path test for the reconciliation pipeline.
 *
 * This test exercises the full cascade:
 *   ARRIVED + PROFORMA → (status → DEPARTED_EEZ trigger enqueues pgmq msg) →
 *     (worker route pops the queue) → RECONCILED with FINAL/COMPLEMENT/REFUND
 *
 * Requirements to run end-to-end (all three services must be up):
 *   1. `supabase start` — local Supabase DB with all migrations applied
 *   2. `cd backend && go run ./cmd/api` — Go tax calculator on http://127.0.0.1:8080
 *   3. `cd frontend && npm run dev` — Next.js dev server on http://127.0.0.1:3300
 *
 * The Next.js server must have `QUEUE_WORKER_SECRET` set to the same value
 * passed to this test's env (otherwise the worker route returns 401/500).
 *
 * Run:
 *   QUEUE_WORKER_SECRET='test-secret' \
 *   NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
 *   SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
 *   AFRICGREEN_API_URL='http://127.0.0.1:8080' \
 *     npx vitest run src/e2e/reconciliation-happy-path
 *
 * If creds are missing (e.g. CI without Supabase), the test self-skips.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const nextAppUrl = process.env.NEXT_APP_URL ?? 'http://127.0.0.1:3300';
const workerSecret = process.env.QUEUE_WORKER_SECRET!;

describe('Reconciliation happy path (e2e)', () => {
  if (!key || !workerSecret) {
    it.skip('creds missing', () => {});
    return;
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  let alertId: string;
  let proformaId: string;
  let vesselId: string;

  beforeAll(async () => {
    const { data: v } = await admin.from('vessels').upsert(
      {
        mmsi: '999920001',
        imo_number: 'TEST-RECON-E2E',
        name: 'MV RECON E2E',
        call_sign: 'TRE01',
        flag_code: 'SO',
        category: 'CARGO',
        gross_tonnage_dwt: 30000,
        engine_power_kw: 15000,
        design_speed_knots: 14,
        compliance_status: 'APPROACHING',
      },
      { onConflict: 'imo_number' },
    ).select('id').single();
    vesselId = v!.id;

    // Cleanup order: null FKs on alerts → delete transactions → delete alerts → delete positions
    await admin.from('arrival_alerts')
      .update({ proforma_transaction_id: null, final_transaction_id: null })
      .eq('vessel_id', vesselId);
    await admin.from('transactions').delete().eq('vessel_id', vesselId);
    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);
    await admin.from('vessel_positions').delete().eq('vessel_id', vesselId);

    const { data: agent } = await admin.from('profiles')
      .select('id').eq('role', 'SHIPPING_AGENT').limit(1).single();

    // Seed two positions inside EEZ ~60 NM apart so alert_distance_final_nm
    // returns a positive number.
    await admin.from('vessel_positions').insert([
      { vessel_id: vesselId, lat: 11, lng: 45, heading: 90, speed_knots: 12,
        zone: 'EEZ',
        recorded_at: new Date(Date.now() - 50 * 60 * 1000).toISOString() },
      { vessel_id: vesselId, lat: 11, lng: 46, heading: 90, speed_knots: 12,
        zone: 'EEZ',
        recorded_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    ]);

    // Alert in ARRIVED (trigger fires on transition to DEPARTED_EEZ).
    const { data: a } = await admin.from('arrival_alerts').insert({
      vessel_id: vesselId,
      imo_number: 'TEST-RECON-E2E',
      detected_lat: 11,
      detected_lng: 46,
      distance_to_port_nm: 0,
      status: 'ARRIVED',
      arrived_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      matched_agent_id: agent!.id,
      matched_via: 'AUTO_MAPPING',
    }).select('id').single();
    alertId = a!.id;

    // Proforma transaction linked to the alert.
    const { data: p } = await admin.from('transactions').insert({
      vessel_id: vesselId,
      vessel_name: 'MV RECON E2E',
      vessel_imo: 'TEST-RECON-E2E',
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: 13.3,
      tax_amount_usd: 532.0,
      status: 'PENDING',
      collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: alertId,
      agent_profile_id: agent!.id,
      distance_eez_nm: 140,
      rate_usd_per_tco2: 40,
    }).select('id').single();
    proformaId = p!.id;

    await admin.from('arrival_alerts')
      .update({ proforma_transaction_id: proformaId })
      .eq('id', alertId);
  });

  it('DEPARTED_EEZ trigger → worker route → RECONCILED with FINAL/COMPLEMENT/REFUND', async () => {
    // Transition to DEPARTED_EEZ — trigger enqueues pgmq message
    await admin.from('arrival_alerts')
      .update({ status: 'DEPARTED_EEZ', departed_eez_at: new Date().toISOString() })
      .eq('id', alertId);

    // Hit the worker route once
    const workerRes = await fetch(`${nextAppUrl}/api/queue/process-reconciliation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Queue-Secret': workerSecret,
      },
      body: '{}',
    });
    expect(workerRes.status).toBe(200);

    const body = (await workerRes.json()) as {
      transactionId: string;
      documentType: 'FINAL' | 'COMPLEMENT' | 'REFUND';
    };
    expect(body.transactionId).toBeTruthy();
    expect(['FINAL', 'COMPLEMENT', 'REFUND']).toContain(body.documentType);

    const { data: a2 } = await admin.from('arrival_alerts')
      .select('status, final_transaction_id')
      .eq('id', alertId)
      .single();
    expect(a2!.status).toBe('RECONCILED');
    expect(a2!.final_transaction_id).toBe(body.transactionId);

    const { data: txn } = await admin.from('transactions')
      .select('document_type, related_transaction_id, tax_amount_usd')
      .eq('id', body.transactionId)
      .single();
    expect(txn!.document_type).toBe(body.documentType);
    expect(txn!.related_transaction_id).toBe(proformaId);
  });
});
