/**
 * End-to-end happy path test for the pro-forma pipeline.
 *
 * This test exercises the full cascade:
 *   DETECTED → (match_pending_alerts RPC) → MATCHED_AUTO → (worker route) → PROFORMA_SENT
 *
 * Requirements to run end-to-end (all three services must be up):
 *   1. `supabase start` — local Supabase DB with all migrations applied
 *   2. `cd backend && go run ./cmd/api` — Go tax calculator on http://127.0.0.1:8080
 *   3. `cd frontend && npm run dev` — Next.js dev server on http://127.0.0.1:3300
 *
 * The Next.js server must have `QUEUE_WORKER_SECRET` set to the same value
 * passed to this test's env (otherwise the worker route returns 401).
 *
 * Run:
 *   QUEUE_WORKER_SECRET='test-secret' \
 *   NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
 *   SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
 *   AFRICGREEN_API_URL='http://127.0.0.1:8080' \
 *     npx vitest run src/e2e/proforma-happy-path
 *
 * If creds are missing (e.g. CI without Supabase), the test self-skips.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const nextAppUrl = process.env.NEXT_APP_URL ?? 'http://127.0.0.1:3300';
const workerSecret = process.env.QUEUE_WORKER_SECRET!;

describe('Pro-forma happy path (e2e)', () => {
  if (!key || !workerSecret) {
    it.skip('creds missing', () => {});
    return;
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  let alertId: string;
  let vesselId: string;
  let ownerId: string;

  beforeAll(async () => {
    const { data: v } = await admin
      .from('vessels')
      .upsert(
        {
          mmsi: '999900001',
          imo_number: 'TEST-E2E',
          name: 'MV E2E',
          call_sign: 'TE01',
          flag_code: 'SO',
          category: 'CARGO',
          gross_tonnage_dwt: 30000,
          engine_power_kw: 15000,
          design_speed_knots: 14,
          compliance_status: 'APPROACHING',
        },
        { onConflict: 'imo_number' },
      )
      .select('id')
      .single();
    vesselId = v!.id;

    // Clean any prior alerts on this vessel so beforeAll is re-runnable
    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);

    // Upsert shipowner by name (no unique, so just insert and dedupe by capture)
    const { data: existing } = await admin
      .from('shipowners')
      .select('id')
      .eq('name', 'E2E Owner')
      .maybeSingle();
    if (existing) {
      ownerId = existing.id;
    } else {
      const { data: created } = await admin
        .from('shipowners')
        .insert({ name: 'E2E Owner', account_state: 'GHOST' })
        .select('id')
        .single();
      ownerId = created!.id;
    }

    await admin.from('vessels').update({ shipowner_id: ownerId }).eq('id', vesselId);

    const { data: agent } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'SHIPPING_AGENT')
      .limit(1)
      .single();

    // Upsert the mapping (unique on shipowner_id, agent_profile_id, valid_from)
    await admin
      .from('owner_agent_mappings')
      .upsert(
        {
          shipowner_id: ownerId,
          agent_profile_id: agent!.id,
          valid_from: new Date().toISOString().slice(0, 10),
          active: true,
        },
        { onConflict: 'shipowner_id,agent_profile_id,valid_from' },
      );

    const { data: a } = await admin
      .from('arrival_alerts')
      .insert({
        vessel_id: vesselId,
        imo_number: 'TEST-E2E',
        detected_lat: 11,
        detected_lng: 46,
        distance_to_port_nm: 480,
        estimated_route_nm: 140,
        status: 'DETECTED',
      })
      .select('id')
      .single();
    alertId = a!.id;
  });

  it('cascade transitions DETECTED → MATCHED_AUTO → PROFORMA_SENT', async () => {
    // Run the matcher synchronously
    await admin.rpc('match_pending_alerts');
    const { data: a1 } = await admin
      .from('arrival_alerts')
      .select('status')
      .eq('id', alertId)
      .single();
    expect(a1!.status).toBe('MATCHED_AUTO');

    // Trigger the worker route once
    const workerRes = await fetch(`${nextAppUrl}/api/queue/process-proforma`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Queue-Secret': workerSecret,
      },
      body: '{}',
    });
    // Expect 200 (processed successfully) — 204 means queue was empty which
    // shouldn't happen here since we just enqueued via the matcher.
    expect(workerRes.status).toBe(200);

    const { data: a2 } = await admin
      .from('arrival_alerts')
      .select('status, proforma_transaction_id')
      .eq('id', alertId)
      .single();
    expect(a2!.status).toBe('PROFORMA_SENT');
    expect(a2!.proforma_transaction_id).toBeTruthy();

    // Verify the transaction has the right shape
    const { data: txn } = await admin
      .from('transactions')
      .select('document_type, status, tax_amount_usd, shipowner_id, agent_profile_id')
      .eq('id', a2!.proforma_transaction_id)
      .single();
    expect(txn!.document_type).toBe('PROFORMA');
    expect(txn!.status).toBe('PENDING');
    expect(Number(txn!.tax_amount_usd)).toBeGreaterThan(0);
    expect(txn!.shipowner_id).toBe(ownerId);
  });
});
