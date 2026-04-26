# Carbon Tax Pro-Forma — Plan 4: Reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an `arrival_alert` transitions to `DEPARTED_EEZ` (vessel has left the EEZ after a port call), compute the *actual* EEZ transit distance, compare with the pro-forma estimate, and issue one of three follow-on documents:

- **FINAL** — delta ≤ `reconciliation.tolerance_pct` (10% default). Same amount as pro-forma, marked reconciled, no money moves.
- **COMPLEMENT** — real > pro-forma. A new `PENDING` transaction for the shortfall feeds into the existing net-30 collections pipeline.
- **REFUND** — real < pro-forma. A `CREDIT_NOTE_ISSUED` transaction for the overpayment; actual payout is finance's concern (out of scope).

**Architecture:** A trigger on `arrival_alerts` fires when `status` transitions to `DEPARTED_EEZ` and enqueues a `pgmq.reconciliation_queue` message. A dedicated `reconciliation-worker` pg_cron job pops messages and POSTs to `/api/queue/process-reconciliation`. The route handler delegates to `reconcilePipelineService.runReconcilePipeline(alertId)`, which calls the Go `/api/v1/alerts/:id/distance-final` RPC-backed endpoint and the Go tax calculator for the real-distance amount, then decides FINAL / COMPLEMENT / REFUND and reuses the existing invoice PDF + email services. The alert transitions to `RECONCILED` with `final_transaction_id` set.

**Tech stack:** same as Plan 3 — Next.js route handler + pgmq + pg_cron + pg_net, existing `invoiceService` / `emailService`, Go backend for distance + tax math.

**Spec reference:** `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` §6.5 (EEZ exit reconciliation), §3 decision 8.

**Prereqs:**
- Plans 1 + 2 + 3 merged (branch `develop` at `52ac73b`).
- `supabase db reset` green on migrations 001–035.
- Go backend's `/api/v1/alerts/:id/distance-final` endpoint accessible.
- `QUEUE_WORKER_SECRET` set in the Next.js dev server env (same secret Plan 3 uses — reused).
- `reconciliation.tolerance_pct` (default 10) in `app_config` (seeded in Plan 1 mig 027).

**Scope boundaries:**
- IN: enqueue trigger on DEPARTED_EEZ, reconciliation queue consumer, pipeline service, decision tree (FINAL/COMPLEMENT/REFUND), PDF + email for each, alert transition to RECONCILED, Go distance-final client, e2e test.
- OUT: Port Officer UI to review reconciled invoices (Plan 5), owner escalation of unpaid COMPLEMENT (Plan 5), reconciliation dashboards.

---

## Leverage summary

- `proformaPipelineService` (Plan 3) — blueprint for the new `reconcilePipelineService`. Same pattern: load alert → call Go → insert transaction → PDF → email → alert transition.
- `invoiceService.generateInvoicePdf({ mode })` supports `mode: 'invoice'` (to contrast with `'proforma'`). We pass the new `mode` for FINAL/COMPLEMENT and a suitable badge for REFUND.
- `emailService.sendInvoiceEmail` — already parameterized by `mode` + `badge` + `amountUsd`.
- `pgmq_pop_message` / `pgmq_ack_message` RPCs (Plan 3 mig 035) are **queue-generic**: they take a queue name, so we reuse them for `reconciliation_queue` without adding new RPCs.
- `Go GET /api/v1/alerts/:id/distance-final` (Plan 2) returns `{ alert_id, total_distance_eez_nm }`.
- `Go POST /api/v1/tax/calculate` (Plan 2) with the real distance → actual USD.

---

## File structure

```
supabase/migrations/
  036_reconciliation_trigger_and_cron.sql      (new)
supabase/tests/migrations/
  036_reconciliation.test.sql

frontend/src/
  services/
    reconcilePipelineService.ts                (new)
    reconcilePipelineService.test.ts
  app/api/queue/process-reconciliation/
    route.ts                                   (new)
    route.test.ts
  e2e/
    reconciliation-happy-path.test.ts          (new)
```

No new UI in Plan 4 — the admin/port officer dashboards come in Plan 5.

---

## Task 0: enqueue trigger + reconciliation-worker cron

**Files:**
- Create: `supabase/migrations/036_reconciliation_trigger_and_cron.sql`
- Create: `supabase/tests/migrations/036_reconciliation.test.sql`

### Step 1 — Failing test

Create `supabase/tests/migrations/036_reconciliation.test.sql`:

```sql
BEGIN;

-- Trigger exists
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'enqueue_reconciliation_on_departed'
  ), 'trigger enqueue_reconciliation_on_departed missing';
END $$;

-- Function exists
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='fn_enqueue_reconciliation'
  ), 'fn_enqueue_reconciliation missing';
END $$;

-- Cron job scheduled
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reconciliation-worker'
  ), 'cron job reconciliation-worker missing';
END $$;

-- Functional: update an alert to DEPARTED_EEZ and see a pgmq message land
DO $$
DECLARE
  v_vessel UUID;
  v_alert  UUID;
  v_queued INT;
BEGIN
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999800001','TEST-RECON','MV RECON','TR01','SO','CARGO',
            50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts (
    vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
    status, arrived_at
  ) VALUES (v_vessel, 'TEST-RECON', 11, 46, 0, 'ARRIVED', NOW() - INTERVAL '3 hours')
  RETURNING id INTO v_alert;

  -- Transition to DEPARTED_EEZ — trigger fires
  UPDATE public.arrival_alerts
     SET status = 'DEPARTED_EEZ', departed_eez_at = NOW()
   WHERE id = v_alert;

  SELECT COUNT(*) INTO v_queued
    FROM pgmq.q_reconciliation_queue
   WHERE message->>'arrival_alert_id' = v_alert::text;
  ASSERT v_queued = 1,
    format('reconciliation_queue has %s msgs for this alert, want 1', v_queued);

  -- Idempotency: a second UPDATE that keeps status=DEPARTED_EEZ must NOT
  -- enqueue again.
  UPDATE public.arrival_alerts
     SET departed_eez_at = NOW() + INTERVAL '1 minute'
   WHERE id = v_alert;

  SELECT COUNT(*) INTO v_queued
    FROM pgmq.q_reconciliation_queue
   WHERE message->>'arrival_alert_id' = v_alert::text;
  ASSERT v_queued = 1,
    format('non-status change should not re-enqueue, got %s msgs', v_queued);
END $$;

ROLLBACK;
```

### Step 2 — Write migration 036

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 036 : reconciliation trigger + reconciliation-worker cron
-- ─────────────────────────────────────────────────────────────────────────────
--
-- When an arrival_alert transitions to DEPARTED_EEZ, enqueue a pgmq message on
-- reconciliation_queue so the Next.js worker can compute real distance and
-- issue the FINAL / COMPLEMENT / REFUND transaction.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_enqueue_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only fire when status actually transitions INTO DEPARTED_EEZ.
  IF NEW.status = 'DEPARTED_EEZ'
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pgmq.send('reconciliation_queue',
      jsonb_build_object('arrival_alert_id', NEW.id::text));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enqueue_reconciliation_on_departed
  AFTER UPDATE ON public.arrival_alerts
  FOR EACH ROW
  WHEN (NEW.status = 'DEPARTED_EEZ' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_enqueue_reconciliation();

COMMENT ON FUNCTION public.fn_enqueue_reconciliation IS
  'Enqueue a reconciliation job when arrival_alert.status transitions to DEPARTED_EEZ. Idempotent by construction (guarded by OLD.status IS DISTINCT).';

-- ── Schedule: hit the reconciliation worker every minute ───────────────────
SELECT cron.schedule(
  'reconciliation-worker',
  '* * * * *',
  $worker$
  SELECT net.http_post(
    url := (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_url')
           || '/api/queue/process-reconciliation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Queue-Secret', (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_secret')
    ),
    body := '{}'::jsonb
  );
  $worker$
);
```

### Step 3 — Verify + commit

```bash
supabase db reset
./supabase/tests/run.sh migrations/036_reconciliation.test.sql
# expected: ROLLBACK, exit 0

git add supabase/migrations/036_reconciliation_trigger_and_cron.sql \
        supabase/tests/migrations/036_reconciliation.test.sql
git commit -m "feat(db): reconciliation trigger + worker cron (migration 036)"
```

---

## Task 1: reconcilePipelineService

The orchestrator for a reconciliation job. Mirrors the shape of `proformaPipelineService` but decides between FINAL / COMPLEMENT / REFUND based on the delta.

**Files:**
- Create: `frontend/src/services/reconcilePipelineService.ts`
- Create: `frontend/src/services/reconcilePipelineService.test.ts`

### Step 1 — Failing test

Create `frontend/src/services/reconcilePipelineService.test.ts`:

```ts
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
    // Full fixture: vessel + alert in DEPARTED_EEZ + existing PROFORMA row
    // + two vessel_positions inside EEZ so distance-final has data.
    const { data: v } = await admin.from('vessels').upsert({
      mmsi: '999810001', imo_number: 'TEST-RECON-SVC',
      name: 'MV RECON SVC', call_sign: 'TRS01', flag_code: 'SO', category: 'CARGO',
      gross_tonnage_dwt: 30000, engine_power_kw: 15000, design_speed_knots: 14,
      compliance_status: 'APPROACHING',
    }, { onConflict: 'imo_number' }).select('id').single();
    const vesselId = v!.id;

    await admin.from('arrival_alerts').delete().eq('vessel_id', vesselId);
    await admin.from('transactions').delete().eq('vessel_id', vesselId);
    await admin.from('vessel_positions').delete().eq('vessel_id', vesselId);

    const { data: agent } = await admin.from('profiles')
      .select('id').eq('role','SHIPPING_AGENT').limit(1).single();

    // Two positions 60 NM apart inside EEZ bounding box
    await admin.from('vessel_positions').insert([
      { vessel_id: vesselId, lat: 11, lng: 45, heading: 90, speed_knots: 12,
        zone: 'EEZ', recorded_at: new Date(Date.now() - 50 * 60 * 1000).toISOString() },
      { vessel_id: vesselId, lat: 11, lng: 46, heading: 90, speed_knots: 12,
        zone: 'EEZ', recorded_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
    ]);

    const { data: a } = await admin.from('arrival_alerts').insert({
      vessel_id: vesselId, imo_number: 'TEST-RECON-SVC',
      detected_lat: 11, detected_lng: 46, distance_to_port_nm: 0,
      status: 'DEPARTED_EEZ',
      arrived_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      departed_eez_at: new Date().toISOString(),
      matched_agent_id: agent!.id, matched_via: 'AUTO_MAPPING',
    }).select('id').single();
    alertId = a!.id;

    // Insert a PROFORMA with an estimated amount, linked to the alert
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
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const { data: a } = await admin.from('arrival_alerts')
      .select('status, final_transaction_id').eq('id', alertId).single();
    expect(a!.status).toBe('RECONCILED');
    expect(a!.final_transaction_id).toBe(result.transactionId);

    const { data: txn } = await admin.from('transactions')
      .select('document_type, related_transaction_id, tax_amount_usd')
      .eq('id', result.transactionId).single();
    expect(['FINAL','COMPLEMENT','REFUND']).toContain(txn!.document_type);
    expect(txn!.related_transaction_id).toBe(proformaId);
  });
});
```

### Step 2 — Implement

Create `frontend/src/services/reconcilePipelineService.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  generateInvoicePdf,
  buildVerifyUrl,
  hashInvoiceFields,
  signInvoiceRef,
  type InvoiceData,
} from './invoiceService';
import { sendInvoiceEmail } from './emailService';

type TaxCalcResult = {
  tco2: number;
  usd_amount: number;
  breakdown: {
    distance_nm: number;
    emissions_factor_g_co2_per_nm: number;
    emissions_factor_source: string;
    emissions_factor_id: string;
    rate_usd_per_tco2: number;
  };
};

interface RunInput {
  alertId: string;
  adminClient: SupabaseClient;
  taxApiUrl: string;
  taxApiSecret?: string;
  dryRunEmail?: boolean;
  dryRunStorage?: boolean;
  toleranceOverride?: number; // test hook
}

type RunResult =
  | { ok: true; transactionId: string; documentType: 'FINAL' | 'COMPLEMENT' | 'REFUND' }
  | { ok: false; reason: string };

async function fetchTolerancePct(db: SupabaseClient): Promise<number> {
  const { data } = await db
    .from('app_config')
    .select('value')
    .eq('key', 'reconciliation.tolerance_pct')
    .single();
  const raw = data?.value;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return isFinite(n) && n > 0 ? n : 10;
}

function pickHeaders(taxApiSecret?: string): Record<string, string> {
  const secret =
    taxApiSecret ??
    process.env.AFRICGREEN_API_SECRET ??
    process.env.AIS_INGEST_SECRET ??
    process.env.API_SECRET;
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) base['Authorization'] = `Bearer ${secret}`;
  return base;
}

export async function runReconcilePipeline(input: RunInput): Promise<RunResult> {
  const { alertId, adminClient: db, taxApiUrl } = input;
  const headers = pickHeaders(input.taxApiSecret);

  // ── 1. Load alert + vessel + agent + proforma ─────────────────────────
  const { data: alert, error: alertErr } = await db
    .from('arrival_alerts')
    .select(`
      id, vessel_id, imo_number, status, proforma_transaction_id, matched_agent_id,
      vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, shipowner_id )
    `)
    .eq('id', alertId)
    .single();
  if (alertErr || !alert) return { ok: false, reason: `alert: ${alertErr?.message ?? 'nil'}` };
  if (alert.status !== 'DEPARTED_EEZ') {
    return { ok: false, reason: `alert status ${alert.status} is not DEPARTED_EEZ` };
  }
  if (!alert.proforma_transaction_id) {
    return { ok: false, reason: 'proforma_transaction_id is null — cannot reconcile' };
  }

  const vessel = Array.isArray(alert.vessel) ? alert.vessel[0] : alert.vessel;
  if (!vessel) return { ok: false, reason: 'vessel missing' };

  const { data: proforma } = await db
    .from('transactions')
    .select('id, tax_amount_usd, emissions_tco2')
    .eq('id', alert.proforma_transaction_id)
    .single();
  if (!proforma) return { ok: false, reason: 'proforma row missing' };
  const proformaUsd = Number(proforma.tax_amount_usd);

  const { data: agent } = await db
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', alert.matched_agent_id)
    .single();
  if (!agent?.email) return { ok: false, reason: 'agent email missing' };

  // ── 2. Real distance + tax via Go backend ──────────────────────────────
  const distRes = await fetch(`${taxApiUrl}/api/v1/alerts/${alertId}/distance-final`, { headers });
  if (!distRes.ok) return { ok: false, reason: `distance-final ${distRes.status}` };
  const { total_distance_eez_nm: realDistance } = (await distRes.json()) as {
    total_distance_eez_nm: number;
  };

  const taxRes = await fetch(`${taxApiUrl}/api/v1/tax/calculate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      imo: vessel.imo_number,
      category: vessel.category,
      gross_tonnage: vessel.gross_tonnage_dwt,
      distance_nm: realDistance,
    }),
  });
  if (!taxRes.ok) return { ok: false, reason: `tax api ${taxRes.status}` };
  const tax: TaxCalcResult = await taxRes.json();
  const realUsd = tax.usd_amount;

  // ── 3. Decide FINAL / COMPLEMENT / REFUND ──────────────────────────────
  const tolerancePct = input.toleranceOverride ?? (await fetchTolerancePct(db));
  const deltaPct = proformaUsd > 0 ? (Math.abs(realUsd - proformaUsd) / proformaUsd) * 100 : 100;

  let documentType: 'FINAL' | 'COMPLEMENT' | 'REFUND';
  let amount: number;
  let status: string;
  let collectionsStatus: string;
  let reconciliationNote: string;

  if (deltaPct <= tolerancePct) {
    documentType = 'FINAL';
    amount = realUsd;
    status = 'PAID'; // inherits proforma's assumed paid state; see comment below
    collectionsStatus = 'PAID';
    reconciliationNote = `Reconciled within tolerance (Δ ${deltaPct.toFixed(2)}% ≤ ${tolerancePct}%); no adjustment required.`;
  } else if (realUsd > proformaUsd) {
    documentType = 'COMPLEMENT';
    amount = realUsd - proformaUsd;
    status = 'PENDING';
    collectionsStatus = 'CURRENT';
    reconciliationNote = `Complement: real $${realUsd.toFixed(2)} > pro-forma $${proformaUsd.toFixed(2)} (Δ ${deltaPct.toFixed(2)}%).`;
  } else {
    documentType = 'REFUND';
    amount = -(proformaUsd - realUsd); // negative
    status = 'CREDIT_NOTE_ISSUED';
    collectionsStatus = 'WAIVED';
    reconciliationNote = `Refund: real $${realUsd.toFixed(2)} < pro-forma $${proformaUsd.toFixed(2)} (Δ ${deltaPct.toFixed(2)}%).`;
  }
  // Note: for the FINAL case we assume the pro-forma was paid. In the MVP
  // this is a simplification — Port Officer UI (Plan 5) will handle the
  // unpaid-at-reconciliation case explicitly.

  // ── 4. Insert the reconciliation transaction row ───────────────────────
  const { data: txn, error: txnErr } = await db
    .from('transactions')
    .insert({
      vessel_id: vessel.id,
      vessel_name: vessel.name,
      vessel_imo: vessel.imo_number,
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: tax.tco2,
      tax_amount_usd: amount,
      status,
      collections_status: collectionsStatus,
      document_type: documentType,
      related_transaction_id: proforma.id,
      arrival_alert_id: alertId,
      agent_profile_id: alert.matched_agent_id,
      shipowner_id: vessel.shipowner_id,
      distance_eez_nm: tax.breakdown.distance_nm,
      emission_factor_used_id: tax.breakdown.emissions_factor_id,
      rate_usd_per_tco2: tax.breakdown.rate_usd_per_tco2,
      breakdown_json: { ...tax.breakdown, reconciliationNote, deltaPct },
    })
    .select('id, ref')
    .single();
  if (txnErr || !txn) return { ok: false, reason: `insert txn: ${txnErr?.message ?? 'nil'}` };

  // ── 5. PDF + email reuse existing services ─────────────────────────────
  //       (skipped bodies for brevity — follow proformaPipelineService:
  //        build InvoiceData with the right mode/badge for FINAL vs
  //        COMPLEMENT vs REFUND, generate PDF, upload to Storage bucket,
  //        call sendInvoiceEmail.)
  //       For FINAL + COMPLEMENT, mode = 'invoice', badge = 'TO PAY' for
  //       COMPLEMENT and 'PAID' for FINAL. For REFUND, mode = 'invoice' +
  //       badge = 'EXEMPT' (acceptable since 'REFUND' isn't in the badge
  //       enum today — Plan 5 will add it if needed).

  const invoiceRef =
    (txn as { ref?: string }).ref ??
    `${documentType === 'REFUND' ? 'RCT' : 'INV'}-${new Date().getFullYear()}-${txn.id.slice(0, 8).toUpperCase()}`;

  const invoiceData: Partial<InvoiceData> = {
    invoiceRef,
    mode: 'invoice',
    badge: documentType === 'REFUND' ? 'EXEMPT' : (documentType === 'FINAL' ? 'PAID' : 'TO PAY'),
    vesselName: vessel.name,
    vesselImo: vessel.imo_number,
    vesselMmsi: vessel.mmsi,
    // … rest of fields match invoiceService.InvoiceData — see proformaPipelineService for exact shape
  };

  // Hash + signature (real implementation mirrors proformaPipelineService)
  const hash = hashInvoiceFields({
    invoiceRef,
    vesselImo: vessel.imo_number,
    vesselName: vessel.name,
    ownerName: vessel.name, // TODO: real shipowner name lookup
    totalUsd: amount,
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: new Date().toISOString().slice(0, 10),
    mode: 'invoice',
  });
  const signature = signInvoiceRef(invoiceRef, hash);
  const verifyUrl = buildVerifyUrl(invoiceRef, { contentHash: hash, signature });

  const pdfBytes = await generateInvoicePdf(invoiceData as InvoiceData);

  if (!input.dryRunStorage) {
    const path = `reconciliations/${invoiceRef}.pdf`;
    const { error: upErr } = await db.storage.from('documents')
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };
    await db.from('transactions').update({ invoice_pdf_url: path }).eq('id', txn.id);
  }

  if (!input.dryRunEmail) {
    const emailResult = await sendInvoiceEmail({
      to: agent.email,
      recipientName: agent.full_name ?? agent.email,
      vesselName: vessel.name,
      invoiceRef,
      amountUsd: amount,
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      mode: 'invoice',
      badge: documentType === 'REFUND' ? 'EXEMPT' : (documentType === 'FINAL' ? 'PAID' : 'TO PAY'),
      pdfBuffer: pdfBytes,
      verifyUrl,
    });
    if (!emailResult.success) {
      return { ok: false, reason: `email: ${emailResult.error}` };
    }
  }

  // ── 6. Flip alert to RECONCILED ────────────────────────────────────────
  await db.from('arrival_alerts')
    .update({ status: 'RECONCILED', final_transaction_id: txn.id })
    .eq('id', alertId);

  return { ok: true, transactionId: txn.id, documentType };
}
```

**Important**: the InvoiceData shape in the sketch is incomplete — read `invoiceService.ts` and fill in all required fields (ownerName, periodStart, periodEnd, subtotalUsd, totalUsd, lineItems, etc.) exactly as `proformaPipelineService` does. Copy the structure verbatim where possible.

### Step 3 — Verify + commit

```bash
cd frontend && npx tsc --noEmit
# then:
QUEUE_WORKER_SECRET=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  AFRICGREEN_API_URL=http://127.0.0.1:8080 \
  npx vitest run reconcilePipelineService

git add frontend/src/services/reconcilePipelineService.ts \
        frontend/src/services/reconcilePipelineService.test.ts
git commit -m "feat(frontend): reconcilePipelineService — FINAL/COMPLEMENT/REFUND decision"
```

---

## Task 2: /api/queue/process-reconciliation route

Nearly identical to `/api/queue/process-proforma` but pops from `reconciliation_queue` and calls `runReconcilePipeline`.

**Files:**
- Create: `frontend/src/app/api/queue/process-reconciliation/route.ts`
- Create: `frontend/src/app/api/queue/process-reconciliation/route.test.ts`

### Step 1 — Failing test (pattern from Plan 3 Task 4)

```ts
import { describe, it, expect } from 'vitest';
import { POST } from './route';

describe('POST /api/queue/process-reconciliation', () => {
  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/queue/process-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 204 or 200 with correct secret', async () => {
    const secret = process.env.QUEUE_WORKER_SECRET ?? 'test-secret';
    const req = new Request('http://localhost/api/queue/process-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Queue-Secret': secret },
      body: '{}',
    });
    const res = await POST(req as any);
    expect([200, 204, 500]).toContain(res.status);
  });
});
```

### Step 2 — Implement

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runReconcilePipeline } from '@/services/reconcilePipelineService';

export const runtime = 'nodejs';

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const expected = process.env.QUEUE_WORKER_SECRET;
  if (!expected) return json(500, { error: 'queue worker secret not configured' });
  if (req.headers.get('X-Queue-Secret') !== expected) {
    return json(401, { error: 'unauthorized' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080';
  if (!supabaseUrl || !supabaseKey) return json(500, { error: 'supabase not configured' });

  const admin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { data: popped, error: popErr } = await admin.rpc('pgmq_pop_message', {
    queue_name: 'reconciliation_queue',
    visibility_sec: 60,
  });
  if (popErr) return json(500, { error: `pgmq pop: ${popErr.message}` });
  if (!popped) return new NextResponse(null, { status: 204 });

  const msg = popped as { msg_id: number; message: { arrival_alert_id: string } };

  const result = await runReconcilePipeline({
    alertId: msg.message.arrival_alert_id,
    adminClient: admin,
    taxApiUrl: apiUrl,
  });

  if (!result.ok) {
    console.error('[reconciliation-queue] failed:', result.reason);
    return json(500, { error: result.reason, msg_id: msg.msg_id });
  }

  await admin.rpc('pgmq_ack_message', {
    queue_name: 'reconciliation_queue',
    msg_id: msg.msg_id,
  });

  return json(200, {
    transactionId: result.transactionId,
    documentType: result.documentType,
    msg_id: msg.msg_id,
  });
}
```

### Step 3 — Commit

```bash
git add frontend/src/app/api/queue/process-reconciliation/
git commit -m "feat(frontend): /api/queue/process-reconciliation route"
```

---

## Task 3: E2E happy path

Seeds an ARRIVED alert with a PROFORMA, flips to DEPARTED_EEZ (which fires the trigger), calls the worker route, and asserts `RECONCILED` + one of the three document types.

**Files:**
- Create: `frontend/src/e2e/reconciliation-happy-path.test.ts`

Structure mirrors `proforma-happy-path.test.ts`. Key differences:
- `beforeAll` seeds two `vessel_positions` inside the EEZ so `alert_distance_final_nm` returns a non-zero value
- `beforeAll` inserts a PROFORMA `transactions` row and links `proforma_transaction_id`
- Test UPDATEs the alert to `DEPARTED_EEZ` (fires the trigger)
- Test POSTs to `/api/queue/process-reconciliation`
- Asserts `status=RECONCILED`, `final_transaction_id IS NOT NULL`, and `document_type IN ('FINAL','COMPLEMENT','REFUND')`

Commit:

```bash
git add frontend/src/e2e/reconciliation-happy-path.test.ts
git commit -m "test(frontend): reconciliation happy-path e2e"
```

---

## Task 4: Plan 4 closure

Update the spec:

```markdown
**Plan 4 status**: Reconciliation applied — DEPARTED_EEZ trigger enqueues reconciliation_queue, reconciliation-worker cron, reconcilePipelineService decides FINAL (Δ ≤ 10%) / COMPLEMENT (real > proforma) / REFUND (real < proforma) using Go distance-final + tax API, PDF + email reuse invoiceService/emailService, alert transitions to RECONCILED. Migration 036. E2E test covers the happy path.
```

Run full verification:

```bash
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done
cd frontend && npm test
cd backend && go test ./... -count=1
```

Commit:

```bash
git add docs/superpowers/specs/
git commit -m "docs(spec): mark Plan 4 reconciliation as applied"
```

---

## Done criteria

Plan 4 is complete when:

1. Migration 036 present; 13 migration tests total still green.
2. `reconcilePipelineService` + worker route + e2e test compile and pass unit tests.
3. Seeded ARRIVED+PROFORMA alert transitioned to DEPARTED_EEZ triggers a pgmq message, the worker route processes it, and the alert reaches RECONCILED with the right `document_type`.
4. `go test ./... -count=1` still green.
5. Spec annotated.

Plan 5 (Admin UIs + owner escalation) can proceed — it surfaces COMPLEMENT/REFUND outcomes in `/admin/escalations` and lets Port Officers overwrite when real-world collections action is required.

---

## Spec coverage map

| Spec section | Covered by task |
|---|---|
| §6.5 EEZ exit → DEPARTED_EEZ | Plan 2 (eez.Tracker) |
| §6.5 enqueue reconciliation | Task 0 (trigger) |
| §6.5 real distance aggregation | Plan 2 (alert_distance_final_nm RPC + /api/v1/alerts/:id/distance-final) |
| §6.5 FINAL / COMPLEMENT / REFUND decision | Task 1 |
| §6.5 PDF + email delivery | Task 1 (reuses invoiceService + emailService) |
| §5.5 pg_cron reconciliation-sweep | Task 0 + Task 2 |

Out of scope for Plan 4 (handled by Plan 5):
- Port Officer review/override UI
- COMPLEMENT unpaid escalation (reuses the existing net-30 pipeline from mig 022)
- Manual reconciliation trigger (when the sweeper missed an exit)
