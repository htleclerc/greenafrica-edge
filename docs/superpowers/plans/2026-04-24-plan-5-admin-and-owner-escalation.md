# Carbon Tax Pro-Forma — Plan 5: Admin & Owner Escalation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the MVP by giving Port Officers and Finance Admins the surfaces and scheduled jobs they need to handle the 10–20% of alerts that don't sail through the happy path: unclaimed alerts drifting past their SLA, unpaid pro-formas past day 7, and manual owner-email cascade. Also audit the existing agent self-service signup (A2) and patch it if broken.

**Architecture:** Two new `pg_cron` jobs (unclaimed-escalation every hour; unpaid-escalation daily) flip statuses and stage rows. Three new Next.js surfaces (`/admin/escalations`, `/admin/owner-agent-mappings` CRUD, `/admin/tax-settings` extension) give admins visibility and control. One new server action (`escalateToOwner`) sends the cover letter + PDF to the shipowner email with audit logging. The A2 signup audit runs as a dedicated task with its own report.

**Tech stack:** same Next.js + Supabase + Resend + existing `invoiceService` / `emailService` + Vitest — no new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` §§6.4 (escalation to Port Officer), 6.6 (owner escalation manual), 5.6 (app_config), 2 Non-goals (detention stays off), and the §13 open question on `/signup` audit.

**Prereqs:**
- Plans 1+2+3+4 merged (develop at `bd5c83e`).
- `supabase db reset` green on 001–036.
- `QUEUE_WORKER_SECRET` in Next.js dev env (Plan 3 gap — finally fix `.env.local` now).

**Scope boundaries:**
- IN: unclaimed + unpaid cron jobs, admin dashboards for escalations and agent mappings, owner escalation email + audit, tax settings extension, A2 signup audit.
- OUT: Phase 2 features (global AIS, EQUASIS scraper, shipowner portal activation) — stay behind feature flags. Detention flow — stays dormant. BI / dashboards beyond the escalation views.

---

## Leverage summary

- `emailService.sendInvoiceEmail` — already used by Plans 3+4; reused for owner cascade with a new template.
- `invoiceService.generateInvoicePdf` — reused to render the pro-forma PDF attached to the owner email.
- Existing `audit_logs` hash-chain (mig 018) — extends with new action `OWNER_CASCADE_SENT` and `ALERT_ESCALATED`.
- Existing `/admin/*` layout — follow the established pattern (see `frontend/src/app/(dashboard)/admin/...`).
- Existing `registration_requests` flow (mig 002) and `/signup` + `/api/auth/register` route (Plan 1 found at discovery time) — Task 6 audits these rather than reinventing.

---

## File structure

```
supabase/migrations/
  037_unclaimed_and_unpaid_escalation_crons.sql      (new)
supabase/tests/migrations/
  037_escalation_crons.test.sql

frontend/src/
  services/
    ownerAgentMappingService.ts                      (new)
    ownerAgentMappingService.test.ts
    escalationService.ts                             (new)
    escalationService.test.ts
    ownerCascadeEmailService.ts                      (new — renders cover letter + calls Resend)
  actions/
    createOwnerAgentMapping.ts                       (new server action)
    deactivateOwnerAgentMapping.ts                   (new server action)
    escalateToOwner.ts                               (new server action)
    escalateToOwner.test.ts
  app/(dashboard)/admin/
    escalations/
      page.tsx                                       (new)
      UnclaimedPanel.tsx                             (new)
      UnpaidPanel.tsx                                (new)
      EscalateDialog.tsx                             (new)
    owner-agent-mappings/
      page.tsx                                       (new)
      OwnerAgentMappingList.tsx                      (new)
      AddMappingForm.tsx                             (new)
    tax-settings/
      page.tsx                                       (MODIFY — add new keys section)

frontend/messages/{en,fr,ar,pt,sw}.json               (append admin.escalations + admin.mappings strings)

docs/audits/
  2026-04-24-a2-signup-audit.md                     (new — Task 6 output)
```

---

## Task 0: unclaimed + unpaid escalation crons (mig 037)

Two scheduled jobs, both SQL-only. They flip statuses and stage staging columns; actual actions happen in the Next.js server actions.

**Files:**
- Create: `supabase/migrations/037_unclaimed_and_unpaid_escalation_crons.sql`
- Create: `supabase/tests/migrations/037_escalation_crons.test.sql`

### Step 1 — Failing test

```sql
BEGIN;

-- Cron jobs present
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname='unclaimed-escalation'),
    'cron job unclaimed-escalation missing';
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname='unpaid-escalation'),
    'cron job unpaid-escalation missing';
END $$;

-- fn_escalate_unclaimed and fn_stage_unpaid_owner_escalation exist
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='fn_escalate_unclaimed'),
    'fn_escalate_unclaimed missing';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='fn_stage_unpaid_owner_escalation'),
    'fn_stage_unpaid_owner_escalation missing';
END $$;

-- Functional: unclaimed alert older than claim_sla_hours + within ETA buffer
-- must transition to ESCALATED.
DO $$
DECLARE v_vessel UUID; v_alert UUID;
BEGIN
  INSERT INTO public.vessels (mmsi, imo_number, name, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    compliance_status)
  VALUES ('999820001','TEST-ESC','MV ESC','TE01','SO','CARGO',
          50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts (
    vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
    estimated_eta, status, detected_at
  ) VALUES (v_vessel, 'TEST-ESC', 11, 46, 400,
            NOW() + INTERVAL '12 hours', -- within buffer
            'UNCLAIMED',
            NOW() - INTERVAL '48 hours' -- older than default claim_sla_hours=24
  ) RETURNING id INTO v_alert;

  PERFORM public.fn_escalate_unclaimed();

  DECLARE v_status TEXT;
  BEGIN
    SELECT status::text INTO v_status FROM public.arrival_alerts WHERE id=v_alert;
    ASSERT v_status='ESCALATED', format('status=%s, want ESCALATED', v_status);
  END;
END $$;

-- Functional: PROFORMA transaction arrived 8 days ago should get
-- owner_escalation_due_at staged.
DO $$
DECLARE v_vessel UUID; v_alert UUID; v_txn UUID; v_due TIMESTAMPTZ;
BEGIN
  INSERT INTO public.vessels (mmsi, imo_number, name, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    compliance_status)
  VALUES ('999830001','TEST-UNPAID','MV UNPAID','TU01','SO','CARGO',
          50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts (
    vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
    status, arrived_at
  ) VALUES (v_vessel, 'TEST-UNPAID', 11, 46, 0, 'ARRIVED',
            NOW() - INTERVAL '8 days')
  RETURNING id INTO v_alert;

  INSERT INTO public.transactions (
    vessel_id, vessel_name, vessel_imo, transaction_type,
    emissions_tco2, tax_amount_usd, status, collections_status,
    document_type, arrival_alert_id
  ) VALUES (v_vessel, 'MV UNPAID', 'TEST-UNPAID', 'ENTRY_TAX',
            10, 400, 'PENDING', 'CURRENT', 'PROFORMA', v_alert)
  RETURNING id INTO v_txn;

  PERFORM public.fn_stage_unpaid_owner_escalation();

  SELECT owner_escalation_due_at INTO v_due
    FROM public.transactions WHERE id=v_txn;
  ASSERT v_due IS NOT NULL,
    'transactions.owner_escalation_due_at should be staged when >= delay_days old and unpaid';
END $$;

ROLLBACK;
```

### Step 2 — Write migration 037

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037 : unclaimed-escalation + unpaid-escalation crons
-- ─────────────────────────────────────────────────────────────────────────────

-- ── fn_escalate_unclaimed: UNCLAIMED → ESCALATED after claim_sla_hours ────
CREATE OR REPLACE FUNCTION public.fn_escalate_unclaimed()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sla_h   INT;
  v_buf_h   INT;
  v_count   INT := 0;
BEGIN
  SELECT (value #>> '{}')::INT INTO v_sla_h
    FROM public.app_config WHERE key='arrival.claim_sla_hours';
  v_sla_h := COALESCE(v_sla_h, 24);

  SELECT (value #>> '{}')::INT INTO v_buf_h
    FROM public.app_config WHERE key='arrival.escalation_eta_buffer_h';
  v_buf_h := COALESCE(v_buf_h, 36);

  WITH escalated AS (
    UPDATE public.arrival_alerts
       SET status = 'ESCALATED'
     WHERE status = 'UNCLAIMED'
       AND detected_at < NOW() - (v_sla_h || ' hours')::INTERVAL
       AND (estimated_eta IS NULL OR estimated_eta < NOW() + (v_buf_h || ' hours')::INTERVAL)
     RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM escalated;
  RETURN v_count;
END;
$$;

-- ── fn_stage_unpaid_owner_escalation: stage PROFORMA rows eligible for owner cascade
CREATE OR REPLACE FUNCTION public.fn_stage_unpaid_owner_escalation()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delay_days INT;
  v_count      INT := 0;
BEGIN
  SELECT (value #>> '{}')::INT INTO v_delay_days
    FROM public.app_config WHERE key='owner_escalation.delay_days';
  v_delay_days := COALESCE(v_delay_days, 7);

  WITH staged AS (
    UPDATE public.transactions t
       SET owner_escalation_due_at = NOW()
      FROM public.arrival_alerts a
     WHERE t.arrival_alert_id = a.id
       AND t.document_type = 'PROFORMA'
       AND t.status = 'PENDING'
       AND t.owner_escalation_due_at IS NULL
       AND a.arrived_at IS NOT NULL
       AND a.arrived_at < NOW() - (v_delay_days || ' days')::INTERVAL
     RETURNING t.id
  )
  SELECT COUNT(*) INTO v_count FROM staged;
  RETURN v_count;
END;
$$;

-- ── Schedules ─────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'unclaimed-escalation',
  '0 * * * *', -- hourly
  $$SELECT public.fn_escalate_unclaimed();$$
);

SELECT cron.schedule(
  'unpaid-escalation',
  '0 6 * * *', -- daily at 06:00 UTC
  $$SELECT public.fn_stage_unpaid_owner_escalation();$$
);

COMMENT ON FUNCTION public.fn_escalate_unclaimed IS
  'Transition UNCLAIMED arrival_alerts to ESCALATED when detected_at is older than arrival.claim_sla_hours and (ETA is null or within arrival.escalation_eta_buffer_h).';
COMMENT ON FUNCTION public.fn_stage_unpaid_owner_escalation IS
  'Stage owner_escalation_due_at on unpaid PROFORMA transactions whose alert.arrived_at is older than owner_escalation.delay_days. Sets the eligibility timestamp; actual send is a manual Port Officer action.';
```

### Step 3 — Verify + commit

```bash
supabase db reset
./supabase/tests/run.sh migrations/037_escalation_crons.test.sql
# expected: ROLLBACK, exit 0

git add supabase/migrations/037_unclaimed_and_unpaid_escalation_crons.sql \
        supabase/tests/migrations/037_escalation_crons.test.sql
git commit -m "feat(db): unclaimed + unpaid escalation crons (migration 037)"
```

---

## Task 1: ownerAgentMappingService

CRUD wrapper over `owner_agent_mappings`. Admin-only via RLS (already set in Plan 1 mig 031).

**Files:**
- Create: `frontend/src/services/ownerAgentMappingService.ts`
- Create: `frontend/src/services/ownerAgentMappingService.test.ts`

### Test shape

Integration test that:
1. Creates a shipowner + picks a SHIPPING_AGENT profile
2. Calls `createMapping({shipownerId, agentId})`
3. Calls `listMappings()` — verifies the row is present, active=true
4. Calls `deactivateMapping(id)` — verifies active=false
5. Calls `listMappings({ activeOnly: true })` — verifies the deactivated row is hidden

### Exports

```ts
export interface OwnerAgentMapping {
  id: string;
  shipowner_id: string;
  shipowner_name: string; // joined
  agent_profile_id: string;
  agent_name: string;     // joined
  priority: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
}

export async function listMappings(
  db: SupabaseClient,
  opts?: { activeOnly?: boolean }
): Promise<OwnerAgentMapping[]>;

export async function createMapping(
  db: SupabaseClient,
  input: { shipownerId: string; agentProfileId: string; priority?: number; validFrom?: string; validUntil?: string | null }
): Promise<OwnerAgentMapping>;

export async function deactivateMapping(
  db: SupabaseClient,
  mappingId: string
): Promise<void>;
```

### Commit

```bash
git add frontend/src/services/ownerAgentMappingService.ts \
        frontend/src/services/ownerAgentMappingService.test.ts
git commit -m "feat(frontend): ownerAgentMappingService (CRUD)"
```

---

## Task 2: escalationService

Read-only aggregator for the `/admin/escalations` page. Two queries:
- `listUnclaimedEscalated()` — status=ESCALATED (Port Officer SLA timeout case)
- `listUnpaidProformas()` — PROFORMA PENDING with `owner_escalation_due_at IS NOT NULL AND escalated_to_owner_at IS NULL`

**Files:**
- Create: `frontend/src/services/escalationService.ts`
- Create: `frontend/src/services/escalationService.test.ts`

### Exports

```ts
export interface EscalatedAlert extends ArrivalAlertWithVessel {
  vessel: { ... };
}

export interface UnpaidProforma {
  transactionId: string;
  transactionRef: string | null;
  vesselName: string;
  vesselImo: string;
  taxAmountUsd: number;
  arrivedAt: string | null;
  ownerEscalationDueAt: string;
  shipownerId: string | null;
  shipownerOfficialEmail: string | null;
  shipownerOfficialEmailSource: 'AGENT_CLAIM' | 'PORT_OFFICER' | 'EQUASIS_VERIFIED' | null;
  agentProfileId: string | null;
  agentEmail: string | null;
}

export async function listUnclaimedEscalated(db: SupabaseClient): Promise<EscalatedAlert[]>;
export async function listUnpaidProformas(db: SupabaseClient): Promise<UnpaidProforma[]>;
```

### Commit

```bash
git add frontend/src/services/escalationService.ts \
        frontend/src/services/escalationService.test.ts
git commit -m "feat(frontend): escalationService (listUnclaimedEscalated, listUnpaidProformas)"
```

---

## Task 3: escalateToOwner server action + owner cascade email

The critical path: Port Officer picks an unpaid PROFORMA, confirms/overrides the ship owner email, clicks Send.

**Files:**
- Create: `frontend/src/services/ownerCascadeEmailService.ts`
- Create: `frontend/src/actions/escalateToOwner.ts`
- Create: `frontend/src/actions/escalateToOwner.test.ts`

### `ownerCascadeEmailService.ts` — renders cover letter + calls Resend

```ts
import { Resend } from 'resend';

export interface OwnerCascadeInput {
  toEmail: string;
  ownerName: string;
  vesselName: string;
  vesselImo: string;
  invoiceRef: string;
  amountUsd: number;
  arrivalDate: string; // ISO
  agentName: string;
  agentEmail: string;
  pdfBuffer: Uint8Array;
  locale: 'en' | 'fr';
}

export async function sendOwnerCascadeEmail(input: OwnerCascadeInput): Promise<
  | { ok: true; resendId: string }
  | { ok: false; reason: string }
>;
```

Template content (EN variant — FR is a parallel translation):

> Subject: `Unpaid carbon-tax invoice — MV {vesselName} — IMO {vesselImo}`
>
> Body:
> Dear {ownerName},
>
> Per our records, the carbon-tax invoice {invoiceRef} for vessel {vesselName} (IMO {vesselImo}, arrived {arrivalDate}) in the amount of {amountUsd} USD remains unpaid by your appointed shipping agent ({agentName}, {agentEmail}) more than 7 days after the vessel's arrival in the Somaliland EEZ.
>
> You are liable as the registered owner under Decree [REF] for any carbon-tax balance your agent fails to remit. We request payment within 30 days of this notice; otherwise the vessel may be subject to operational restrictions on its next call.
>
> The original pro-forma PDF is attached for reference. For payment instructions or to dispute this charge, reply to this email or contact compliance@africgreen.example.
>
> Regards,
> AfricGreen Carbon Tax Compliance Team

### `escalateToOwner.ts` server action

```ts
'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';
import { upsertShipownerEmail } from '@/services/shipownerService';
import { sendOwnerCascadeEmail } from '@/services/ownerCascadeEmailService';

const inputSchema = z.object({
  transactionId: z.string().uuid(),
  ownerEmail: z.string().email(),
  ownerEmailIsNew: z.boolean().optional(), // if true, source = PORT_OFFICER
  locale: z.enum(['en', 'fr']).default('en'),
});

export async function escalateToOwner(raw: unknown): Promise<
  | { ok: true; resendId: string }
  | { ok: false; reason: string }
> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid' };
  const { transactionId, ownerEmail, ownerEmailIsNew, locale } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, reason: 'not authenticated' };

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
  if (!profile || !['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN'].includes(profile.role)) {
    return { ok: false, reason: 'insufficient role' };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) return { ok: false, reason: 'service role not configured' };
  const admin = createServiceRole(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 1. Load transaction + alert + vessel + shipowner + agent
  const { data: txn } = await admin.from('transactions').select(`
    id, ref, tax_amount_usd, shipowner_id, agent_profile_id, arrival_alert_id,
    vessel:vessels (name, imo_number),
    alert:arrival_alerts (arrived_at),
    agent:profiles!transactions_agent_profile_id_fkey (full_name, email),
    shipowner:shipowners (name)
  `).eq('id', transactionId).single();
  if (!txn) return { ok: false, reason: 'transaction not found' };

  // 2. Upsert owner email if new
  if (ownerEmailIsNew && txn.shipowner_id) {
    await upsertShipownerEmail(admin, txn.shipowner_id, ownerEmail, 'PORT_OFFICER');
  }

  // 3. Download the PDF from Storage
  //    (transactions.invoice_pdf_url stores the path). If null, regenerate
  //    via invoiceService on the fly — keep it simple for MVP: require
  //    invoice_pdf_url to be set, reject otherwise.
  const { data: txnRefresh } = await admin.from('transactions')
    .select('invoice_pdf_url').eq('id', transactionId).single();
  if (!txnRefresh?.invoice_pdf_url) return { ok: false, reason: 'no PDF stored — regenerate first' };
  const { data: pdfBlob, error: dlErr } = await admin.storage.from('documents')
    .download(txnRefresh.invoice_pdf_url);
  if (dlErr || !pdfBlob) return { ok: false, reason: `download: ${dlErr?.message ?? 'nil'}` };
  const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());

  // 4. Send email
  const vessel = Array.isArray(txn.vessel) ? txn.vessel[0] : txn.vessel;
  const alert = Array.isArray(txn.alert) ? txn.alert[0] : txn.alert;
  const agent = Array.isArray(txn.agent) ? txn.agent[0] : txn.agent;
  const owner = Array.isArray(txn.shipowner) ? txn.shipowner[0] : txn.shipowner;

  const emailResult = await sendOwnerCascadeEmail({
    toEmail: ownerEmail,
    ownerName: owner?.name ?? 'Registered Owner',
    vesselName: vessel?.name ?? 'Unknown',
    vesselImo: vessel?.imo_number ?? '',
    invoiceRef: txn.ref ?? transactionId,
    amountUsd: Number(txn.tax_amount_usd),
    arrivalDate: alert?.arrived_at ?? new Date().toISOString(),
    agentName: agent?.full_name ?? agent?.email ?? '',
    agentEmail: agent?.email ?? '',
    pdfBuffer,
    locale,
  });

  if (!emailResult.ok) return emailResult;

  // 5. Stamp the transaction + audit log
  await admin.from('transactions').update({
    escalated_to_owner_at: new Date().toISOString(),
    escalated_to_owner_email: ownerEmail,
    escalated_by: auth.user.id,
  }).eq('id', transactionId);

  // Audit log entry is written via the tamper-chain service (existing in repo)
  // — if this isn't automatic from a trigger, import the audit helper and call it.

  return { ok: true, resendId: emailResult.resendId };
}
```

### Commit

```bash
git add frontend/src/services/ownerCascadeEmailService.ts \
        frontend/src/actions/escalateToOwner.ts \
        frontend/src/actions/escalateToOwner.test.ts
git commit -m "feat(frontend): escalateToOwner action + owner cascade email (EN/FR)"
```

---

## Task 4: /admin/escalations page

Two tabs: "Unclaimed (Port Officer review)" and "Unpaid 7d+ (owner cascade)".

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/escalations/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/escalations/UnclaimedPanel.tsx`
- Create: `frontend/src/app/(dashboard)/admin/escalations/UnpaidPanel.tsx`
- Create: `frontend/src/app/(dashboard)/admin/escalations/EscalateDialog.tsx`

### Page

Server component that:
1. Checks auth + role (PORT_OFFICER/FINANCE_ADMIN/SUPERADMIN; otherwise redirect to `/dashboard`)
2. Calls both `listUnclaimedEscalated()` and `listUnpaidProformas()`
3. Renders `<OsTabs>` with the two panels

### UnclaimedPanel

Table of ESCALATED alerts with a dropdown of known agents (listed via `ownerAgentMappingService.listMappings` filtered by shipowner) + "Assign" button that calls a new server action `assignAgentToAlert`. If no mapping candidate, dropdown lists all SHIPPING_AGENT profiles.

### UnpaidPanel

Table of unpaid PROFORMAS with columns: vessel, ref, amount, arrived_at, days_overdue, shipowner email + source, actions. Actions:
- "Remind agent" — triggers the existing net-30 reminder (reuse)
- "Escalate to owner" — opens `EscalateDialog`

### EscalateDialog

Same Radix Dialog pattern as Plan 3 Task 6. Fields:
- Owner email (pre-filled from `shipownerService.official_email`; editable — if edited, source becomes PORT_OFFICER)
- Locale radio (EN / FR)
- Confirm button → calls `escalateToOwner`

### i18n

Append to `messages/{en,fr,ar,pt,sw}.json` under the new `Admin.Escalations` namespace (follow existing naming conventions — Task 6 of Plan 3 used `IncomingVessels`, so use `AdminEscalations`).

### Commit

```bash
git add frontend/src/app/\(dashboard\)/admin/escalations/ frontend/messages/
git commit -m "feat(frontend): /admin/escalations page (unclaimed + unpaid) + EscalateDialog"
```

---

## Task 5: /admin/owner-agent-mappings CRUD page

Admin-only page that lists all mappings and lets admins add new ones or deactivate existing.

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/owner-agent-mappings/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/owner-agent-mappings/OwnerAgentMappingList.tsx`
- Create: `frontend/src/app/(dashboard)/admin/owner-agent-mappings/AddMappingForm.tsx`

Pattern follows `/admin/escalations` — server component + client list + form component. Uses `createMapping` / `deactivateMapping` server actions (Task 1 service wrapped in 2 Server Actions: `createOwnerAgentMapping.ts` and `deactivateOwnerAgentMapping.ts`).

Include a "shipowner" combobox with search (shipowners can be many); for MVP a plain select of all `shipowners` ordered by name is acceptable.

Commit:

```bash
git add frontend/src/app/\(dashboard\)/admin/owner-agent-mappings/ \
        frontend/src/actions/createOwnerAgentMapping.ts \
        frontend/src/actions/deactivateOwnerAgentMapping.ts \
        frontend/messages/
git commit -m "feat(frontend): /admin/owner-agent-mappings CRUD page"
```

---

## Task 6: /admin/tax-settings extension

Read the existing `frontend/src/app/(dashboard)/admin/tax-settings/page.tsx` (Plan 1 mentioned this surface exists in the spec). Add a new section for the Plan 3+4 keys. Preserve everything already there.

Keys to surface (all from `app_config`, existing — see Plan 1 mig 027 and Plan 3 mig 035):
- `carbon_tax.rate_usd_per_tco2`
- `arrival.corridor_radius_nm`
- `arrival.claim_sla_hours`
- `arrival.escalation_eta_buffer_h`
- `reconciliation.tolerance_pct`
- `reconciliation.check_interval_min`
- `owner_escalation.delay_days`
- `owner_escalation.reminder_count`
- `proforma.languages_default`
- `feature.ais_global_enabled` / `feature.equasis_scraper_enabled` / `feature.vessel_detention_enabled` / `feature.shipowner_portal_enabled`
- `queue.worker_url` / `queue.worker_secret` (SUPERADMIN only — masked display for the secret)

For each: label, current value, editable input (unless admin role is insufficient), a "Save" button that server-action updates `app_config`.

Only SUPERADMIN can edit. PORT_OFFICER/FINANCE_ADMIN see read-only values.

### Commit

```bash
git add frontend/src/app/\(dashboard\)/admin/tax-settings/ \
        frontend/src/actions/updateAppConfig.ts
git commit -m "feat(frontend): /admin/tax-settings extended with Plan 3+4 keys + feature flags"
```

---

## Task 7: audit /signup (A2) for SHIPPING_AGENT

This is a **discovery task** — not a code task. Output is a written audit in `docs/audits/2026-04-24-a2-signup-audit.md`, plus whichever bug fixes it surfaces (if any).

**Steps:**
1. Read `frontend/src/app/(auth)/signup/page.tsx` and `frontend/src/app/api/auth/register/route.ts` end-to-end.
2. Verify the `SHIPPING_AGENT` role path: can a shipping agent sign up? Does the registration go into `registration_requests` with `requested_role='SHIPPING_AGENT'`?
3. Verify the admin approval path (should exist in an edge function — Plan 1 discovered `supabase/functions/approve-registration`): does approval create a `profiles` row with role='SHIPPING_AGENT'?
4. Attempt a full signup flow end-to-end locally: submit the form as a new agent, approve via admin, log in. Document each step's outcome.
5. Identify broken / missing steps.
6. Write the audit as:
   - Overview
   - Each checked step with ✅ / ❌ and evidence
   - List of fixes needed (ordered by priority)
   - Small fixes applied in this task (if any were trivial — e.g., obvious broken redirects, missing i18n keys)
   - Deferred fixes (need their own tasks in a later plan)

**Output file:** `docs/audits/2026-04-24-a2-signup-audit.md`

### Commit

```bash
git add docs/audits/2026-04-24-a2-signup-audit.md frontend/src/... (if fixes applied)
git commit -m "docs(audit): A2 self-service signup for SHIPPING_AGENT (+ fixes if trivial)"
```

---

## Task 8: Plan 5 closure

Run the full verification matrix:

```bash
cd backend && go test ./... -count=1 && cd ..
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done
cd frontend && npm test && npx tsc --noEmit
```

Annotate the spec:

```markdown
**Plan 5 status**: Admin + owner escalation applied — unclaimed-escalation + unpaid-escalation crons (migration 037), /admin/escalations (Unclaimed + Unpaid 7d+ panels), /admin/owner-agent-mappings CRUD, escalateToOwner action + Resend cover letter (EN/FR), /admin/tax-settings extended. A2 signup audit delivered in docs/audits/2026-04-24-a2-signup-audit.md.
```

Commit:

```bash
git add docs/superpowers/specs/
git commit -m "docs(spec): mark Plan 5 admin + owner escalation as applied"
```

Merge to develop.

---

## Done criteria

Plan 5 is complete when:

1. Migration 037 green, 14 migration tests total.
2. All new services + actions have passing Vitest tests.
3. `/admin/escalations`, `/admin/owner-agent-mappings`, `/admin/tax-settings` render and accept interactions.
4. Escalation happy path — a staged unpaid PROFORMA can be escalated to the owner with owner-email override → Resend email succeeds (dry-run OK for MVP) → transaction stamps `escalated_to_owner_at` + `escalated_to_owner_email` + `escalated_by`.
5. A2 audit document exists; any trivial fixes from the audit are committed separately.
6. Spec annotated.
7. Branch merged to develop.

**After Plan 5**, the MVP is feature-complete per the spec §§2 Goals. Phase 2 items stay behind feature flags until a later project cycle.

---

## Spec coverage map

| Spec section | Covered by task |
|---|---|
| §6.4 agent SLA → Port Officer escalation | Task 0 (unclaimed-escalation cron) + Task 4 (UnclaimedPanel) |
| §6.4 Port Officer assigns ESCALATED to an agent | Task 4 (UnclaimedPanel + assignAgentToAlert action) |
| §6.6 unpaid 7d staging | Task 0 (unpaid-escalation cron) |
| §6.6 owner cascade email with cover letter | Task 3 (escalateToOwner + ownerCascadeEmailService) |
| §6.6 trust-ordered email override | Task 3 (reuses Plan 3 shipownerService.upsertShipownerEmail) |
| Admin CRUD owner_agent_mappings | Task 5 |
| /admin/tax-settings new keys | Task 6 |
| A2 signup audit | Task 7 |
| Post-MVP dormant features (detention, shipowner portal invite) | OUT of scope — stay behind feature flags |

**Out of scope (future work):**
- Phase 2 global AIS (feature-flagged)
- Phase 2 EQUASIS scraper (feature-flagged)
- Post-MVP detention workflow (feature-flagged)
- COMPLEMENT unpaid escalation — reuses the existing net-30 pipeline from mig 022 (no new work)
- Production observability dashboards (later project cycle)
