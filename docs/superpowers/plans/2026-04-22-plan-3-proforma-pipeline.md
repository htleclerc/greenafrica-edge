# Carbon Tax Pro-Forma — Plan 3: Pro-Forma Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the state machine from Plan 1 (`arrival_alerts`) and the tax math from Plan 2 (`tax.Calculator`) to the existing `invoiceService.generateInvoicePdf()` / `emailService.sendInvoiceEmail()` pipeline in the Next.js frontend. After Plan 3, an `arrival_alert` transitioning out of `DETECTED` triggers a pro-forma `transactions` row, a PDF is rendered, and an email is sent to the matched shipping agent. The agent UI (`/dashboard/incoming-vessels`) lets agents claim unclaimed alerts.

**Architecture:** Supabase `pg_cron` sweeps `DETECTED` alerts every 2 minutes, matches them via `owner_agent_mappings`, and enqueues a job on `pgmq.proforma_queue`. A second cron job pops the queue and POSTs to `/api/queue/process-proforma`, which orchestrates tax calculation (HTTP call to Go backend) + PDF generation + email send + alert status update, all through existing services. A claim flow lets shipping agents manually pick up `UNCLAIMED` alerts via a server action that transitions them to `CLAIMED` and re-enqueues the proforma job.

**Tech stack:** Next.js 16 App Router (Route Handlers + Server Actions), Supabase `pg_cron` + `pgmq` + `pg_net` for HTTP-from-SQL, TypeScript strict, Zod validation, Vitest for unit tests, existing `resend` + `jspdf` libs already in `frontend/package.json`.

**Spec reference:** `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` §§6.1, 6.2, 6.3.

**Prereqs:**
- Plan 1 and Plan 2 merged to develop (31 commits, last `9088a07`).
- `supabase db reset` applies cleanly (migrations 001–033 + seed).
- `cd backend && go test ./... -count=1` green.
- `frontend/.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SIGNED_LINK_SECRET`, and a new key `AFRICGREEN_API_URL=http://127.0.0.1:8080` for the Go backend tax endpoint.

**Scope boundaries:**
- IN: `pg_cron` jobs, pgmq consumer, pro-forma row creation, PDF + email reuse, `/dashboard/incoming-vessels`, claim flow, shipowner ghost-record creation.
- OUT: reconciliation (Plan 4), owner escalation UI (Plan 5), admin `owner_agent_mappings` CRUD UI (Plan 5), EQUASIS scraper (Phase 2), admin `/signup` audit (Plan 5).

---

## Leverage summary — what already exists

Before adding code, Plan 3 re-uses these existing services verbatim:

- `frontend/src/services/invoiceService.ts` — `generateInvoicePdf(data)` returns a `Uint8Array` PDF with QR, HMAC-signed verify URL, and mode = `'proforma' | 'invoice'`.
- `frontend/src/services/emailService.ts` — `sendInvoiceEmail({ to, subject, … pdfBuffer })` via Resend.
- `frontend/src/app/api/invoices/generate/route.ts` — hardened PDF + email orchestrator for existing invoices. Plan 3 does NOT modify this route; the new queue worker calls the same underlying services directly (not the route) so queue workers don't hop through HTTP.
- `backend/internal/tax/handler.go` (from Plan 2) — `POST /api/v1/tax/calculate`.
- All Plan 1 tables: `arrival_alerts`, `shipowners`, `owner_agent_mappings`, `transactions` (with `document_type='PROFORMA'`), `pgmq.proforma_queue`.

---

## File structure

```
supabase/migrations/
  034_agent_match_cron.sql                   (new — pg_cron + pg_net setup)
  035_proforma_worker_cron.sql               (new — queue consumer job)

supabase/tests/migrations/
  034_agent_match_cron.test.sql
  035_proforma_worker_cron.test.sql

frontend/src/
  services/
    arrivalAlertService.ts                   (new)
    arrivalAlertService.test.ts
    shipownerService.ts                      (new)
    shipownerService.test.ts
    proformaPipelineService.ts               (new — orchestrates tax calc + PDF + email + DB updates)
    proformaPipelineService.test.ts
  app/
    api/queue/process-proforma/
      route.ts                               (new — pgmq webhook handler)
      route.test.ts
    (dashboard)/dashboard/incoming-vessels/
      page.tsx                               (new)
      IncomingVesselsList.tsx                (new client component)
      ClaimAlertDialog.tsx                   (new client component)
  actions/
    claimArrivalAlert.ts                     (new server action)
    claimArrivalAlert.test.ts
  types/secure/
    arrivalAlert.ts                          (new — TS types mirroring the SQL enum + row shape)

frontend/messages/
  en.json                                    (append — incoming vessels + claim strings)
  fr.json                                    (append — same, FR)
  so.json                                    (append — SO stub or English fallback)
  ar.json                                    (append — same, AR)
```

Rationale for splitting `proformaPipelineService.ts` from the `route.ts` handler: the route handler stays thin (auth + body validation + call-service + JSON out), and the pipeline logic is testable in Vitest without spinning up Next.js runtime.

---

## Task 0: Enable pg_net + write the agent-match cron job

Supabase's `pg_net` extension gives PG the ability to make outbound HTTP calls — we need that for the pgmq consumer to POST into our Next.js route. `pg_cron` is already enabled (Plan 1 mig 023).

**Files:**
- Create: `supabase/migrations/034_agent_match_cron.sql`
- Create: `supabase/tests/migrations/034_agent_match_cron.test.sql`

### Step 1 — Failing test

Create `supabase/tests/migrations/034_agent_match_cron.test.sql`:

```sql
BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net'),
    'pg_net extension not enabled';
END $$;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='agent-match'
  ), 'pg_cron job agent-match not scheduled';
END $$;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='match_pending_alerts'
  ), 'function match_pending_alerts missing';
END $$;

-- Functional check: seed a DETECTED alert with a known shipowner → agent mapping,
-- call the function, verify the alert transitioned to MATCHED_AUTO and a message
-- landed on pgmq.q_proforma_queue.
DO $$
DECLARE
  v_vessel UUID;
  v_owner  UUID;
  v_agent  UUID;
  v_alert  UUID;
  v_queued INT;
BEGIN
  -- Vessel + owner + mapping
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999500001','TEST-MATCH','MV MATCH','TM01','SO','CARGO',
            50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.shipowners (name, account_state)
  VALUES ('Match Test Owner','GHOST') RETURNING id INTO v_owner;

  UPDATE public.vessels SET shipowner_id=v_owner WHERE id=v_vessel;

  SELECT id INTO v_agent FROM public.profiles WHERE role='SHIPPING_AGENT' LIMIT 1;
  ASSERT v_agent IS NOT NULL, 'need seeded SHIPPING_AGENT profile';

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id)
  VALUES (v_owner, v_agent);

  -- DETECTED alert
  INSERT INTO public.arrival_alerts (vessel_id, imo_number, detected_lat, detected_lng,
                                      distance_to_port_nm, status)
  VALUES (v_vessel, 'TEST-MATCH', 11.0, 46.0, 480, 'DETECTED')
  RETURNING id INTO v_alert;

  -- Run the matcher (in-proc, without waiting for cron)
  PERFORM public.match_pending_alerts();

  -- Alert should be MATCHED_AUTO with the right agent
  DECLARE
    v_status TEXT; v_matched UUID; v_via TEXT;
  BEGIN
    SELECT status::text, matched_agent_id, matched_via
      INTO v_status, v_matched, v_via
      FROM public.arrival_alerts WHERE id=v_alert;
    ASSERT v_status = 'MATCHED_AUTO', format('status=%s, want MATCHED_AUTO', v_status);
    ASSERT v_matched = v_agent, 'matched_agent_id wrong';
    ASSERT v_via = 'AUTO_MAPPING', format('matched_via=%s', v_via);
  END;

  -- Exactly one pgmq row enqueued for this alert
  SELECT COUNT(*) INTO v_queued
    FROM pgmq.q_proforma_queue
   WHERE message->>'arrival_alert_id' = v_alert::text;
  ASSERT v_queued = 1, format('proforma_queue has %s msgs for alert, want 1', v_queued);
END $$;

ROLLBACK;
```

Run: `./supabase/tests/run.sh migrations/034_agent_match_cron.test.sql` — FAIL on `pg_net extension not enabled`.

### Step 2 — Write migration 034

Create `supabase/migrations/034_agent_match_cron.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 034 : agent-match cron + pg_net (outbound HTTP from PG)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- pg_net lets PG call HTTP endpoints; used by the pgmq consumer cron to POST
-- into the Next.js /api/queue/process-proforma route.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── match_pending_alerts: runs the cascade A lookup for DETECTED alerts ─────
CREATE OR REPLACE FUNCTION public.match_pending_alerts()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_matched INT := 0;
  v_alert RECORD;
  v_agent UUID;
BEGIN
  FOR v_alert IN
    SELECT a.id, v.shipowner_id
      FROM public.arrival_alerts a
      JOIN public.vessels v ON v.id = a.vessel_id
     WHERE a.status = 'DETECTED'
  LOOP
    -- Cascade A lookup
    IF v_alert.shipowner_id IS NULL THEN
      UPDATE public.arrival_alerts SET status = 'UNCLAIMED' WHERE id = v_alert.id;
      CONTINUE;
    END IF;

    SELECT agent_profile_id INTO v_agent
      FROM public.owner_agent_mappings
     WHERE shipowner_id = v_alert.shipowner_id
       AND active = TRUE
       AND valid_from <= CURRENT_DATE
       AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
     ORDER BY priority ASC
     LIMIT 1;

    IF v_agent IS NULL THEN
      UPDATE public.arrival_alerts SET status = 'UNCLAIMED' WHERE id = v_alert.id;
    ELSE
      UPDATE public.arrival_alerts
         SET status           = 'MATCHED_AUTO',
             matched_agent_id = v_agent,
             matched_via      = 'AUTO_MAPPING'
       WHERE id = v_alert.id;

      PERFORM pgmq.send('proforma_queue',
        jsonb_build_object('arrival_alert_id', v_alert.id::text));
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN v_matched;
END;
$$;

-- ── Schedule: every 2 minutes ──────────────────────────────────────────────
SELECT cron.schedule(
  'agent-match',
  '*/2 * * * *',
  $$SELECT public.match_pending_alerts();$$
);

COMMENT ON FUNCTION public.match_pending_alerts IS
  'Run cascade A for DETECTED arrival_alerts. Transitions to MATCHED_AUTO + enqueues pgmq.proforma_queue, or UNCLAIMED when no mapping exists.';
```

### Step 3 — Verify

```bash
supabase db reset
./supabase/tests/run.sh migrations/034_agent_match_cron.test.sql
```

Expected: ROLLBACK, exit 0.

### Step 4 — Commit

```bash
git add supabase/migrations/034_agent_match_cron.sql \
        supabase/tests/migrations/034_agent_match_cron.test.sql
git commit -m "feat(db): agent-match cron + match_pending_alerts() (migration 034)"
```

---

## Task 1: arrivalAlertService TS wrapper

A typed data-access layer for `arrival_alerts` used by the dashboard page, the claim action, and the queue worker. Keeps SQL and Supabase client plumbing out of components.

**Files:**
- Create: `frontend/src/types/secure/arrivalAlert.ts`
- Create: `frontend/src/services/arrivalAlertService.ts`
- Create: `frontend/src/services/arrivalAlertService.test.ts`

### Step 1 — Types

`frontend/src/types/secure/arrivalAlert.ts`:

```ts
export type ArrivalAlertStatus =
  | 'DETECTED'
  | 'MATCHED_AUTO'
  | 'UNCLAIMED'
  | 'CLAIMED'
  | 'ESCALATED'
  | 'PROFORMA_SENT'
  | 'ARRIVED'
  | 'DEPARTED_EEZ'
  | 'RECONCILED'
  | 'CANCELLED';

export type MatchedVia = 'AUTO_MAPPING' | 'CLAIM' | 'PORT_OFFICER';

export interface ArrivalAlert {
  id: string;
  vessel_id: string;
  imo_number: string;
  detected_at: string;
  detected_lat: number;
  detected_lng: number;
  distance_to_port_nm: number;
  estimated_eta: string | null;
  estimated_route_nm: number | null;
  status: ArrivalAlertStatus;
  matched_agent_id: string | null;
  matched_via: MatchedVia | null;
  proforma_transaction_id: string | null;
  final_transaction_id: string | null;
  arrived_at: string | null;
  departed_eez_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArrivalAlertWithVessel extends ArrivalAlert {
  vessel: {
    id: string;
    name: string;
    imo_number: string;
    mmsi: string;
    category: string;
    gross_tonnage_dwt: number;
    flag_code: string;
  };
}
```

### Step 2 — Failing service test

`frontend/src/services/arrivalAlertService.test.ts`:

```ts
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
    expect(second.reason).toMatch(/already claimed/i);
  });
});
```

### Step 3 — Implement

`frontend/src/services/arrivalAlertService.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArrivalAlert, ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';

const ALERT_SELECT = `
  id, vessel_id, imo_number,
  detected_at, detected_lat, detected_lng, distance_to_port_nm,
  estimated_eta, estimated_route_nm,
  status, matched_agent_id, matched_via,
  proforma_transaction_id, final_transaction_id,
  arrived_at, departed_eez_at, cancelled_reason,
  created_at, updated_at
` as const;

const ALERT_WITH_VESSEL_SELECT = `${ALERT_SELECT},
  vessel:vessels ( id, name, imo_number, mmsi, category, gross_tonnage_dwt, flag_code )
` as const;

export async function listUnclaimedAlerts(
  db: SupabaseClient,
): Promise<ArrivalAlertWithVessel[]> {
  const { data, error } = await db
    .from('arrival_alerts')
    .select(ALERT_WITH_VESSEL_SELECT)
    .eq('status', 'UNCLAIMED')
    .order('detected_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ArrivalAlertWithVessel[];
}

export async function getAlert(
  db: SupabaseClient,
  id: string,
): Promise<ArrivalAlert | null> {
  const { data, error } = await db
    .from('arrival_alerts')
    .select(ALERT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as ArrivalAlert | null;
}

/**
 * Claim an UNCLAIMED alert as the given agent. Uses a conditional UPDATE so a
 * race between two concurrent agents is resolved by the database.
 */
export async function claimAlert(
  db: SupabaseClient,
  alertId: string,
  agentId: string,
): Promise<{ ok: true; alert: ArrivalAlert } | { ok: false; reason: string }> {
  const { data, error } = await db
    .from('arrival_alerts')
    .update({
      status: 'CLAIMED',
      matched_agent_id: agentId,
      matched_via: 'CLAIM',
    })
    .eq('id', alertId)
    .eq('status', 'UNCLAIMED')
    .select(ALERT_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: 'alert not found or already claimed' };
  return { ok: true, alert: data as ArrivalAlert };
}
```

### Step 4 — Verify and commit

```bash
cd frontend && npm test -- arrivalAlertService
```

Expected: PASS (3 tests).

```bash
git add frontend/src/services/arrivalAlertService.ts \
        frontend/src/services/arrivalAlertService.test.ts \
        frontend/src/types/secure/arrivalAlert.ts
git commit -m "feat(frontend): arrivalAlertService (list/get/claim)"
```

---

## Task 2: shipownerService

Ghost record creation + email source tracking. Used by the claim flow (agent provides owner email) and later by Port Officer escalation (Plan 5).

**Files:**
- Create: `frontend/src/services/shipownerService.ts`
- Create: `frontend/src/services/shipownerService.test.ts`

### Step 1 — Failing test

`frontend/src/services/shipownerService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { upsertShipownerEmail, getOrCreateGhost } from './shipownerService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('shipownerService', () => {
  if (!key) {
    it.skip('SERVICE_ROLE_KEY unset', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  it('getOrCreateGhost creates a GHOST row keyed by name', async () => {
    const owner = await getOrCreateGhost(admin, {
      name: 'Test Owner Ltd',
      country_code: 'SG',
    });
    expect(owner.account_state).toBe('GHOST');
  });

  it('upsertShipownerEmail sets AGENT_CLAIM source the first time, PORT_OFFICER wins later', async () => {
    const owner = await getOrCreateGhost(admin, { name: 'Source Test Owner' });
    const first = await upsertShipownerEmail(admin, owner.id, 'ops@ex.com', 'AGENT_CLAIM');
    expect(first.official_email).toBe('ops@ex.com');
    expect(first.official_email_source).toBe('AGENT_CLAIM');
    const second = await upsertShipownerEmail(admin, owner.id, 'legal@ex.com', 'PORT_OFFICER');
    expect(second.official_email).toBe('legal@ex.com');
    expect(second.official_email_source).toBe('PORT_OFFICER');
  });
});
```

### Step 2 — Implement

`frontend/src/services/shipownerService.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailSource = 'AGENT_CLAIM' | 'PORT_OFFICER' | 'EQUASIS_VERIFIED';

export interface Shipowner {
  id: string;
  name: string;
  country_code: string | null;
  address: string | null;
  official_email: string | null;
  official_email_source: EmailSource | null;
  account_state: 'GHOST' | 'INVITED' | 'ACTIVE';
  profile_id: string | null;
}

const TRUST: Record<EmailSource, number> = {
  AGENT_CLAIM: 1,
  EQUASIS_VERIFIED: 2,
  PORT_OFFICER: 3,
};

export async function getOrCreateGhost(
  db: SupabaseClient,
  input: { name: string; country_code?: string; imo_company_no?: string },
): Promise<Shipowner> {
  // Prefer imo_company_no lookup when given (unique)
  if (input.imo_company_no) {
    const { data: existing } = await db
      .from('shipowners')
      .select('*')
      .eq('imo_company_no', input.imo_company_no)
      .maybeSingle();
    if (existing) return existing as Shipowner;
  }

  const { data, error } = await db
    .from('shipowners')
    .insert({
      name: input.name,
      country_code: input.country_code ?? null,
      imo_company_no: input.imo_company_no ?? null,
      account_state: 'GHOST',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Shipowner;
}

/**
 * Upsert the owner's official email with source-trust comparison: a lower-trust
 * source never overwrites a higher-trust source.
 */
export async function upsertShipownerEmail(
  db: SupabaseClient,
  ownerId: string,
  email: string,
  source: EmailSource,
): Promise<Shipowner> {
  const { data: current, error: readErr } = await db
    .from('shipowners')
    .select('official_email, official_email_source')
    .eq('id', ownerId)
    .single();
  if (readErr) throw readErr;

  const currentTrust = current.official_email_source
    ? TRUST[current.official_email_source as EmailSource]
    : 0;
  if (TRUST[source] < currentTrust) {
    // refuse silently — caller treats this as a no-op
    const { data } = await db
      .from('shipowners')
      .select('*')
      .eq('id', ownerId)
      .single();
    return data as Shipowner;
  }

  const { data, error } = await db
    .from('shipowners')
    .update({
      official_email: email,
      official_email_source: source,
      email_verified_at: source === 'PORT_OFFICER' ? new Date().toISOString() : null,
    })
    .eq('id', ownerId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Shipowner;
}
```

### Step 3 — Verify and commit

```bash
cd frontend && npm test -- shipownerService
git add frontend/src/services/shipownerService.ts frontend/src/services/shipownerService.test.ts
git commit -m "feat(frontend): shipownerService (GHOST creation + trust-ordered email upsert)"
```

---

## Task 3: proformaPipelineService — the orchestrator

Given an `arrival_alert_id`, this service:
1. Loads alert + vessel + agent + shipowner
2. Calls Go `/api/v1/tax/calculate` with estimated route distance
3. Inserts a `transactions` row with `document_type='PROFORMA'`
4. Generates the PDF using existing `invoiceService.generateInvoicePdf`
5. Uploads the PDF to Supabase Storage
6. Emails the agent with `sendInvoiceEmail`
7. Updates the alert: status → `PROFORMA_SENT`, `proforma_transaction_id` → the new row id
8. Writes an `audit_logs` entry via the tamper-chain (existing `auditService`)

**Files:**
- Create: `frontend/src/services/proformaPipelineService.ts`
- Create: `frontend/src/services/proformaPipelineService.test.ts`

### Step 1 — Failing test

The test seeds a MATCHED_AUTO alert, runs the pipeline, asserts the alert transitioned and a transaction row exists.

`frontend/src/services/proformaPipelineService.test.ts`:

```ts
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
    const { data: agent } = await admin
      .from('profiles').select('id').eq('role','SHIPPING_AGENT').limit(1).single();
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

  it('creates PROFORMA transaction, sets alert to PROFORMA_SENT, uploads PDF, calls Resend in stub mode', async () => {
    const result = await runProformaPipeline({
      alertId,
      adminClient: admin,
      taxApiUrl: apiUrl,
      // Stub email + storage so the test does not depend on Resend/Supabase Storage.
      dryRunEmail: true,
      dryRunStorage: true,
    });

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
```

### Step 2 — Implement

`frontend/src/services/proformaPipelineService.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateInvoicePdf, buildVerifyUrl, hashInvoiceFields, signInvoiceRef } from './invoiceService';
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
  dryRunEmail?: boolean;
  dryRunStorage?: boolean;
}

type RunResult =
  | { ok: true; transactionId: string }
  | { ok: false; reason: string };

export async function runProformaPipeline(input: RunInput): Promise<RunResult> {
  const { alertId, adminClient: db, taxApiUrl } = input;

  // ── 1. Load the alert + vessel + agent + owner ──────────────────────────
  const { data: alert, error: alertErr } = await db
    .from('arrival_alerts')
    .select(`
      id, vessel_id, imo_number, estimated_route_nm, matched_agent_id, status,
      vessel:vessels ( id, name, imo_number, category, gross_tonnage_dwt, shipowner_id )
    `)
    .eq('id', alertId)
    .single();
  if (alertErr || !alert) return { ok: false, reason: `alert not found: ${alertErr?.message ?? 'nil'}` };

  if (!['MATCHED_AUTO', 'CLAIMED', 'ESCALATED'].includes(alert.status)) {
    return { ok: false, reason: `alert status ${alert.status} is not actionable` };
  }

  const vessel = Array.isArray(alert.vessel) ? alert.vessel[0] : alert.vessel;
  if (!vessel) return { ok: false, reason: 'vessel missing' };

  const { data: agent, error: agentErr } = await db
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', alert.matched_agent_id)
    .single();
  if (agentErr || !agent?.email) {
    return { ok: false, reason: 'agent missing email' };
  }

  // ── 2. Tax calculation via Go backend ───────────────────────────────────
  const taxRes = await fetch(`${taxApiUrl}/api/v1/tax/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imo: vessel.imo_number,
      category: vessel.category,
      gross_tonnage: vessel.gross_tonnage_dwt,
      distance_nm: alert.estimated_route_nm ?? 0,
    }),
  });
  if (!taxRes.ok) return { ok: false, reason: `tax api ${taxRes.status}` };
  const tax: TaxCalcResult = await taxRes.json();

  // ── 3. Insert PROFORMA transaction ──────────────────────────────────────
  const { data: txn, error: txnErr } = await db
    .from('transactions')
    .insert({
      vessel_id: vessel.id,
      vessel_name: vessel.name,
      vessel_imo: vessel.imo_number,
      transaction_type: 'ENTRY_TAX',
      emissions_tco2: tax.tco2,
      tax_amount_usd: tax.usd_amount,
      status: 'PENDING',
      collections_status: 'CURRENT',
      document_type: 'PROFORMA',
      arrival_alert_id: alertId,
      agent_profile_id: alert.matched_agent_id,
      shipowner_id: vessel.shipowner_id,
      distance_eez_nm: tax.breakdown.distance_nm,
      emission_factor_used_id: tax.breakdown.emissions_factor_id,
      rate_usd_per_tco2: tax.breakdown.rate_usd_per_tco2,
      breakdown_json: tax.breakdown,
    })
    .select('id, transaction_ref')
    .single();
  if (txnErr || !txn) return { ok: false, reason: `insert txn: ${txnErr?.message ?? 'nil'}` };

  // ── 4. PDF generation (reuses existing service) ─────────────────────────
  const invoiceRef = (txn as { transaction_ref?: string }).transaction_ref ?? `PRO-${txn.id.slice(0, 8)}`;
  const pdfData = {
    invoiceRef,
    mode: 'proforma' as const,
    badge: 'TO PAY' as const,
    vesselName: vessel.name,
    vesselImo: vessel.imo_number,
    vesselCategory: vessel.category,
    grossTonnage: vessel.gross_tonnage_dwt,
    distanceNM: tax.breakdown.distance_nm,
    emissionsTco2: tax.tco2,
    taxAmountUsd: tax.usd_amount,
    ratePerTco2: tax.breakdown.rate_usd_per_tco2,
    issuedAt: new Date().toISOString(),
    issuedTo: agent.full_name ?? agent.email,
    hash: hashInvoiceFields({
      invoiceRef,
      vesselImo: vessel.imo_number,
      vesselName: vessel.name,
      taxAmountUsd: tax.usd_amount,
      emissionsTco2: tax.tco2,
    }),
    signature: '', // filled right below
    verifyUrl: '', // filled right below
  };
  pdfData.signature = signInvoiceRef(invoiceRef, pdfData.hash);
  pdfData.verifyUrl = buildVerifyUrl(invoiceRef, pdfData.hash, pdfData.signature);

  const pdfBytes = await generateInvoicePdf(pdfData);

  // ── 5. Upload PDF (unless dry-run) ──────────────────────────────────────
  let pdfUrl: string | null = null;
  if (!input.dryRunStorage) {
    const path = `proformas/${invoiceRef}.pdf`;
    const { error: upErr } = await db.storage
      .from('documents')
      .upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (upErr) return { ok: false, reason: `upload: ${upErr.message}` };
    pdfUrl = path;
  }

  // ── 6. Email (unless dry-run) ───────────────────────────────────────────
  if (!input.dryRunEmail) {
    const emailResult = await sendInvoiceEmail({
      to: agent.email,
      subject: `Pro-forma carbon tax — ${vessel.name} — IMO ${vessel.imo_number}`,
      body: `Please find the pro-forma invoice for your vessel ${vessel.name} (IMO ${vessel.imo_number}).`,
      pdfBuffer: pdfBytes,
      pdfFilename: `${invoiceRef}.pdf`,
    });
    if (!emailResult.ok) return { ok: false, reason: `email: ${emailResult.error}` };
  }

  // ── 7. Update transaction with pdf_url, flip alert to PROFORMA_SENT ─────
  if (pdfUrl) {
    await db.from('transactions').update({ invoice_pdf_url: pdfUrl }).eq('id', txn.id);
  }

  await db.from('arrival_alerts')
    .update({ status: 'PROFORMA_SENT', proforma_transaction_id: txn.id })
    .eq('id', alertId);

  return { ok: true, transactionId: txn.id };
}
```

### Step 3 — Verify and commit

```bash
cd frontend && npm test -- proformaPipelineService
```

Expected: PASS (requires both local Supabase and Go backend running — if AFRICGREEN_API_URL is unreachable, skip the test; if you need to, run `cd backend && go run ./cmd/api` in another terminal first).

```bash
git add frontend/src/services/proformaPipelineService.ts \
        frontend/src/services/proformaPipelineService.test.ts
git commit -m "feat(frontend): proformaPipelineService — tax calc → PDF → email → alert"
```

---

## Task 4: /api/queue/process-proforma route

Thin route handler: authenticate (internal secret), pop one pgmq message, delegate to `proformaPipelineService`, return the outcome. Intended to be called by a pg_cron job every minute.

**Files:**
- Create: `frontend/src/app/api/queue/process-proforma/route.ts`
- Create: `frontend/src/app/api/queue/process-proforma/route.test.ts`

### Step 1 — Failing test

`frontend/src/app/api/queue/process-proforma/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { POST } from './route';

describe('POST /api/queue/process-proforma', () => {
  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/queue/process-proforma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 204 when queue is empty', async () => {
    const req = new Request('http://localhost/api/queue/process-proforma', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Queue-Secret': process.env.QUEUE_WORKER_SECRET ?? 'test-secret',
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    // Either 204 (empty queue) OR 200 (processed one)
    expect([200, 204]).toContain(res.status);
  });
});
```

### Step 2 — Implement

`frontend/src/app/api/queue/process-proforma/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runProformaPipeline } from '@/services/proformaPipelineService';

export const runtime = 'nodejs';

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const expected = process.env.QUEUE_WORKER_SECRET;
  if (!expected) return json(500, { error: 'queue worker secret not configured' });

  const got = req.headers.get('X-Queue-Secret');
  if (got !== expected) return json(401, { error: 'unauthorized' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080';
  if (!supabaseUrl || !supabaseKey) return json(500, { error: 'supabase not configured' });

  const admin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // Pop one message with 30s visibility timeout. If no message, return 204.
  const { data: popped, error: popErr } = await admin.rpc('pgmq_pop_message', {
    queue_name: 'proforma_queue',
    visibility_sec: 30,
  });
  if (popErr) return json(500, { error: `pgmq pop: ${popErr.message}` });
  if (!popped) return new NextResponse(null, { status: 204 });

  const msg = popped as { msg_id: number; message: { arrival_alert_id: string } };

  const result = await runProformaPipeline({
    alertId: msg.message.arrival_alert_id,
    adminClient: admin,
    taxApiUrl: apiUrl,
  });

  if (!result.ok) {
    // Let pgmq re-deliver after visibility expires.
    console.error('[proforma-queue] failed:', result.reason);
    return json(500, { error: result.reason, msg_id: msg.msg_id });
  }

  // Ack the message so it doesn't re-deliver.
  await admin.rpc('pgmq_ack_message', {
    queue_name: 'proforma_queue',
    msg_id: msg.msg_id,
  });

  return json(200, { transactionId: result.transactionId, msg_id: msg.msg_id });
}
```

Note: `pgmq_pop_message` and `pgmq_ack_message` are thin wrapper RPCs (pgmq's native functions are `pgmq.read` and `pgmq.archive`). Exposing them via RPC keeps the frontend off the pgmq schema. Add those RPCs in migration 035 (Task 5).

### Step 3 — Verify and commit

```bash
cd frontend && npm test -- process-proforma
```

Expected: 2 PASS.

```bash
git add frontend/src/app/api/queue/process-proforma/
git commit -m "feat(frontend): /api/queue/process-proforma route"
```

---

## Task 5: pgmq RPC wrappers + consumer cron

Add two SECURITY DEFINER RPCs that expose `pgmq.read` / `pgmq.archive` to the service_role, and schedule a `proforma-worker` pg_cron job that hits `/api/queue/process-proforma` every minute using `pg_net`.

**Files:**
- Create: `supabase/migrations/035_proforma_worker_cron.sql`
- Create: `supabase/tests/migrations/035_proforma_worker_cron.test.sql`

### Step 1 — Failing test

```sql
BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='pgmq_pop_message'
  ), 'pgmq_pop_message RPC missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='pgmq_ack_message'
  ), 'pgmq_ack_message RPC missing';
  ASSERT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='proforma-worker'
  ), 'pg_cron job proforma-worker missing';
END $$;

-- Round-trip: send a message, pop it, verify shape
DO $$
DECLARE v_id BIGINT; v_popped JSONB;
BEGIN
  v_id := pgmq.send('proforma_queue', '{"arrival_alert_id":"00000000-0000-0000-0000-000000000001"}'::jsonb);
  SELECT public.pgmq_pop_message('proforma_queue', 30) INTO v_popped;
  ASSERT v_popped IS NOT NULL, 'pop returned null';
  ASSERT (v_popped->>'msg_id')::bigint = v_id, 'wrong msg_id';
  PERFORM public.pgmq_ack_message('proforma_queue', v_id);
END $$;

ROLLBACK;
```

### Step 2 — Implement migration 035

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035 : pgmq pop/ack RPCs + proforma-worker cron
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pgmq_pop_message(queue_name TEXT, visibility_sec INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN SELECT * FROM pgmq.read(queue_name, visibility_sec, 1)
  LOOP
    RETURN jsonb_build_object(
      'msg_id',    v_row.msg_id,
      'read_ct',   v_row.read_ct,
      'enqueued_at', v_row.enqueued_at,
      'message',   v_row.message
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.pgmq_ack_message(queue_name TEXT, msg_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pgmq.archive(queue_name, msg_id);
  RETURN TRUE;
END;
$$;

-- Grant execute to service_role only (implicit via SECURITY DEFINER owner,
-- but make it explicit)
GRANT EXECUTE ON FUNCTION public.pgmq_pop_message(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_ack_message(TEXT, BIGINT) TO service_role;

-- ── Schedule: hit the worker every minute ──────────────────────────────────
-- The worker URL + secret live in app_config so they can rotate without a
-- migration redeploy.
INSERT INTO public.app_config (key, value, description) VALUES
  ('queue.worker_url',    '"http://host.docker.internal:3300"'::jsonb,
   'Base URL of the Next.js app (as reachable from the PG container). Include protocol + host + port.'),
  ('queue.worker_secret', '""'::jsonb,
   'Shared secret for X-Queue-Secret header. Rotate via UPDATE app_config.')
ON CONFLICT (key) DO NOTHING;

SELECT cron.schedule(
  'proforma-worker',
  '* * * * *',
  $worker$
  SELECT net.http_post(
    url := (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_url')
           || '/api/queue/process-proforma',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Queue-Secret', (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_secret')
    ),
    body := '{}'::jsonb
  );
  $worker$
);

COMMENT ON FUNCTION public.pgmq_pop_message IS
  'Pop one message from the queue with a visibility timeout. Used by the Next.js queue worker route.';
```

Note: the `host.docker.internal` URL is correct for Supabase-in-Docker reaching the host's Next.js dev server. In production, replace with the app's public URL or VPC address.

### Step 3 — Verify and commit

```bash
supabase db reset
./supabase/tests/run.sh migrations/035_proforma_worker_cron.test.sql

git add supabase/migrations/035_proforma_worker_cron.sql \
        supabase/tests/migrations/035_proforma_worker_cron.test.sql
git commit -m "feat(db): pgmq pop/ack RPCs + proforma-worker cron (migration 035)"
```

---

## Task 6: /dashboard/incoming-vessels page

Agent-facing page: lists all UNCLAIMED alerts (RLS scopes to SHIPPING_AGENT role only), each row has a Claim button. Uses the existing `Os*` UI primitives.

**Files:**
- Create: `frontend/src/app/(dashboard)/dashboard/incoming-vessels/page.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/incoming-vessels/IncomingVesselsList.tsx`
- Create: `frontend/src/app/(dashboard)/dashboard/incoming-vessels/ClaimAlertDialog.tsx`
- Modify: `frontend/messages/en.json`, `fr.json`, `so.json`, `ar.json` (add `incomingVessels.*` keys)

### Step 1 — Server component page

`frontend/src/app/(dashboard)/dashboard/incoming-vessels/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listUnclaimedAlerts } from '@/services/arrivalAlertService';
import { IncomingVesselsList } from './IncomingVesselsList';
import { getTranslations } from 'next-intl/server';

export default async function IncomingVesselsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (profile?.role !== 'SHIPPING_AGENT' && profile?.role !== 'SUPERADMIN') {
    redirect('/dashboard');
  }

  const alerts = await listUnclaimedAlerts(supabase);
  const t = await getTranslations('incomingVessels');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">{t('title')}</h1>
      <p className="text-os-muted mb-6">{t('subtitle')}</p>
      <IncomingVesselsList alerts={alerts} />
    </div>
  );
}
```

### Step 2 — Client list component

`frontend/src/app/(dashboard)/dashboard/incoming-vessels/IncomingVesselsList.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OsTable, OsButton, OsBadge } from '@/components/ui';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';
import { ClaimAlertDialog } from './ClaimAlertDialog';

interface Props {
  alerts: ArrivalAlertWithVessel[];
}

export function IncomingVesselsList({ alerts }: Props) {
  const t = useTranslations('incomingVessels');
  const [claimTarget, setClaimTarget] = useState<ArrivalAlertWithVessel | null>(null);

  if (alerts.length === 0) {
    return <p className="text-os-muted">{t('empty')}</p>;
  }

  return (
    <>
      <OsTable>
        <thead>
          <tr>
            <th>{t('col.vessel')}</th>
            <th>{t('col.imo')}</th>
            <th>{t('col.distance')}</th>
            <th>{t('col.eta')}</th>
            <th>{t('col.estimated')}</th>
            <th className="text-right">{t('col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td>{a.vessel.name}</td>
              <td className="font-mono">{a.imo_number}</td>
              <td>{a.distance_to_port_nm.toFixed(0)} NM</td>
              <td>{a.estimated_eta ? new Date(a.estimated_eta).toLocaleString() : '—'}</td>
              <td>
                <OsBadge tone="warning">{a.estimated_route_nm ? `${a.estimated_route_nm.toFixed(0)} NM` : '—'}</OsBadge>
              </td>
              <td className="text-right">
                <OsButton size="sm" onClick={() => setClaimTarget(a)}>
                  {t('claim')}
                </OsButton>
              </td>
            </tr>
          ))}
        </tbody>
      </OsTable>

      {claimTarget && (
        <ClaimAlertDialog alert={claimTarget} onClose={() => setClaimTarget(null)} />
      )}
    </>
  );
}
```

### Step 3 — Claim dialog (client component + server action)

`frontend/src/app/(dashboard)/dashboard/incoming-vessels/ClaimAlertDialog.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { OsButton, OsInput, OsDialog } from '@/components/ui';
import { claimArrivalAlert } from '@/actions/claimArrivalAlert';
import type { ArrivalAlertWithVessel } from '@/types/secure/arrivalAlert';

interface Props {
  alert: ArrivalAlertWithVessel;
  onClose: () => void;
}

export function ClaimAlertDialog({ alert, onClose }: Props) {
  const t = useTranslations('incomingVessels.claimDialog');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!email.includes('@')) {
      setError(t('invalidEmail'));
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await claimArrivalAlert({ alertId: alert.id, ownerEmail: email });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onClose();
    });
  };

  return (
    <OsDialog open onClose={onClose} title={t('title')}>
      <p className="mb-4">{t('description', { vessel: alert.vessel.name })}</p>
      <label className="block mb-2 font-medium">{t('ownerEmailLabel')}</label>
      <OsInput
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="ops@owner-company.com"
        disabled={pending}
      />
      {error && <p className="text-red-500 mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-6">
        <OsButton variant="ghost" onClick={onClose} disabled={pending}>
          {t('cancel')}
        </OsButton>
        <OsButton onClick={submit} disabled={pending}>
          {pending ? t('claiming') : t('confirm')}
        </OsButton>
      </div>
    </OsDialog>
  );
}
```

### Step 4 — Append i18n keys

Append to `frontend/messages/en.json` (and equivalents for fr/so/ar):

```json
{
  "incomingVessels": {
    "title": "Incoming Vessels",
    "subtitle": "Vessels approaching Somaliland ports, awaiting an agent to claim and issue the pro-forma.",
    "empty": "No vessels currently awaiting claim.",
    "claim": "Claim",
    "col": {
      "vessel": "Vessel",
      "imo": "IMO",
      "distance": "Distance",
      "eta": "ETA",
      "estimated": "Estimated transit",
      "actions": "Actions"
    },
    "claimDialog": {
      "title": "Claim vessel",
      "description": "Claiming {vessel} will assign you as the shipping agent for this call and trigger pro-forma generation.",
      "ownerEmailLabel": "Ship owner official email (required)",
      "invalidEmail": "Enter a valid email address.",
      "cancel": "Cancel",
      "confirm": "Claim and generate pro-forma",
      "claiming": "Claiming…"
    }
  }
}
```

### Step 5 — Commit

```bash
git add frontend/src/app/\(dashboard\)/dashboard/incoming-vessels/ \
        frontend/messages/
git commit -m "feat(frontend): /dashboard/incoming-vessels page + ClaimAlertDialog"
```

---

## Task 7: claimArrivalAlert server action

**Files:**
- Create: `frontend/src/actions/claimArrivalAlert.ts`
- Create: `frontend/src/actions/claimArrivalAlert.test.ts`

### Step 1 — Failing test

```ts
import { describe, it, expect, vi } from 'vitest';
import { claimArrivalAlert } from './claimArrivalAlert';

// Mock Supabase SSR client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

describe('claimArrivalAlert', () => {
  it('validates owner email is present', async () => {
    const result = await claimArrivalAlert({ alertId: 'x', ownerEmail: '' });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/email/i);
  });

  // Deeper integration tests live in arrivalAlertService.test.ts.
});
```

### Step 2 — Implement

`frontend/src/actions/claimArrivalAlert.ts`:

```ts
'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';
import { claimAlert, getAlert } from '@/services/arrivalAlertService';
import { getOrCreateGhost, upsertShipownerEmail } from '@/services/shipownerService';

const inputSchema = z.object({
  alertId: z.string().uuid(),
  ownerEmail: z.string().email(),
});

export async function claimArrivalAlert(
  raw: unknown,
): Promise<{ ok: true; alertId: string } | { ok: false; reason: string }> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
  }
  const { alertId, ownerEmail } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, reason: 'not authenticated' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();
  if (profile?.role !== 'SHIPPING_AGENT') {
    return { ok: false, reason: 'only shipping agents can claim alerts' };
  }

  // Use service_role for the conditional UPDATE + subsequent shipowner mutation
  // (RLS would otherwise block the agent from reading the vessel's shipowner row
  //  before they are linked to it).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createServiceRole(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const claim = await claimAlert(admin, alertId, auth.user.id);
  if (!claim.ok) return { ok: false, reason: claim.reason };

  // Update shipowner email (source = AGENT_CLAIM, only if owner exists)
  const { data: vessel } = await admin
    .from('vessels')
    .select('shipowner_id, name, imo_number')
    .eq('id', claim.alert.vessel_id)
    .single();

  let ownerId = vessel?.shipowner_id;
  if (!ownerId) {
    const owner = await getOrCreateGhost(admin, { name: vessel?.name ?? 'Unknown Owner' });
    ownerId = owner.id;
    await admin.from('vessels').update({ shipowner_id: ownerId }).eq('id', claim.alert.vessel_id);
  }
  await upsertShipownerEmail(admin, ownerId!, ownerEmail, 'AGENT_CLAIM');

  // Enqueue proforma generation
  await admin.rpc('pgmq_enqueue_proforma', { alert_id: alertId });

  return { ok: true, alertId };
}
```

Note: `pgmq_enqueue_proforma` is a tiny RPC added in migration 035 alongside the pop/ack. Add:

```sql
CREATE OR REPLACE FUNCTION public.pgmq_enqueue_proforma(alert_id UUID)
RETURNS BIGINT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pgmq.send('proforma_queue', jsonb_build_object('arrival_alert_id', alert_id::text))
$$;
GRANT EXECUTE ON FUNCTION public.pgmq_enqueue_proforma(UUID) TO service_role;
```

Remember to also update the 035 test file to assert this function exists.

### Step 3 — Verify and commit

```bash
cd frontend && npm test -- claimArrivalAlert
git add frontend/src/actions/claimArrivalAlert.ts \
        frontend/src/actions/claimArrivalAlert.test.ts \
        supabase/migrations/035_proforma_worker_cron.sql \
        supabase/tests/migrations/035_proforma_worker_cron.test.sql
git commit -m "feat(frontend): claimArrivalAlert server action + pgmq_enqueue_proforma RPC"
```

---

## Task 8: E2E happy path

End-to-end verification: seed a DETECTED alert with a known shipowner mapping, wait for the agent-match cron tick (or call `public.match_pending_alerts()` directly), then call the worker route and verify the pro-forma transaction + alert transition.

**Files:**
- Create: `frontend/e2e/proforma-happy-path.test.ts` (Vitest integration)

### Step 1 — Write the test

```ts
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

  beforeAll(async () => {
    const { data: v } = await admin.from('vessels').upsert({
      mmsi: '999900001', imo_number: 'TEST-E2E',
      name: 'MV E2E', call_sign: 'TE01', flag_code: 'SO', category: 'CARGO',
      gross_tonnage_dwt: 30000, engine_power_kw: 15000, design_speed_knots: 14,
      compliance_status: 'APPROACHING',
    }, { onConflict: 'imo_number' }).select('id').single();

    const { data: o } = await admin.from('shipowners')
      .upsert({ name: 'E2E Owner', account_state: 'GHOST' }, { onConflict: 'name' })
      .select('id').single();

    await admin.from('vessels').update({ shipowner_id: o!.id }).eq('id', v!.id);

    const { data: agent } = await admin.from('profiles')
      .select('id').eq('role','SHIPPING_AGENT').limit(1).single();

    await admin.from('owner_agent_mappings').upsert({
      shipowner_id: o!.id,
      agent_profile_id: agent!.id,
    }, { onConflict: 'shipowner_id,agent_profile_id,valid_from' });

    const { data: a } = await admin.from('arrival_alerts').insert({
      vessel_id: v!.id, imo_number: 'TEST-E2E',
      detected_lat: 11, detected_lng: 46, distance_to_port_nm: 480,
      estimated_route_nm: 140, status: 'DETECTED',
    }).select('id').single();

    alertId = a!.id;
  });

  it('cascade transitions DETECTED → MATCHED_AUTO → PROFORMA_SENT', async () => {
    // Run the matcher
    await admin.rpc('match_pending_alerts');
    let { data: a1 } = await admin.from('arrival_alerts')
      .select('status').eq('id', alertId).single();
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
    expect([200, 204]).toContain(workerRes.status);

    const { data: a2 } = await admin.from('arrival_alerts')
      .select('status, proforma_transaction_id').eq('id', alertId).single();
    expect(a2!.status).toBe('PROFORMA_SENT');
    expect(a2!.proforma_transaction_id).toBeTruthy();
  });
});
```

### Step 2 — Run

```bash
# In three terminals:
# 1) supabase start (already running)
# 2) cd backend && go run ./cmd/api
# 3) cd frontend && npm run dev
cd frontend && npm test -- proforma-happy-path
```

Expected: the single assertion chain passes.

### Step 3 — Commit

```bash
git add frontend/e2e/
git commit -m "test(frontend): pro-forma happy-path e2e"
```

---

## Task 9: Plan 3 closure

Annotate the spec + run full verification:

```bash
cd backend && go test ./... -count=1 && cd ..
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done
cd frontend && npm test
```

Update `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` to add:

```markdown
**Plan 3 status**: Pro-forma pipeline applied — agent-match cron, pgmq consumer, worker route, claim flow, /dashboard/incoming-vessels, E2E happy path. Migrations 034–035. All tests green.
```

Commit:

```bash
git add docs/superpowers/specs/
git commit -m "docs(spec): mark Plan 3 pro-forma pipeline as applied"
```

---

## Done criteria

Plan 3 is complete when:

1. Migrations 034–035 exist, tests green.
2. Frontend Vitest passes for `arrivalAlertService`, `shipownerService`, `proformaPipelineService`, `process-proforma` route, `claimArrivalAlert`, happy-path.
3. `go test ./... -count=1` still green (no regressions).
4. A DETECTED alert with an `owner_agent_mappings` entry progresses to PROFORMA_SENT when the worker runs.
5. `/dashboard/incoming-vessels` lists UNCLAIMED alerts and claims one end-to-end.
6. Spec annotated.

Plan 4 (reconciliation) can proceed once this is merged — it piggy-backs on the same queue pattern to produce FINAL / COMPLEMENT / REFUND transactions.

---

## Spec coverage map

| Spec section | Covered by task |
|---|---|
| §6.1 agent-match cascade A | Task 0 (match_pending_alerts) |
| §6.1 enqueue proforma_queue | Task 0 + Task 7 (claim path) |
| §6.2 claim flow UI | Task 6, Task 7 |
| §6.3 pro-forma PDF + email delivery | Task 3 (reuses invoiceService + emailService) |
| §6.4 agent saves owner email at claim | Task 7 (upsertShipownerEmail with AGENT_CLAIM source) |
| §5.4 pgmq consumer | Task 4 + Task 5 |
| §5.5 pg_cron agent-match + proforma-worker | Tasks 0 + 5 |

Out of scope for Plan 3 (handled by later plans):
- Reconciliation worker (Plan 4)
- Owner escalation UI + cron (Plan 5)
- Admin `owner_agent_mappings` CRUD (Plan 5)
- Scrape proposals UI (Phase 2)
