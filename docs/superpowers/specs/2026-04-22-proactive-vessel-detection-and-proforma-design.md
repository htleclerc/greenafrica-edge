# Proactive Vessel Detection & Pro-Forma Invoicing — Design Spec

**Date**: 2026-04-22
**Status**: Draft — pending user validation
**Plan 1 status**: Schema foundation applied — migrations 023–031 present, all migration tests green.
**Schema terminology note**: The billing table in the existing schema is named `transactions` (migration 003). Throughout this spec we use "transaction" for the DB entity and "invoice / pro-forma" for the user-facing document. They refer to the same row — the `document_type` column distinguishes PROFORMA / FINAL / COMPLEMENT / REFUND. Do not confuse with the existing `transaction_type` enum (ENTRY_TAX / TRANSIT_FEE / PORT_STAY), which represents the kind of maritime charge.
**Owner**: AfricGreen platform team
**Related migrations**: builds on 001–022
**Scope**: MVP feature for automated carbon tax pro-forma delivered before vessel arrival, with reconciliation after EEZ exit and manual cascade to shipowner on unpaid balance.

---

## 1. Context & Problem

AfricGreen collects a sovereign carbon tax on vessels transiting the Somaliland EEZ (ports of Berbera and Zeila). The legal rate per the decree is **40 USD per tonne of CO₂ emitted inside the EEZ**.

Today, invoicing happens reactively — after arrival. We want to **invoice proactively**:

1. Detect incoming vessels before they arrive (earliest reasonable signal).
2. Persist the vessel record and manifest-level data if missing.
3. Create accounts for relevant parties (local agent, ship owner) if missing.
4. Issue a **pro-forma invoice** to the local shipping agent before arrival.
5. Reconcile against actual EEZ-transit distance after the vessel leaves.
6. Escalate to the registered owner (ship owner) when the local agent fails to pay after a grace period.

The project already has:

- Go backend (`backend/`) ingesting AIS positions from `aisstream.io`, with `eez.Detector` (point-in-polygon) and `tax.Handler` (calculation endpoint).
- Supabase schema (migrations 001–022) covering vessels, vessel_positions, invoices, net30 collections, audit log with tamper resistance, registration requests (self-service agent signup), profiles with RBAC.
- Next.js 16 / React 19 frontend on port 3300 with i18n (en/fr/so/ar), OsBadge/OsCard/OsTable design primitives, `/dashboard/invoices` with per-vessel filter + CSV export.
- EU MRV cache table (mig 010) for emissions data lookup by IMO.

The gap is the **proactive pipeline**: corridor detection, IMO→agent matching, pro-forma generation and delivery, reconciliation, and owner escalation.

---

## 2. Goals & Non-Goals

### Goals (MVP)

- Detect a vessel entering a 500 NM "approach corridor" around destination port and create an `arrival_alert` record.
- Automatically match the vessel to a known local shipping agent via a shipowner→agent mapping, or fall back to portal self-claim by any authorized local agent, or fall back to Port Officer manual assignment.
- Generate a pro-forma PDF invoice in EN/FR/AR, email it to the matched agent via Resend, and make it viewable on the portal.
- Track the vessel throughout the EEZ. Upon EEZ exit, compute actual transit distance and issue a final invoice (or a complement/refund when the delta is above a configurable tolerance).
- Support manual escalation to the registered owner 7 days after arrival when the pro-forma remains unpaid.
- Keep the local agent pool under admin control (~10–30 known entities). Allow self-service signup (existing `/signup` flow) with admin approval.

### Non-Goals (MVP)

- Global AIS coverage / detection at origin port departure (feature-flagged for Phase 2).
- EQUASIS scraping for owner email discovery (feature-flagged for Phase 2, always human-validated before use).
- Automatic detention of the vessel on its next call (feature-flagged post-MVP).
- Automated invitation of ship owners to the portal without human review (Phase 2, behind `feature.shipowner_portal_enabled`).
- Real-time AIS broadcasting from AfricGreen (we consume, we do not rebroadcast).
- Integration with port operational systems (post-MVP).

---

## 3. Decisions Summary (macro)

| # | Question | Decision |
|---|---|---|
| 1 | Pro-forma recipient | Local shipping agent; manual cascade to ship owner on unpaid |
| 2 | Detection trigger | B (approach corridor 500 NM) + C (ENOAD / Notice of Arrival). Scenario A (departure from origin port, global AIS) is Phase 2 behind `feature.ais_global_enabled` |
| 3 | Tax formula | `tax_USD = distance_EEZ_NM × emissions_factor_g_CO2_per_NM × 1e-6 × 40` |
| 4 | IMO → agent matching | Cascade: auto via `owner_agent_mappings` → portal self-claim → Port Officer manual |
| 5 | Agent account creation | A1 admin-managed (pre-registered) + A2 existing self-service `/signup` (audit & make functional) |
| 6 | Ship owner account | B2 preferred (magic-link invite) when email known, otherwise B1 (ghost record) |
| 7 | Ship owner email sourcing | D (agent provides at claim) + C (Port Officer enters on escalation) + A (EQUASIS scraper, Phase 2, always human-validated) |
| 8 | Estimation tolerance | Pro-forma = indicative estimate; final invoice after EEZ exit; no adjustment if delta ≤ 10%, otherwise COMPLEMENT or REFUND |
| 9 | Delivery | PDF + portal link + view tracking, via Resend, EN/FR/AR |
| + | Owner escalation delay | 7 days post-arrival if pro-forma unpaid |
| + | Vessel detention | Post-MVP (feature flag dormant) |

---

## 4. Architecture

```
                         aisstream.io (WebSocket)
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ GO BACKEND (backend/, long-running on Fly.io or VPS)                │
│                                                                      │
│  internal/ais/ingester.go     ─ WS consumer → vessel_positions      │
│  internal/eez/detector.go     ─ point-in-polygon zone classifier    │
│  internal/corridor/watcher.go ─ NEW: 500 NM approach detector       │
│  internal/reconcile/tracker.go─ NEW: EEZ exit detector + distance   │
│  internal/tax/calculator.go   ─ extended: emissions-factor cascade  │
│  cmd/api/main.go              ─ HTTP endpoints (existing + new)     │
└───────────┬─────────────────────────────────────────────────────────┘
            │ REST / PostgREST inserts
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ SUPABASE (Postgres + Auth + Storage + pgmq + pg_cron)               │
│                                                                      │
│  Data tables         arrival_alerts, shipowners, owner_agent_maps,  │
│                      emission_factors, equasis_scrape_proposals,    │
│                      extended: invoices, vessels                    │
│  Queues (pgmq)       proforma_queue, reconciliation_queue, scrape_q │
│  Scheduled (pg_cron) agent-match (2 min), unclaimed-escalation (1h),│
│                      unpaid-escalation (daily)                      │
│  Auth                magic-link login, existing RBAC + SHIPOWNER    │
│  Storage             bucket "invoices" for generated PDFs           │
└───────────┬─────────────────────────────────────────────────────────┘
            │ LISTEN/NOTIFY + webhook
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ NEXT.JS (frontend/, Vercel or self-host; dev on :3300)              │
│                                                                      │
│  Pages                                                               │
│   /dashboard/incoming-vessels    agent list of UNCLAIMED alerts     │
│   /admin/agents                  manage A1 + review A2 requests     │
│   /admin/owner-agent-mappings    configure A cascade                │
│   /admin/tax-settings            rates, thresholds, feature flags   │
│   /admin/escalations             Port Officer unclaimed + unpaid    │
│  API routes                                                          │
│   /api/queue/process-proforma    pgmq worker: PDF + Resend send     │
│   /api/queue/process-reconcile   pgmq worker: final invoice         │
│   /api/webhooks/scrape-result    EQUASIS proposals (Phase 2)        │
│  Server actions                                                      │
│   claimArrivalAlert, escalateToOwner, validateScrapeProposal, …     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ GO SCRAPER WORKER (Phase 2, behind feature flag)                    │
│                                                                      │
│  cmd/scraper/main.go — polls scrape_queue, pulls public Equasis     │
│  pages under a rate limit, proposes owner/manager/country/email     │
│  candidates to equasis_scrape_proposals for human validation.       │
│  Nothing is ever applied automatically.                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Split rationale

- **Go** owns real-time streams and geospatial work. It already has the AIS ingester and a point-in-polygon engine. Go's concurrency model is the right tool for continuous position evaluation.
- **Supabase** owns data, authentication, row-level security, scheduling (`pg_cron`), and lightweight queues (`pgmq`). No BullMQ / Redis is introduced — one less dependency.
- **Next.js** owns user-facing flows and anything text-heavy (PDF rendering via `@react-pdf/renderer`, transactional email via Resend). Server Actions handle state transitions initiated by humans.
- **EQUASIS scraper** is explicitly isolated: a separate process behind a feature flag; outputs are proposals, never direct writes. This keeps the compliance-sensitive path auditable.

---

## 5. Data Model

### 5.1 New enums

```sql
CREATE TYPE arrival_alert_status AS ENUM (
  'DETECTED',       -- Go backend just emitted
  'MATCHED_AUTO',   -- cascade A matched a local agent
  'UNCLAIMED',      -- cascade B: awaiting portal claim
  'CLAIMED',        -- an agent clicked Claim
  'ESCALATED',      -- cascade C: Port Officer manual
  'PROFORMA_SENT',  -- pro-forma emailed
  'ARRIVED',        -- vessel entered EEZ
  'DEPARTED_EEZ',   -- vessel left EEZ (waiting reconcile)
  'RECONCILED',     -- final invoice issued
  'CANCELLED'       -- false positive, rerouted, IMO missing, …
);

CREATE TYPE shipowner_account_state AS ENUM (
  'GHOST',    -- B1: record without login
  'INVITED',  -- B2: magic link sent
  'ACTIVE'    -- B2: logged in at least once
);

CREATE TYPE document_type AS ENUM (
  'PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND'
);

-- Extend existing transaction_status with credit note value:
ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'CREDIT_NOTE_ISSUED';
ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'VOID';

CREATE TYPE emission_factor_source AS ENUM (
  'EU_MRV', 'IMO_CATEGORY', 'FALLBACK'
);
```

### 5.2 New tables

#### `arrival_alerts` — state machine root

```sql
CREATE TABLE arrival_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id           UUID NOT NULL REFERENCES vessels(id),
  imo_number          TEXT NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_lat        NUMERIC(9, 6) NOT NULL,
  detected_lng        NUMERIC(9, 6) NOT NULL,
  distance_to_port_nm NUMERIC(10, 2) NOT NULL,
  estimated_eta       TIMESTAMPTZ,
  estimated_route_nm  NUMERIC(10, 2),
  status              arrival_alert_status NOT NULL DEFAULT 'DETECTED',
  matched_agent_id    UUID REFERENCES profiles(id),
  matched_via         TEXT CHECK (matched_via IN ('AUTO_MAPPING', 'CLAIM', 'PORT_OFFICER')),
  proforma_transaction_id UUID REFERENCES transactions(id),
  final_transaction_id    UUID REFERENCES transactions(id),
  arrived_at          TIMESTAMPTZ,
  departed_eez_at     TIMESTAMPTZ,
  cancelled_reason    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_status_open
  ON arrival_alerts(status)
  WHERE status NOT IN ('RECONCILED', 'CANCELLED');

CREATE INDEX idx_alert_vessel_detected
  ON arrival_alerts(vessel_id, detected_at DESC);

CREATE UNIQUE INDEX idx_alert_active_per_vessel
  ON arrival_alerts(vessel_id)
  WHERE status NOT IN ('RECONCILED', 'CANCELLED');
-- prevents duplicate alerts per vessel while an older alert is still active
```

#### `shipowners` — owner record, with or without portal account

```sql
CREATE TABLE shipowners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_company_no        TEXT UNIQUE,            -- IMO Company Number from Equasis/MRV
  name                  TEXT NOT NULL,
  country_code          TEXT,
  address               TEXT,
  official_email        TEXT,
  official_email_source TEXT CHECK (official_email_source IN (
    'AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED'
  )),
  email_verified_at     TIMESTAMPTZ,
  account_state         shipowner_account_state NOT NULL DEFAULT 'GHOST',
  profile_id            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vessels
  ADD COLUMN shipowner_id UUID REFERENCES shipowners(id),
  ADD COLUMN last_zone    TEXT;       -- cached last-known zone ('EEZ','PORT_VICINITY','TRANSIT_LANE','INTERNATIONAL'); updated by Go on each AIS tick for EEZ entry/exit edge detection
CREATE INDEX idx_vessels_shipowner ON vessels(shipowner_id);
```

#### `owner_agent_mappings` — cascade A table

```sql
CREATE TABLE owner_agent_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id     UUID NOT NULL REFERENCES shipowners(id),
  agent_profile_id UUID NOT NULL REFERENCES profiles(id),
  priority         INT NOT NULL DEFAULT 100,
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until      DATE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipowner_id, agent_profile_id, valid_from)
);

CREATE INDEX idx_oam_lookup
  ON owner_agent_mappings(shipowner_id, active, priority)
  WHERE active = TRUE;
```

Cascade query used by `pg_cron` agent-match job:

```sql
SELECT agent_profile_id
  FROM owner_agent_mappings
 WHERE shipowner_id = $1
   AND active = TRUE
   AND valid_from <= CURRENT_DATE
   AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
 ORDER BY priority ASC
 LIMIT 1;
```

If the query returns 0 rows → `status = UNCLAIMED`. If it returns exactly 1 row → `status = MATCHED_AUTO`. If the table has ambiguous rows with identical priority → keep `UNCLAIMED` (deliberate: do not guess).

#### `emission_factors` — tax formula cascade

```sql
CREATE TABLE emission_factors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source             emission_factor_source NOT NULL,
  imo_number         TEXT,
  vessel_category    vessel_category,
  gt_min             INT,
  gt_max             INT,
  grams_co2_per_nm   NUMERIC(10, 3) NOT NULL,
  valid_from         DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until        DATE,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (source = 'EU_MRV' AND imo_number IS NOT NULL) OR
    (source IN ('IMO_CATEGORY', 'FALLBACK') AND vessel_category IS NOT NULL)
  )
);

CREATE INDEX idx_ef_imo ON emission_factors(imo_number)
  WHERE imo_number IS NOT NULL AND active = TRUE;

CREATE INDEX idx_ef_cat_gt ON emission_factors(vessel_category, gt_min, gt_max)
  WHERE active = TRUE;
```

Cascade lookup in the Go calculator:

1. Try `EU_MRV` by `imo_number`.
2. If none, try `IMO_CATEGORY` by category + GT range.
3. If none, fall back to the single `FALLBACK` row.

Every invoice records the `emission_factor_id` used for audit traceability.

#### `equasis_scrape_proposals` — Phase 2, dormant in MVP

```sql
CREATE TABLE equasis_scrape_proposals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number           TEXT NOT NULL,
  shipowner_id         UUID REFERENCES shipowners(id),
  proposed_owner_name  TEXT,
  proposed_manager     TEXT,
  proposed_email       TEXT,
  proposed_country     TEXT,
  scraped_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by          UUID REFERENCES profiles(id),
  reviewed_at          TIMESTAMPTZ,
  applied              BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason      TEXT
);
```

### 5.3 Extensions to existing tables

#### `transactions` (the billing table; `invoice` is the UI label)

```sql
ALTER TABLE transactions
  ADD COLUMN document_type            document_type NOT NULL DEFAULT 'FINAL',
  ADD COLUMN related_transaction_id   UUID REFERENCES transactions(id),
  ADD COLUMN arrival_alert_id         UUID REFERENCES arrival_alerts(id),
  ADD COLUMN agent_profile_id         UUID REFERENCES profiles(id),
  ADD COLUMN shipowner_id             UUID REFERENCES shipowners(id),
  ADD COLUMN distance_eez_nm          NUMERIC(10, 2),
  ADD COLUMN emission_factor_used_id  UUID REFERENCES emission_factors(id),
  ADD COLUMN rate_usd_per_tco2        NUMERIC(10, 2) NOT NULL DEFAULT 40.00,
  ADD COLUMN owner_escalation_due_at  TIMESTAMPTZ,
  ADD COLUMN escalated_to_owner_at    TIMESTAMPTZ,
  ADD COLUMN escalated_to_owner_email TEXT,
  ADD COLUMN escalated_by             UUID REFERENCES profiles(id),
  ADD COLUMN breakdown_json           JSONB;  -- per-line detail (distance, factor, rate)

CREATE INDEX idx_txn_alert ON transactions(arrival_alert_id);
CREATE INDEX idx_txn_agent_status
  ON transactions(agent_profile_id, status)
  WHERE document_type = 'PROFORMA';
CREATE INDEX idx_txn_unpaid_escalation_due
  ON transactions(status, document_type, owner_escalation_due_at)
  WHERE status = 'PENDING' AND escalated_to_owner_at IS NULL;
```

Column mapping to existing columns (no renames):
- `tax_amount_usd` (existing) = total amount — used for pro-forma, final, complement
- `emissions_tco2` (existing) = tCO₂ estimated or actual
- `status` (existing) = transaction_status enum; adds values `CREDIT_NOTE_ISSUED` and `VOID`
- `invoice_pdf_url` (existing) = URL to the rendered PDF in Storage

#### `vessels` — detention (dormant, post-MVP)

```sql
ALTER TABLE vessels
  ADD COLUMN detain_on_next_call BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN detain_reason       TEXT,
  ADD COLUMN detain_set_by       UUID REFERENCES profiles(id),
  ADD COLUMN detain_set_at       TIMESTAMPTZ;
```

These columns are created in MVP but the feature (`feature.vessel_detention_enabled`) stays OFF until post-MVP.

#### `profile_role` enum — add SHIPOWNER

```sql
ALTER TYPE profile_role ADD VALUE IF NOT EXISTS 'SHIPOWNER';
```

Read-only role. RLS allows a shipowner to read:
- Their own record in `shipowners`.
- `vessels` whose `shipowner_id` matches their profile's linked shipowner.
- Invoices where `shipowner_id` matches, OR invoices attached to an `arrival_alert` for one of their vessels (for traceability).

### 5.4 Queues (pgmq)

```sql
SELECT pgmq.create('proforma_queue');        -- { arrival_alert_id }
SELECT pgmq.create('reconciliation_queue');  -- { arrival_alert_id }
SELECT pgmq.create('scrape_queue');          -- { imo, priority }
```

Next.js API routes act as workers, triggered either by a Supabase Database Webhook (on queue insert) or by a scheduled external cron that polls `pgmq.read()`. We start with webhook-driven workers; if latency or throughput becomes an issue, we switch to poll-based.

### 5.5 Scheduled jobs (`pg_cron`)

| Name | Frequency | Purpose |
|---|---|---|
| `agent-match`           | every 2 min   | For each `DETECTED` alert, look up shipowner and owner_agent_mappings; transition to `MATCHED_AUTO` or `UNCLAIMED`; enqueue `proforma_queue` when matched. |
| `unclaimed-escalation`  | every 1 hour  | Transition `UNCLAIMED` alerts older than `arrival.claim_sla_hours` whose ETA is within `arrival.escalation_eta_buffer_h` to `ESCALATED`; notify Port Officer. |
| `corridor-timeout`      | every 6 hours | Cancel `DETECTED`/`MATCHED_AUTO`/`UNCLAIMED` alerts older than `arrival.cancel_corridor_timeout_h` whose vessel has left the corridor without entering the EEZ. |
| `unpaid-escalation`     | daily         | Mark `PROFORMA` invoices 7+ days past `arrived_at` as eligible for owner escalation (`escalated_to_owner_at` staging); notify Port Officer dashboard. Actual send is a human action. |
| `reconciliation-sweep`  | every 10 min  | Safety net: scan `ARRIVED` alerts, ask Go `/api/v1/alerts/:id/distance-final` for any that already report `departed_eez_at`; enqueue `reconciliation_queue`. |

The primary detection of EEZ exit is still done by the Go `reconcile.Tracker` on each incoming AIS position; the SQL sweep is the fallback for positions dropped or races.

### 5.6 Configuration — `app_config` keys

All tunable values live in the existing `app_config` table (migration 009). New keys:

| Key | Default | Description |
|---|---|---|
| `carbon_tax.rate_usd_per_tco2` | `40` | Tarif USD per tCO₂ (decree) |
| `arrival.corridor_radius_nm` | `500` | Approach corridor radius around destination port |
| `arrival.cancel_corridor_timeout_h` | `168` | Hours before an unfired alert is cancelled |
| `arrival.claim_sla_hours` | `24` | Agent claim SLA before Port Officer escalation |
| `arrival.escalation_eta_buffer_h` | `36` | Escalate only when ETA < this buffer |
| `reconciliation.tolerance_pct` | `10` | Delta tolerated between pro-forma and final |
| `reconciliation.check_interval_min` | `5` | Go `reconcile.Tracker` tick frequency |
| `owner_escalation.delay_days` | `7` | Days post-arrival before owner cascade |
| `owner_escalation.reminder_count` | `2` | Agent reminders before owner cascade |
| `proforma.languages_default` | `["en","fr","ar"]` | Languages rendered by default |
| `proforma.email_cc_admin` | `true` | CC finance admin on pro-forma sends |
| `feature.ais_global_enabled` | `false` | Phase 2 scenario A |
| `feature.equasis_scraper_enabled` | `false` | Phase 2 scraper |
| `feature.vessel_detention_enabled` | `false` | Post-MVP |
| `feature.shipowner_portal_enabled` | `true` | B2 (invite owners) |

### 5.7 GeoJSON assets

Polygons kept in files (not DB) so they remain diffable and reviewable by humans:

```
public/geo/
  berbera-eez.geojson
  berbera-port-vicinity.geojson
  berbera-approach-corridor.geojson
  zeila-eez.geojson
  zeila-port-vicinity.geojson
  zeila-approach-corridor.geojson
```

The Go `internal/eez/zones.go` loads the same polygons (or constants generated from them). A unit test ensures the Go constants match the GeoJSON files byte-identically to prevent drift.

### 5.8 Seeds

```sql
-- IMO 4th GHG Study (2020) fallback factors (public domain)
INSERT INTO emission_factors (source, vessel_category, gt_min, gt_max, grams_co2_per_nm, notes) VALUES
  ('IMO_CATEGORY', 'TANKER', 0,      5000,   48000,  'GHG4 small tanker'),
  ('IMO_CATEGORY', 'TANKER', 5000,   60000,  120000, 'GHG4 medium tanker'),
  ('IMO_CATEGORY', 'TANKER', 60000,  200000, 280000, 'GHG4 large tanker'),
  ('IMO_CATEGORY', 'CARGO',  0,      5000,   35000,  'GHG4 small cargo'),
  ('IMO_CATEGORY', 'CARGO',  5000,   60000,  95000,  'GHG4 medium cargo'),
  ('IMO_CATEGORY', 'CARGO',  60000,  200000, 220000, 'GHG4 large cargo'),
  ('IMO_CATEGORY', 'FERRY',  0,      999999, 70000,  'GHG4 ferry'),
  ('IMO_CATEGORY', 'NAVAL',  0,      999999, 90000,  'GHG4 naval estimate'),
  ('FALLBACK',     NULL,     0,      999999, 50000,  'Conservative fallback');
```

Agent seeds are populated manually per port during the admin onboarding step before go-live.

---

## 6. Flows

### 6.1 Detection flow (corridor → alert → matching)

```
aisstream.io → Go ais.Ingester → INSERT vessel_positions

Go corridor.Watcher (runs inside ingester goroutine, per message):
  If distance(position, destination_port) <= corridor_radius_nm
     AND vessel has no active alert (unique index enforces this)
     AND cog_convergence_ok (optional filter)
     AND vessel.imo_number is not empty
  Then:
     estimated_route_nm = greatCircle(position, port, via eez_entry_waypoint)
     estimated_eta      = now + distance / max(sog, 6) NM/h
     INSERT arrival_alerts (status='DETECTED', …)
     INSERT audit_log ('ALERT_CREATED', …)

If vessel.imo_number is empty:
  INSERT arrival_alerts (status='CANCELLED', cancelled_reason='IMO missing')
  No further processing; IMO is required to tax.

pg_cron 'agent-match' (every 2 min):
  FOR each arrival_alert WHERE status='DETECTED':
    1. Load vessel + shipowner (creating GHOST shipowner from EU MRV if new)
    2. Cascade lookup in owner_agent_mappings
    3. If exactly one row:
         UPDATE status='MATCHED_AUTO', matched_agent_id, matched_via='AUTO_MAPPING'
         pgmq.send('proforma_queue', { arrival_alert_id })
       Else:
         UPDATE status='UNCLAIMED'
    4. INSERT audit_log
```

### 6.2 Claim flow (cascade B)

```
Agent opens /dashboard/incoming-vessels
  RLS: shows arrival_alerts WHERE status='UNCLAIMED'
       filtered to port(s) the agent is authorized for.
  Each row shows: vessel name, IMO, ETA, estimated distance/amount, "Claim" button.

Agent clicks Claim:
  Client opens a mandatory form:
    - Official shipowner email (REQUIRED — this is the D path source)
    - Confirm agency assignment
  Server Action claimArrivalAlert(alertId, ownerEmail):
    1. Conditional UPDATE:
         UPDATE arrival_alerts
         SET status='CLAIMED', matched_agent_id=auth.uid(),
             matched_via='CLAIM'
         WHERE id=$1 AND status='UNCLAIMED';
       If 0 rows affected: return error "Already claimed or invalid state"
    2. UPSERT shipowners SET official_email=$ownerEmail,
                              official_email_source='AGENT_CLAIM'
       (only if current email is NULL or its source is 'EQUASIS_VERIFIED' with
        no verification; 'PORT_OFFICER' source is higher trust and not overwritten)
    3. pgmq.send('proforma_queue', { arrival_alert_id })
    4. INSERT audit_log ('ALERT_CLAIMED', actor=auth.uid(), …)
```

### 6.3 Pro-forma generation flow

`/api/queue/process-proforma` handler (triggered by Supabase webhook when a row is inserted to `pgmq.q_proforma_queue`):

```
1. Dequeue { arrival_alert_id }
2. Load alert + vessel + shipowner + agent profile
3. POST Go /api/v1/tax/calculate
     { imo, vessel_category, gross_tonnage, distance_nm: estimated_route_nm }
   → { tco2, usd_amount, breakdown: {
         distance_nm, emission_factor_g_co2_per_nm, emission_factor_source,
         emission_factor_id, rate_usd_per_tco2
     } }
4. INSERT transactions (
     document_type='PROFORMA', status='PENDING',
     arrival_alert_id, agent_profile_id, shipowner_id,
     vessel_id, vessel_name, vessel_imo,
     transaction_type='ENTRY_TAX',        -- matches existing enum
     distance_eez_nm, emission_factor_used_id,
     rate_usd_per_tco2, tax_amount_usd=usd_amount,
     emissions_tco2=tco2,
     breakdown_json={distance_nm, factor_g, factor_source, rate}, …
   )
6. Render PDF (one per language in proforma.languages_default) via
   @react-pdf/renderer, using the existing invoice PDF template
7. Upload PDFs to Storage bucket "invoices/" (path invoices/<year>/<invoice_no>.{lang}.pdf)
8. Resend email to agent_profile.email:
     Subject: "Pro-forma carbon tax — MV <name> — IMO <imo> — ETA <date>"
     Attachments: EN/FR/AR PDFs (or subset based on agent prefs)
     Body: amount, breakdown, "indicative, subject to reconciliation",
           portal link with magic-token (invoice_view_token)
     CC: finance@africgreen based on proforma.email_cc_admin
9. UPDATE arrival_alert status='PROFORMA_SENT',
                         proforma_transaction_id=<new transaction id>
10. INSERT audit_log ('PROFORMA_SENT', …)

Failure handling:
  - Go tax endpoint timeout/error → leave alert in its current state, requeue with
    exponential backoff (pgmq re-delivery via visibility timeout)
  - PDF render error → log, alert admin, requeue once
  - Resend error → invoice is INSERTed (state transitions), but
    alert status stays 'MATCHED_AUTO' or 'CLAIMED'; a background job retries send
```

### 6.4 Escalation to Port Officer (cascade C)

```
pg_cron 'unclaimed-escalation' (hourly):
  UPDATE arrival_alerts
     SET status='ESCALATED'
   WHERE status='UNCLAIMED'
     AND detected_at < NOW() - (SELECT (value::text)::int FROM app_config WHERE key='arrival.claim_sla_hours') * INTERVAL '1 hour'
     AND estimated_eta < NOW() + (SELECT (value::text)::int FROM app_config WHERE key='arrival.escalation_eta_buffer_h') * INTERVAL '1 hour'
  RETURNING id;

For each escalated id:
  Notify Port Officer + FINANCE_ADMIN via email
  Badge appears on /admin/escalations

Port Officer opens /admin/escalations:
  For each row, can:
   (a) Assign an existing agent (dropdown of known local agents)
       → UPDATE status='CLAIMED', matched_via='PORT_OFFICER',
         matched_agent_id=<chosen>
       → enqueue proforma_queue
   (b) Cancel (reason required)
       → UPDATE status='CANCELLED', cancelled_reason=<reason>
```

### 6.5 EEZ entry and reconciliation flow (EEZ exit → final invoice)

**EEZ entry (transition to `ARRIVED`)** — handled by Go on every AIS position:

```
Go eez watcher (same goroutine as ais.Ingester, per message):
  zone_now  = eez.Detect(position)
  zone_prev = last known zone for this vessel (cached in DB: vessels.last_zone)
  If zone_prev NOT IN (EEZ, PORT_VICINITY) AND zone_now IN (EEZ, PORT_VICINITY):
    UPDATE arrival_alerts
       SET status='ARRIVED', arrived_at=position.recorded_at
     WHERE vessel_id=$1
       AND status IN ('PROFORMA_SENT','MATCHED_AUTO','CLAIMED','UNCLAIMED','ESCALATED','DETECTED');
    IF no matching alert exists for this vessel:
       INSERT arrival_alerts (status='ARRIVED', arrived_at, …)
       pgmq.send('proforma_queue', { arrival_alert_id })    -- retroactive pro-forma
  UPDATE vessels SET last_zone=zone_now WHERE id=$1;
```

This handles both the normal path (pro-forma already sent before entry) and the
bypass case (vessel entered EEZ without prior corridor detection — no AIS when in
open waters, spoofing, etc.).

**EEZ exit (transition to `DEPARTED_EEZ` then `RECONCILED`)**:

```
Go reconcile.Tracker (ticker reconciliation.check_interval_min, default 5 min):
  SELECT alerts WHERE status='ARRIVED' AND departed_eez_at IS NULL
  For each alert:
    latest_pos = latest vessel_positions
    zone = eez.Detect(latest_pos)
    If zone NOT IN (EEZ, PORT_VICINITY):
      UPDATE arrival_alerts SET status='DEPARTED_EEZ',
                                departed_eez_at=latest_pos.recorded_at
      pgmq.send('reconciliation_queue', { arrival_alert_id })

/api/queue/process-reconcile handler:
  1. Load alert + proforma transaction + all vessel_positions in window
     [first_position_in_eez, departed_eez_at]
  2. GET Go /api/v1/alerts/:id/distance-final
       → { total_distance_eez_nm, points_used }
  3. POST Go /api/v1/tax/calculate with the real distance
     → { tco2_real, usd_real, breakdown }
  4. Compute delta_pct = |usd_real - proforma.tax_amount_usd| / proforma.tax_amount_usd * 100
  5. Decide:
     If delta_pct <= reconciliation.tolerance_pct (10%):
       INSERT transactions (document_type='FINAL', status=proforma.status,
                            tax_amount_usd=usd_real, emissions_tco2=tco2_real,
                            related_transaction_id=proforma.id,
                            transaction_type='ENTRY_TAX', …)
       note: "Reconciled within tolerance, no adjustment"
     Else if usd_real > proforma.tax_amount_usd:
       INSERT transactions (document_type='COMPLEMENT', status='PENDING',
                            tax_amount_usd=usd_real - proforma.tax_amount_usd,
                            emissions_tco2=tco2_real - proforma.emissions_tco2,
                            related_transaction_id=proforma.id, …)
     Else:
       INSERT transactions (document_type='REFUND', status='CREDIT_NOTE_ISSUED',
                            tax_amount_usd=-(proforma.tax_amount_usd - usd_real),
                            related_transaction_id=proforma.id, …)
  6. Render & email like pro-forma flow
  7. UPDATE arrival_alert status='RECONCILED', final_transaction_id=<new transaction id>
  8. INSERT audit_log
```

### 6.6 Owner escalation (manual, 7 days post-arrival)

```
pg_cron 'unpaid-escalation' (daily):
  UPDATE transactions
     SET owner_escalation_due_at = NOW()   -- staged; means "eligible since"
   WHERE document_type='PROFORMA' AND status='PENDING'
     AND arrival_alert_id IN (
       SELECT id FROM arrival_alerts
        WHERE arrived_at < NOW() - (SELECT (value::text)::int
                                      FROM app_config
                                     WHERE key='owner_escalation.delay_days') * INTERVAL '1 day'
     )
     AND owner_escalation_due_at IS NULL;

Staged rows surface on /admin/escalations (pane "Unpaid 7d+"). The `escalated_to_owner_at`
column is set only when the Port Officer actually sends the owner cascade email.

Port Officer decides action per row:
  Option 1 — Reminder agent only:
    Triggers existing net30_collections reminder pipeline; no owner escalation yet.
  Option 2 — Escalate to owner:
    If shipowner.official_email is NULL:
      Show candidate emails:
        - equasis_scrape_proposals (Phase 2) — any pending proposal for this IMO
        - Manual text field
      Port Officer picks / types, clicks Save →
        UPDATE shipowners.official_email, official_email_source='PORT_OFFICER'
    Then Port Officer clicks "Send owner cascade email":
      Resend email to owner with PDF + FR/EN cover letter citing decree
      UPDATE invoices.escalated_to_owner_email=official_email,
                      escalated_to_owner_at=NOW(),
                      escalated_by=auth.uid()
      INSERT audit_log
  Option 3 — Invite shipowner to portal (only if feature.shipowner_portal_enabled):
    Generate Supabase Auth magic link
    Create profiles row with role='SHIPOWNER'
    UPDATE shipowners SET account_state='INVITED', profile_id=<new profile id>
    Same email as Option 2 but with login link

Dormant option (post-MVP, feature.vessel_detention_enabled=false):
  Flag vessels.detain_on_next_call=TRUE, set reason + actor + timestamp.
  Hook into port-operations integration when that integration exists.
```

---

## 7. Edge Cases

| Case | Handling |
|---|---|
| Vessel detected in corridor but reroutes, never enters EEZ | `corridor-timeout` cron flips alert to `CANCELLED`. If a pro-forma was already sent, issue a refund (REFUND invoice with note "vessel did not call"). |
| Vessel enters EEZ without prior corridor detection (AIS gap, spoofing) | Go EEZ watcher detects entry (§6.5); creates `arrival_alert` directly in `ARRIVED` state and enqueues `proforma_queue` for retroactive pro-forma + same reconciliation pipeline on exit. |
| Two agents race to Claim | Conditional `UPDATE WHERE status='UNCLAIMED'`; second call returns "already claimed". |
| Multiple active `owner_agent_mappings` with equal priority | Deliberately keep `UNCLAIMED`; surface ambiguity on admin panel so an admin resolves it. |
| Pro-forma already paid, reconciliation yields a COMPLEMENT | New invoice type=`COMPLEMENT`, status=`PENDING`. Feeds into existing net30 collections pipeline. |
| Pro-forma already paid, reconciliation yields a REFUND | New invoice type=`REFUND` with negative amount and status=`CREDIT_NOTE_ISSUED`. Actual fund movement is handled by finance admin (out of scope of this spec). |
| Emission factor missing (no EU_MRV, unknown category) | Cascade returns `FALLBACK` row. Invoice flagged on admin view with a yellow badge for manual review. |
| Vessel `imo_number` empty from AIS | Alert created as `CANCELLED` with reason `IMO missing`. No further attempts on this voyage. |
| Agent provides a wrong owner email at claim | `official_email_source='AGENT_CLAIM'`. Port Officer can overwrite when escalating (source priority: `PORT_OFFICER` > `AGENT_CLAIM`; `EQUASIS_VERIFIED` only when human-validated). |
| EU MRV data for IMO is from prior year and no longer representative | Factor cascade still picks it first because `source='EU_MRV'` has highest precedence. Mitigation: annual refresh of `eu_mrv_cache` + option to deactivate specific rows. |
| Vessel has multiple owners in EU MRV record | Store the one tagged "Registered Owner" first. If absent, "Ship Manager". Always shown to humans for validation. |
| `pg_cron` run skipped (Supabase maintenance) | Sweep jobs (corridor-timeout, unclaimed-escalation, unpaid-escalation) are idempotent; catch up on next run. |
| Go backend restart loses in-memory corridor state | Corridor entry/exit is derived each tick from `vessel_positions` (persisted) + DB index on active alerts; no in-memory state. |
| Resend outage | Pro-forma invoice row is still INSERTed. A background retry job resends within 15 min. Port Officer can force-resend manually. |
| Agent email bounces | Resend webhook → update invoice `email_delivery_status`; Port Officer sees failure in /admin/escalations dashboard. |

---

## 8. Configuration & Feature Flags

All configuration is stored in `app_config`. Feature flags are prefixed `feature.*`. All tunables have admin UIs:

- `/admin/tax-settings` — rates, thresholds, tolerance, languages (already exists; add new fields).
- `/admin/corridor` — approach corridor geometry viewer + config (read-only polygon + editable radius for circular variant).
- `/admin/feature-flags` — toggle Phase 2 / post-MVP flags (SUPERADMIN only).

Changes to `app_config` are audit-logged via existing trigger (mig 018).

---

## 9. Rollout Phases

### Phase 1 — MVP (this spec)

- Schema migrations 023–029 applied.
- Go backend: `corridor.Watcher`, `reconcile.Tracker`, emissions cascade in `tax.Calculator`.
- Supabase: `pg_cron` jobs and `pgmq` queues.
- Next.js: `/dashboard/incoming-vessels`, `/admin/escalations`, updates to `/admin/tax-settings`, `/admin/owner-agent-mappings`, queue workers.
- PDF + Resend email integration.
- End-to-end happy path: detection → MATCHED_AUTO → pro-forma → EEZ exit → reconciliation (delta<=10%).
- Manual escalation to owner (email field filled by Port Officer on the fly).

### Phase 2 — feature-flagged

- `feature.ais_global_enabled`: detection A (origin port departure) via paid aisstream.io tier, new scenario in `corridor.Watcher` filtering on `Destination` field.
- `feature.equasis_scraper_enabled`: Go scraper worker writing proposals to `equasis_scrape_proposals`; admin UI to review and apply.
- `feature.shipowner_portal_enabled`: B2 magic-link invitations; `/owner` routes for shipowners.

### Phase 3 — post-MVP

- `feature.vessel_detention_enabled`: detention-on-next-call workflow + port operations integration.
- Public API for agent automation (MSC, Maersk IT).
- BI dashboards for decree reporting.

---

## 10. Testing Strategy

Per project conventions (CLAUDE.md: TypeScript strict, Zod validation, tests for new code, atomic commits).

| Layer | Coverage |
|---|---|
| Go unit tests | `corridor.Watcher` (point-in-circle, cog filter, deduplication); `reconcile.Tracker` (EEZ exit detection, distance integral); `tax.Calculator` (cascade: EU_MRV hit → IMO_CATEGORY hit → FALLBACK hit). |
| Next.js unit tests | Server actions (claim race condition, email validation); queue handlers (error retry); PDF renderer (golden snapshot per language). |
| Supabase integration | `pg_cron` jobs (agent-match match / no-match / ambiguous); `pgmq` round-trip; RLS policies (agent sees own claims, not others'; shipowner read-only scope; port officer full). |
| End-to-end (Playwright) | Seed AIS positions → verify alert → simulate agent login → claim → verify email sent (Resend sandbox) → simulate EEZ exit → verify final invoice. |
| Load | Simulate 100 concurrent vessels entering corridor within 5 min → verify no duplicate alerts, no race conditions, `pgmq` visibility timeouts tuned. |
| Security | RLS bypass attempts; agent trying to claim on behalf of another agent; shipowner trying to read other shipowners' invoices; tampering with invoice PDF (tamper-resistant audit log from mig 018 remains intact). |

---

## 11. Dependencies & Cost Estimate (MVP)

| Dependency | Role | Monthly cost |
|---|---|---|
| aisstream.io | AIS feed (free tier) | $0 |
| Supabase Pro | Data, Auth, Storage, `pgmq`, `pg_cron` | $25 |
| Fly.io / VPS (Go backend) | 256 MB RAM always-on | ~$5 |
| Resend | Transactional email (<3k/month) | $0 |
| Vercel (Next.js) | Hobby → Pro in prod | $0–$20 |
| **Total MVP** | | **~$30–50 / month** |

Phase 2 adds ~$50–200/month for paid AIS tier and dedicated scraper instance.

---

## 12. Migrations to Create

```
supabase/migrations/
  023_arrival_alerts.sql
  024_shipowners_and_mappings.sql
  025_emission_factors.sql
  026_invoice_extensions_for_reconciliation.sql
  027_app_config_phase1_keys.sql
  028_pgmq_queues_and_pg_cron_jobs.sql
  029_escalation_and_detention_columns.sql
  030_equasis_scrape_proposals.sql    -- schema present, feature flag OFF
```

Go code additions:

```
backend/internal/
  corridor/
    watcher.go          # new
    watcher_test.go
  reconcile/
    tracker.go          # new
    tracker_test.go
  tax/
    calculator.go       # extend existing handler with cascade
    calculator_test.go
  emissions/
    factors.go          # cascade lookup client for emission_factors table
```

Next.js additions:

```
frontend/src/app/
  dashboard/incoming-vessels/page.tsx
  admin/escalations/page.tsx
  admin/owner-agent-mappings/page.tsx
  api/queue/process-proforma/route.ts
  api/queue/process-reconcile/route.ts
  api/webhooks/scrape-result/route.ts    # stub for Phase 2

frontend/src/services/
  arrivalAlertService.ts
  shipownerService.ts
  ownerAgentMappingService.ts
  invoicePdfService.ts
  resendService.ts

frontend/src/components/
  agent/ClaimAlertDialog.tsx
  admin/EscalationList.tsx
  admin/OwnerAgentMappingForm.tsx
```

---

## 13. Open Questions (to resolve during planning)

- Audit of existing `/signup` + `registration_requests` flow (A2): what specifically is missing for shipping agents? Needed before go-live. To be scoped when writing the implementation plan.
- Exact geometry of the 500 NM corridor: circle around port centroid vs. polygon aligned with the Gulf of Aden shipping lane. Start with a circle; revisit if false positives exceed 15%.
- Language availability for the Resend email body: currently EN/FR/AR for PDFs; email body templates (React Email) need the same three languages.
- Resend domain verification for `@africgreen.*`: who owns the domain ops? DKIM/SPF setup must be done before first email can land reliably.
- Integration with existing `022_net30_collections` reminder cadence — ensure pro-forma invoices are picked up by that pipeline automatically once they transition to `PENDING`.

---

**End of spec.**
