# Carbon Tax Pro-Forma — Plan 1: Schema Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply all schema changes (new tables, enums, extensions, RLS, seeds, queues) required by the proactive vessel detection & pro-forma invoicing feature. This plan delivers a fully migrated database that later plans can build against.

**Architecture:** Eight new SQL migrations (023–030) plus seeds. All changes are additive; no existing tables are dropped. pgmq and pg_cron extensions are enabled first. RLS policies are extended to cover new tables consistently with migrations 004 and 021.

**Tech Stack:** PostgreSQL 17, Supabase (pgmq, pg_cron, pgcrypto), existing Supabase migrations convention (`NNN_name.sql` files under `supabase/migrations/`).

**Spec reference:** `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` sections 5.1–5.8.

**Scope boundaries:**
- IN scope: DDL, enums, indexes, constraints, RLS policies, seeds, extension enablement, queue creation.
- OUT of scope: pg_cron job bodies (jobs that call application logic are scheduled in Plan 3/4/5 when that logic exists), Go/Next.js code, edge functions.

**Prereqs:**
- Supabase CLI installed (`supabase --version` ≥ 1.200).
- `supabase start` works locally.
- Migrations 001–022 apply cleanly on a fresh local DB.

---

## Test Strategy

Each migration task follows this pattern:

1. Write a `*.test.sql` file (pgTAP-style SELECT queries wrapped in `BEGIN ... ROLLBACK`) under `supabase/tests/migrations/`. The test queries exercise the new objects: table exists, enum has expected values, constraint rejects invalid rows, RLS blocks unauthorized reads, seed data is present.
2. Run it against a **freshly reset local DB** with `supabase db reset` followed by `psql` executing the test file. Expected: test fails (object does not exist).
3. Write the migration.
4. Run `supabase db reset` to re-apply all migrations and then re-run the test file. Expected: all assertions pass.
5. Commit the migration + test together.

The repo currently has no migration-level tests; this plan introduces the pattern under `supabase/tests/migrations/`. A tiny helper script `supabase/tests/run.sh` is added in Task 0 to factor out the `psql` invocation.

**pgTAP is not enabled** — we use plain SQL assertions of the form:

```sql
DO $$ BEGIN
  ASSERT (SELECT 1 FROM pg_type WHERE typname='arrival_alert_status'),
    'arrival_alert_status enum missing';
END $$;
```

If an ASSERT fails, `psql` exits non-zero.

---

## File Structure

```
supabase/
  migrations/
    023_arrival_alerts.sql                    (new)
    024_shipowners_and_mappings.sql           (new)
    025_emission_factors_and_seeds.sql        (new)
    026_transactions_document_extensions.sql  (new)
    027_app_config_carbon_tax_keys.sql        (new)
    028_pgmq_queues.sql                       (new)
    029_escalation_columns_and_vessels_ext.sql (new)
    030_equasis_scrape_proposals.sql          (new)
  tests/
    run.sh                                    (new — test runner helper)
    migrations/
      023_arrival_alerts.test.sql             (new)
      024_shipowners_and_mappings.test.sql    (new)
      025_emission_factors.test.sql           (new)
      026_transactions_document.test.sql      (new)
      027_app_config.test.sql                 (new)
      028_pgmq_queues.test.sql                (new)
      029_escalation_vessels.test.sql         (new)
      030_equasis_scrape.test.sql             (new)
      foundation_integration.test.sql         (new — end-to-end smoke test)
```

---

## Task 0: Test Harness

**Files:**
- Create: `supabase/tests/run.sh`
- Create: `supabase/tests/migrations/.gitkeep`

- [ ] **Step 1: Create the test runner script**

Create `supabase/tests/run.sh`:

```bash
#!/usr/bin/env bash
# Runs a migration test file against the local Supabase DB.
# Usage: ./supabase/tests/run.sh migrations/023_arrival_alerts.test.sql
set -euo pipefail
TEST_FILE="${1:?usage: run.sh <path-relative-to-supabase/tests/>}"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
exec psql "$DB_URL" -v ON_ERROR_STOP=1 -f "supabase/tests/${TEST_FILE}"
```

Make it executable: `chmod +x supabase/tests/run.sh`.

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/run.sh supabase/tests/migrations/.gitkeep
git commit -m "test(supabase): add migration test runner harness"
```

---

## Task 1: Enable pgmq and pg_cron extensions

**Files:**
- Create: `supabase/migrations/023_arrival_alerts.sql` (starts with extension enablement to ensure ordering; rest of the file in later steps below)

Note: we place the `CREATE EXTENSION` statements at the very top of migration 023 — the first new migration in this plan — so every downstream migration can assume they exist. pgmq and pg_cron are Supabase-hosted extensions (available in Supabase Pro).

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/023_arrival_alerts.test.sql` (we will extend it across subsequent tasks; seed it now with an extension check):

```sql
-- 023: extensions & arrival_alerts schema
BEGIN;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgmq'),
    'pgmq extension not enabled';
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron'),
    'pg_cron extension not enabled';
END $$;
ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
supabase db reset
./supabase/tests/run.sh migrations/023_arrival_alerts.test.sql
```

Expected: `ERROR: pgmq extension not enabled` (ASSERT failure, exit 1).

- [ ] **Step 3: Create migration 023 (extensions only, for now)**

Create `supabase/migrations/023_arrival_alerts.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023 : arrival_alerts (state machine root for detection → reconcile)
-- + pgmq + pg_cron extensions (shared by all plan-1 migrations)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- (arrival_alerts DDL added in Task 2)
```

- [ ] **Step 4: Verify extensions test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/023_arrival_alerts.test.sql
```

Expected: `ROLLBACK` — exit 0, no assertion failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/023_arrival_alerts.sql supabase/tests/migrations/023_arrival_alerts.test.sql
git commit -m "feat(db): enable pgmq and pg_cron extensions (migration 023 scaffold)"
```

---

## Task 2: arrival_alerts table + enum + indexes

**Files:**
- Modify: `supabase/migrations/023_arrival_alerts.sql` (append DDL)
- Modify: `supabase/tests/migrations/023_arrival_alerts.test.sql` (append assertions)

- [ ] **Step 1: Extend the failing test**

Replace the contents of `supabase/tests/migrations/023_arrival_alerts.test.sql`:

```sql
-- 023: extensions & arrival_alerts schema
BEGIN;

-- Extensions
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgmq'),
    'pgmq extension not enabled';
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron'),
    'pg_cron extension not enabled';
END $$;

-- Enum
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname='arrival_alert_status'),
    'arrival_alert_status enum missing';
  ASSERT (
    SELECT array_agg(enumlabel ORDER BY enumsortorder)
      FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='arrival_alert_status'
  ) = ARRAY[
    'DETECTED','MATCHED_AUTO','UNCLAIMED','CLAIMED','ESCALATED',
    'PROFORMA_SENT','ARRIVED','DEPARTED_EEZ','RECONCILED','CANCELLED'
  ], 'arrival_alert_status enum has wrong values';
END $$;

-- Table
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='arrival_alerts'),
    'arrival_alerts table missing';
  -- Required columns
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='arrival_alerts' AND column_name='vessel_id'),
    'arrival_alerts.vessel_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='arrival_alerts' AND column_name='proforma_transaction_id'),
    'arrival_alerts.proforma_transaction_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='arrival_alerts' AND column_name='distance_to_port_nm'),
    'arrival_alerts.distance_to_port_nm missing';
END $$;

-- Unique active alert per vessel
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_alert_active_per_vessel'
  ), 'idx_alert_active_per_vessel missing';
END $$;

-- Constraint: matched_via whitelist
DO $$
DECLARE v_vessel UUID;
BEGIN
  -- Insert a vessel fixture if none exists (all NOT NULL columns per mig 003)
  SELECT id INTO v_vessel FROM public.vessels LIMIT 1;
  IF v_vessel IS NULL THEN
    INSERT INTO public.vessels (
      mmsi, imo_number, name, call_sign, flag_code, category,
      gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
    ) VALUES ('999000001','9999001','TEST','ABC','SO','CARGO',
              50000, 20000, 14.0, 'APPROACHING')
    RETURNING id INTO v_vessel;
  END IF;

  BEGIN
    INSERT INTO public.arrival_alerts (vessel_id, imo_number, detected_lat, detected_lng,
                                       distance_to_port_nm, matched_via)
    VALUES (v_vessel, '9999001', 10.5, 45.0, 400, 'NOT_A_VALID_VIA');
    RAISE EXCEPTION 'check constraint should have rejected invalid matched_via';
  EXCEPTION WHEN check_violation THEN
    -- expected
    NULL;
  END;
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails at the enum assertion**

```bash
./supabase/tests/run.sh migrations/023_arrival_alerts.test.sql
```

Expected: fails on `arrival_alert_status enum missing`.

- [ ] **Step 3: Append DDL to migration 023**

Append to `supabase/migrations/023_arrival_alerts.sql` (after the `CREATE EXTENSION` lines from Task 1):

```sql
-- ── Enum: arrival_alert_status ─────────────────────────────────────────────
CREATE TYPE public.arrival_alert_status AS ENUM (
  'DETECTED',       -- Go backend emitted the alert
  'MATCHED_AUTO',   -- cascade A matched a local agent
  'UNCLAIMED',      -- cascade B awaiting portal claim
  'CLAIMED',        -- an agent clicked Claim
  'ESCALATED',      -- cascade C: Port Officer manual
  'PROFORMA_SENT',  -- pro-forma emailed to agent
  'ARRIVED',        -- vessel entered EEZ
  'DEPARTED_EEZ',   -- vessel left EEZ (awaiting reconcile)
  'RECONCILED',     -- final/complement/refund issued
  'CANCELLED'       -- false positive, rerouted, IMO missing, etc.
);

-- ── Table: arrival_alerts ──────────────────────────────────────────────────
CREATE TABLE public.arrival_alerts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id               UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  imo_number              TEXT NOT NULL,
  detected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_lat            NUMERIC(9, 6) NOT NULL,
  detected_lng            NUMERIC(9, 6) NOT NULL,
  distance_to_port_nm     NUMERIC(10, 2) NOT NULL,
  estimated_eta           TIMESTAMPTZ,
  estimated_route_nm      NUMERIC(10, 2),
  status                  public.arrival_alert_status NOT NULL DEFAULT 'DETECTED',
  matched_agent_id        UUID REFERENCES public.profiles(id),
  matched_via             TEXT CHECK (matched_via IN ('AUTO_MAPPING','CLAIM','PORT_OFFICER')),
  proforma_transaction_id UUID,  -- FK added in migration 026 after transactions is extended
  final_transaction_id    UUID,
  arrived_at              TIMESTAMPTZ,
  departed_eez_at         TIMESTAMPTZ,
  cancelled_reason        TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_status_open
  ON public.arrival_alerts(status)
  WHERE status NOT IN ('RECONCILED', 'CANCELLED');

CREATE INDEX idx_alert_vessel_detected
  ON public.arrival_alerts(vessel_id, detected_at DESC);

CREATE UNIQUE INDEX idx_alert_active_per_vessel
  ON public.arrival_alerts(vessel_id)
  WHERE status NOT IN ('RECONCILED', 'CANCELLED');

CREATE TRIGGER arrival_alerts_updated_at
  BEFORE UPDATE ON public.arrival_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/023_arrival_alerts.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/023_arrival_alerts.sql supabase/tests/migrations/023_arrival_alerts.test.sql
git commit -m "feat(db): arrival_alerts table + status enum (migration 023)"
```

---

## Task 3: shipowners + owner_agent_mappings + vessels extensions

**Files:**
- Create: `supabase/migrations/024_shipowners_and_mappings.sql`
- Create: `supabase/tests/migrations/024_shipowners_and_mappings.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/024_shipowners_and_mappings.test.sql`:

```sql
BEGIN;

-- Enum shipowner_account_state
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname='shipowner_account_state'),
    'shipowner_account_state enum missing';
  ASSERT (SELECT array_agg(enumlabel ORDER BY enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='shipowner_account_state')
         = ARRAY['GHOST','INVITED','ACTIVE'],
    'shipowner_account_state values wrong';
END $$;

-- shipowners table
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='shipowners' AND table_schema='public'),
    'shipowners table missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='shipowners' AND column_name='official_email_source'),
    'shipowners.official_email_source missing';
END $$;

-- owner_agent_mappings table + unique constraint
DO $$
DECLARE v_owner UUID;
DECLARE v_profile UUID;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='owner_agent_mappings' AND table_schema='public'),
    'owner_agent_mappings table missing';

  -- Round-trip: insert, then duplicate insert should fail on UNIQUE
  INSERT INTO public.shipowners (name) VALUES ('Test Owner') RETURNING id INTO v_owner;

  -- profiles.id has FK to auth.users(id), so use a seeded demo profile.
  -- The seed.sql creates demo.agent@… (UUID 0000…0003). If seeds have not
  -- been loaded, fall back to the first profile of any role.
  SELECT id INTO v_profile FROM public.profiles WHERE role='SHIPPING_AGENT' LIMIT 1;
  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles LIMIT 1;
  END IF;
  ASSERT v_profile IS NOT NULL,
    'no profile available for test; run supabase db reset to load seed.sql';

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id, valid_from)
  VALUES (v_owner, v_profile, CURRENT_DATE);

  BEGIN
    INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id, valid_from)
    VALUES (v_owner, v_profile, CURRENT_DATE);
    RAISE EXCEPTION 'unique constraint on (shipowner_id,agent_profile_id,valid_from) should have fired';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

-- vessels.shipowner_id and vessels.last_zone columns
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='vessels' AND column_name='shipowner_id'),
    'vessels.shipowner_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='vessels' AND column_name='last_zone'),
    'vessels.last_zone missing';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/024_shipowners_and_mappings.test.sql
```

Expected: fails on `shipowner_account_state enum missing`.

- [ ] **Step 3: Write migration 024**

Create `supabase/migrations/024_shipowners_and_mappings.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024 : shipowners, owner_agent_mappings, vessels extensions
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum ────────────────────────────────────────────────────────────────────
CREATE TYPE public.shipowner_account_state AS ENUM ('GHOST', 'INVITED', 'ACTIVE');

-- ── shipowners ──────────────────────────────────────────────────────────────
CREATE TABLE public.shipowners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_company_no        TEXT UNIQUE,
  name                  TEXT NOT NULL,
  country_code          TEXT,
  address               TEXT,
  official_email        TEXT,
  official_email_source TEXT CHECK (official_email_source IN
    ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED')),
  email_verified_at     TIMESTAMPTZ,
  account_state         public.shipowner_account_state NOT NULL DEFAULT 'GHOST',
  profile_id            UUID REFERENCES public.profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shipowners_imo_company ON public.shipowners(imo_company_no)
  WHERE imo_company_no IS NOT NULL;

CREATE TRIGGER shipowners_updated_at
  BEFORE UPDATE ON public.shipowners
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── owner_agent_mappings ────────────────────────────────────────────────────
CREATE TABLE public.owner_agent_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id     UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  agent_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  priority         INT  NOT NULL DEFAULT 100,
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until      DATE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipowner_id, agent_profile_id, valid_from)
);

CREATE INDEX idx_oam_lookup
  ON public.owner_agent_mappings(shipowner_id, active, priority)
  WHERE active = TRUE;

-- ── vessels extensions ─────────────────────────────────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN shipowner_id UUID REFERENCES public.shipowners(id),
  ADD COLUMN last_zone    TEXT;

CREATE INDEX idx_vessels_shipowner ON public.vessels(shipowner_id)
  WHERE shipowner_id IS NOT NULL;

COMMENT ON COLUMN public.vessels.last_zone IS
  'Cached last-known zone from Go eez detector. Values: EEZ, PORT_VICINITY, TRANSIT_LANE, INTERNATIONAL. Updated per AIS tick to detect zone-edge transitions.';
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/024_shipowners_and_mappings.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/024_shipowners_and_mappings.sql supabase/tests/migrations/024_shipowners_and_mappings.test.sql
git commit -m "feat(db): shipowners + owner_agent_mappings + vessels ext (migration 024)"
```

---

## Task 4: emission_factors + seeds

**Files:**
- Create: `supabase/migrations/025_emission_factors_and_seeds.sql`
- Create: `supabase/tests/migrations/025_emission_factors.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/025_emission_factors.test.sql`:

```sql
BEGIN;

-- Enum emission_factor_source
DO $$ BEGIN
  ASSERT (SELECT array_agg(enumlabel ORDER BY enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='emission_factor_source')
         = ARRAY['EU_MRV','IMO_CATEGORY','FALLBACK'],
    'emission_factor_source enum missing or wrong';
END $$;

-- Table
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='emission_factors' AND table_schema='public'),
    'emission_factors table missing';
END $$;

-- CHECK constraint: EU_MRV requires imo_number
DO $$ BEGIN
  BEGIN
    INSERT INTO public.emission_factors (source, grams_co2_per_nm)
    VALUES ('EU_MRV', 100);
    RAISE EXCEPTION 'check constraint should reject EU_MRV without imo_number';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.emission_factors (source, grams_co2_per_nm)
    VALUES ('IMO_CATEGORY', 100);
    RAISE EXCEPTION 'check constraint should reject IMO_CATEGORY without vessel_category';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- Seeds
DO $$ BEGIN
  ASSERT (SELECT COUNT(*) FROM public.emission_factors WHERE source='IMO_CATEGORY') >= 6,
    'IMO_CATEGORY seeds missing (expected 6+)';
  ASSERT (SELECT COUNT(*) FROM public.emission_factors WHERE source='FALLBACK') = 1,
    'FALLBACK seed missing or duplicated';
END $$;

-- Cascade lookup query: insert EU_MRV row for IMO 1234567 then verify priority
DO $$
DECLARE v_result UUID;
BEGIN
  INSERT INTO public.emission_factors (source, imo_number, grams_co2_per_nm)
  VALUES ('EU_MRV', '1234567', 50000);

  -- Simulate cascade: prefer EU_MRV for this IMO
  SELECT id INTO v_result
    FROM public.emission_factors
   WHERE active = TRUE
     AND (
       (source = 'EU_MRV' AND imo_number = '1234567') OR
       (source = 'IMO_CATEGORY' AND vessel_category = 'CARGO'
         AND 10000 BETWEEN COALESCE(gt_min,0) AND COALESCE(gt_max,9999999)) OR
       (source = 'FALLBACK')
     )
   ORDER BY CASE source WHEN 'EU_MRV' THEN 1 WHEN 'IMO_CATEGORY' THEN 2 ELSE 3 END
   LIMIT 1;

  ASSERT (SELECT source FROM public.emission_factors WHERE id = v_result) = 'EU_MRV',
    'cascade should have picked EU_MRV for matching IMO';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/025_emission_factors.test.sql
```

Expected: fails on `emission_factor_source enum missing or wrong`.

- [ ] **Step 3: Write migration 025**

Create `supabase/migrations/025_emission_factors_and_seeds.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025 : emission_factors table with cascade (EU_MRV → IMO → fallback)
-- + seeds from IMO 4th GHG Study (2020, public domain)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.emission_factor_source AS ENUM (
  'EU_MRV',       -- per-vessel actual from EU MRV THETIS dataset
  'IMO_CATEGORY', -- per category + GT range, IMO reference tables
  'FALLBACK'      -- last resort generic factor
);

CREATE TABLE public.emission_factors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            public.emission_factor_source NOT NULL,
  imo_number        TEXT,
  vessel_category   public.vessel_category,
  gt_min            INT,
  gt_max            INT,
  grams_co2_per_nm  NUMERIC(10, 3) NOT NULL CHECK (grams_co2_per_nm > 0),
  valid_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until       DATE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (source = 'EU_MRV'       AND imo_number IS NOT NULL) OR
    (source = 'IMO_CATEGORY' AND vessel_category IS NOT NULL) OR
    (source = 'FALLBACK')
  )
);

CREATE INDEX idx_ef_imo
  ON public.emission_factors(imo_number)
  WHERE imo_number IS NOT NULL AND active = TRUE;

CREATE INDEX idx_ef_cat_gt
  ON public.emission_factors(vessel_category, gt_min, gt_max)
  WHERE active = TRUE;

-- ── Seeds (IMO 4th GHG Study 2020 — conservative category averages) ─────────
INSERT INTO public.emission_factors (source, vessel_category, gt_min, gt_max, grams_co2_per_nm, notes) VALUES
  ('IMO_CATEGORY', 'TANKER',       0,      5000,    48000,  'GHG4 small tanker'),
  ('IMO_CATEGORY', 'TANKER',       5000,   60000,   120000, 'GHG4 medium tanker'),
  ('IMO_CATEGORY', 'TANKER',       60000,  200000,  280000, 'GHG4 large tanker'),
  ('IMO_CATEGORY', 'CARGO',        0,      5000,    35000,  'GHG4 small cargo'),
  ('IMO_CATEGORY', 'CARGO',        5000,   60000,   95000,  'GHG4 medium cargo'),
  ('IMO_CATEGORY', 'CARGO',        60000,  200000,  220000, 'GHG4 large cargo'),
  ('IMO_CATEGORY', 'CONTAINER',    0,      60000,   110000, 'GHG4 small/medium container'),
  ('IMO_CATEGORY', 'CONTAINER',    60000,  200000,  300000, 'GHG4 large container'),
  ('IMO_CATEGORY', 'BULK_CARRIER', 0,      200000,  100000, 'GHG4 bulk carrier'),
  ('IMO_CATEGORY', 'FERRY',        0,      999999,  70000,  'GHG4 ferry'),
  ('IMO_CATEGORY', 'NAVAL',        0,      999999,  90000,  'GHG4 naval estimate'),
  ('IMO_CATEGORY', 'SCIENTIFIC',   0,      999999,  60000,  'GHG4 scientific/research'),
  ('FALLBACK',     NULL,           NULL,   NULL,    50000,  'Conservative fallback');
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/025_emission_factors.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/025_emission_factors_and_seeds.sql supabase/tests/migrations/025_emission_factors.test.sql
git commit -m "feat(db): emission_factors cascade table + IMO GHG4 seeds (migration 025)"
```

---

## Task 5: transactions extensions (document_type enum + columns + FKs back to arrival_alerts)

**Files:**
- Create: `supabase/migrations/026_transactions_document_extensions.sql`
- Create: `supabase/tests/migrations/026_transactions_document.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/026_transactions_document.test.sql`:

```sql
BEGIN;

-- document_type enum
DO $$ BEGIN
  ASSERT (SELECT array_agg(enumlabel ORDER BY enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='document_type')
         = ARRAY['PROFORMA','FINAL','COMPLEMENT','REFUND'],
    'document_type enum missing or wrong';
END $$;

-- transaction_status extended
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='transaction_status' AND enumlabel='CREDIT_NOTE_ISSUED'
  ), 'transaction_status missing CREDIT_NOTE_ISSUED';
  ASSERT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='transaction_status' AND enumlabel='VOID'
  ), 'transaction_status missing VOID';
END $$;

-- transactions columns
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='document_type'),
    'transactions.document_type missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='arrival_alert_id'),
    'transactions.arrival_alert_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='rate_usd_per_tco2'),
    'transactions.rate_usd_per_tco2 missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='transactions' AND column_name='breakdown_json'),
    'transactions.breakdown_json missing';
END $$;

-- FKs from arrival_alerts to transactions now in place
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='arrival_alerts'
       AND constraint_type='FOREIGN KEY'
       AND constraint_name='fk_arrival_alert_proforma_txn'
  ), 'FK fk_arrival_alert_proforma_txn missing';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='arrival_alerts'
       AND constraint_type='FOREIGN KEY'
       AND constraint_name='fk_arrival_alert_final_txn'
  ), 'FK fk_arrival_alert_final_txn missing';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/026_transactions_document.test.sql
```

Expected: fails on `document_type enum missing or wrong`.

- [ ] **Step 3: Write migration 026**

Create `supabase/migrations/026_transactions_document_extensions.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 : extend transactions for pro-forma / final / complement / refund
-- + add FKs on arrival_alerts pointing back to transactions
-- ─────────────────────────────────────────────────────────────────────────────

-- document_type enum (orthogonal to existing transaction_type which stays
-- ENTRY_TAX/TRANSIT_FEE/PORT_STAY)
CREATE TYPE public.document_type AS ENUM ('PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND');

-- Extend transaction_status enum
ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'CREDIT_NOTE_ISSUED';
ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'VOID';

-- New columns on transactions
ALTER TABLE public.transactions
  ADD COLUMN document_type            public.document_type NOT NULL DEFAULT 'FINAL',
  ADD COLUMN related_transaction_id   UUID REFERENCES public.transactions(id),
  ADD COLUMN arrival_alert_id         UUID REFERENCES public.arrival_alerts(id),
  ADD COLUMN agent_profile_id         UUID REFERENCES public.profiles(id),
  ADD COLUMN shipowner_id             UUID REFERENCES public.shipowners(id),
  ADD COLUMN distance_eez_nm          NUMERIC(10, 2),
  ADD COLUMN emission_factor_used_id  UUID REFERENCES public.emission_factors(id),
  ADD COLUMN rate_usd_per_tco2        NUMERIC(10, 2) NOT NULL DEFAULT 40.00,
  ADD COLUMN breakdown_json           JSONB;

CREATE INDEX idx_txn_alert         ON public.transactions(arrival_alert_id)
  WHERE arrival_alert_id IS NOT NULL;
CREATE INDEX idx_txn_agent_status  ON public.transactions(agent_profile_id, status)
  WHERE document_type = 'PROFORMA';
CREATE INDEX idx_txn_document_type ON public.transactions(document_type, status);

-- FKs back on arrival_alerts (columns already exist from migration 023)
ALTER TABLE public.arrival_alerts
  ADD CONSTRAINT fk_arrival_alert_proforma_txn
    FOREIGN KEY (proforma_transaction_id) REFERENCES public.transactions(id),
  ADD CONSTRAINT fk_arrival_alert_final_txn
    FOREIGN KEY (final_transaction_id)    REFERENCES public.transactions(id);

COMMENT ON COLUMN public.transactions.document_type IS
  'Invoice document flavor. PROFORMA=estimate pre-arrival; FINAL=reconciled at EEZ exit; COMPLEMENT=additional charge when reconciliation exceeds pro-forma by tolerance; REFUND=credit note when reconciliation is below.';

COMMENT ON COLUMN public.transactions.breakdown_json IS
  'JSON detail: distance_nm, emission_factor_g_co2_per_nm, emission_factor_source, emission_factor_id, rate_usd_per_tco2.';
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/026_transactions_document.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/026_transactions_document_extensions.sql supabase/tests/migrations/026_transactions_document.test.sql
git commit -m "feat(db): transactions extensions + document_type enum + alert FKs (migration 026)"
```

---

## Task 6: app_config keys for carbon tax + feature flags

**Files:**
- Create: `supabase/migrations/027_app_config_carbon_tax_keys.sql`
- Create: `supabase/tests/migrations/027_app_config.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/027_app_config.test.sql`:

```sql
BEGIN;

DO $$
DECLARE required_keys TEXT[] := ARRAY[
  'carbon_tax.rate_usd_per_tco2',
  'arrival.corridor_radius_nm',
  'arrival.cancel_corridor_timeout_h',
  'arrival.claim_sla_hours',
  'arrival.escalation_eta_buffer_h',
  'reconciliation.tolerance_pct',
  'reconciliation.check_interval_min',
  'owner_escalation.delay_days',
  'owner_escalation.reminder_count',
  'proforma.languages_default',
  'proforma.email_cc_admin',
  'feature.ais_global_enabled',
  'feature.equasis_scraper_enabled',
  'feature.vessel_detention_enabled',
  'feature.shipowner_portal_enabled'
];
DECLARE k TEXT;
BEGIN
  FOREACH k IN ARRAY required_keys LOOP
    ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = k),
      format('app_config key missing: %s', k);
  END LOOP;

  -- rate is 40
  ASSERT (SELECT value::text FROM public.app_config WHERE key='carbon_tax.rate_usd_per_tco2') = '40',
    'carbon_tax.rate_usd_per_tco2 should default to 40';

  -- owner_escalation.delay_days = 7
  ASSERT (SELECT value::text FROM public.app_config WHERE key='owner_escalation.delay_days') = '7',
    'owner_escalation.delay_days should default to 7';

  -- ais_global_enabled = false (Phase 2 flag)
  ASSERT (SELECT value::text FROM public.app_config WHERE key='feature.ais_global_enabled') = 'false',
    'feature.ais_global_enabled should default to false';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/027_app_config.test.sql
```

Expected: fails on `app_config key missing: carbon_tax.rate_usd_per_tco2`.

- [ ] **Step 3: Write migration 027**

Per migration 009, `app_config` has columns `(key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ)` — there is no `description` column. This migration adds one (useful for admin UIs) and then seeds the keys.

Create `supabase/migrations/027_app_config_carbon_tax_keys.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027 : app_config description column + carbon tax keys + flags
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS description TEXT;

INSERT INTO public.app_config (key, value, description) VALUES
  -- Formula
  ('carbon_tax.rate_usd_per_tco2',       to_jsonb(40),
   'USD per tonne of CO2 (decree rate)'),

  -- Detection
  ('arrival.corridor_radius_nm',         to_jsonb(500),
   'Approach corridor radius in nautical miles around destination port'),
  ('arrival.cancel_corridor_timeout_h',  to_jsonb(168),
   'Hours before an unfired alert is cancelled (vessel never entered EEZ)'),

  -- Claim cascade
  ('arrival.claim_sla_hours',            to_jsonb(24),
   'Hours after which UNCLAIMED alert is escalated to Port Officer'),
  ('arrival.escalation_eta_buffer_h',    to_jsonb(36),
   'Only escalate when ETA is within this buffer (hours)'),

  -- Reconciliation
  ('reconciliation.tolerance_pct',       to_jsonb(10),
   'Percentage delta tolerated between pro-forma and final without adjustment'),
  ('reconciliation.check_interval_min',  to_jsonb(5),
   'Go reconcile.Tracker tick frequency in minutes'),

  -- Owner cascade
  ('owner_escalation.delay_days',        to_jsonb(7),
   'Days post-arrival before pro-forma becomes eligible for owner cascade'),
  ('owner_escalation.reminder_count',    to_jsonb(2),
   'Number of agent reminders before owner cascade is offered'),

  -- Pro-forma
  ('proforma.languages_default',         '["en","fr","ar"]'::jsonb,
   'Languages generated by default for pro-forma PDFs'),
  ('proforma.email_cc_admin',            'true'::jsonb,
   'CC finance admin on pro-forma sends'),

  -- Feature flags
  ('feature.ais_global_enabled',         'false'::jsonb,
   'Phase 2: detection at origin port departure (requires paid AIS tier)'),
  ('feature.equasis_scraper_enabled',    'false'::jsonb,
   'Phase 2: EQUASIS scraper worker (always human-validated)'),
  ('feature.vessel_detention_enabled',   'false'::jsonb,
   'Post-MVP: detention on next call workflow'),
  ('feature.shipowner_portal_enabled',   'true'::jsonb,
   'B2: invite ship owners to portal via magic link when email known')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/027_app_config.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/027_app_config_carbon_tax_keys.sql supabase/tests/migrations/027_app_config.test.sql
git commit -m "feat(db): app_config keys for carbon tax pipeline + feature flags (migration 027)"
```

---

## Task 7: pgmq queues (proforma, reconciliation, scrape)

**Files:**
- Create: `supabase/migrations/028_pgmq_queues.sql`
- Create: `supabase/tests/migrations/028_pgmq_queues.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/028_pgmq_queues.test.sql`:

```sql
BEGIN;

-- Verify queues exist (pgmq stores metadata in pgmq.meta)
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name='proforma_queue'),
    'proforma_queue not created';
  ASSERT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name='reconciliation_queue'),
    'reconciliation_queue not created';
  ASSERT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name='scrape_queue'),
    'scrape_queue not created';
END $$;

-- Round-trip: send and peek on proforma_queue
DO $$
DECLARE v_msg_id BIGINT;
BEGIN
  v_msg_id := pgmq.send('proforma_queue', '{"arrival_alert_id":"00000000-0000-0000-0000-000000000001"}'::jsonb);
  ASSERT v_msg_id IS NOT NULL AND v_msg_id > 0,
    'pgmq.send did not return a valid msg_id';

  ASSERT EXISTS (
    SELECT 1 FROM pgmq.q_proforma_queue WHERE msg_id = v_msg_id
  ), 'message not found in pgmq.q_proforma_queue';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/028_pgmq_queues.test.sql
```

Expected: fails on `proforma_queue not created`.

- [ ] **Step 3: Write migration 028**

Create `supabase/migrations/028_pgmq_queues.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028 : pgmq queues for proforma + reconciliation + scrape
-- ─────────────────────────────────────────────────────────────────────────────

-- proforma_queue     payload: { arrival_alert_id: UUID }
-- reconciliation_queue payload: { arrival_alert_id: UUID }
-- scrape_queue       payload: { imo: TEXT, priority: INT }  (Phase 2)

SELECT pgmq.create('proforma_queue');
SELECT pgmq.create('reconciliation_queue');
SELECT pgmq.create('scrape_queue');

-- Grant service_role to read/write (adjust to your RLS model if different)
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO service_role;

COMMENT ON TABLE pgmq.q_proforma_queue IS
  'Pro-forma generation jobs. Consumed by Next.js /api/queue/process-proforma.';
COMMENT ON TABLE pgmq.q_reconciliation_queue IS
  'Reconciliation jobs triggered on EEZ exit. Consumed by /api/queue/process-reconcile.';
COMMENT ON TABLE pgmq.q_scrape_queue IS
  'Phase 2: EQUASIS scrape tasks.';
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/028_pgmq_queues.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/028_pgmq_queues.sql supabase/tests/migrations/028_pgmq_queues.test.sql
git commit -m "feat(db): create pgmq queues for carbon tax pipeline (migration 028)"
```

---

## Task 8: Escalation columns on transactions + detention dormant on vessels

**Files:**
- Create: `supabase/migrations/029_escalation_columns_and_vessels_ext.sql`
- Create: `supabase/tests/migrations/029_escalation_vessels.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/029_escalation_vessels.test.sql`:

```sql
BEGIN;

-- transactions escalation columns
DO $$
DECLARE required_cols TEXT[] := ARRAY[
  'owner_escalation_due_at',
  'escalated_to_owner_at',
  'escalated_to_owner_email',
  'escalated_by'
];
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY required_cols LOOP
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='transactions' AND column_name = c),
      format('transactions.%s missing', c);
  END LOOP;
END $$;

-- Partial index for staging
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_txn_unpaid_escalation_due'
  ), 'idx_txn_unpaid_escalation_due missing';
END $$;

-- vessels detention columns (dormant)
DO $$
DECLARE required_cols TEXT[] := ARRAY[
  'detain_on_next_call','detain_reason','detain_set_by','detain_set_at'
];
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY required_cols LOOP
    ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='vessels' AND column_name = c),
      format('vessels.%s missing', c);
  END LOOP;
END $$;

-- Default for detain_on_next_call is FALSE
DO $$
DECLARE v_default TEXT;
BEGIN
  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_name='vessels' AND column_name='detain_on_next_call';
  ASSERT v_default = 'false', format('vessels.detain_on_next_call default is %s, expected false', v_default);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/029_escalation_vessels.test.sql
```

Expected: fails on `transactions.owner_escalation_due_at missing`.

- [ ] **Step 3: Write migration 029**

Create `supabase/migrations/029_escalation_columns_and_vessels_ext.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 029 : owner escalation columns + dormant detention columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.transactions
  ADD COLUMN owner_escalation_due_at  TIMESTAMPTZ,  -- staged by daily cron (eligible since)
  ADD COLUMN escalated_to_owner_at    TIMESTAMPTZ,  -- actual send timestamp
  ADD COLUMN escalated_to_owner_email TEXT,
  ADD COLUMN escalated_by             UUID REFERENCES public.profiles(id);

CREATE INDEX idx_txn_unpaid_escalation_due
  ON public.transactions(status, document_type, owner_escalation_due_at)
  WHERE status = 'PENDING' AND escalated_to_owner_at IS NULL;

COMMENT ON COLUMN public.transactions.owner_escalation_due_at IS
  'Set by pg_cron unpaid-escalation: marks pro-forma as eligible for owner cascade. NULL = not yet eligible.';
COMMENT ON COLUMN public.transactions.escalated_to_owner_at IS
  'Set by Port Officer action: actual timestamp the owner cascade email was sent.';

-- Vessels: dormant detention columns (feature-flagged post-MVP)
ALTER TABLE public.vessels
  ADD COLUMN detain_on_next_call BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN detain_reason       TEXT,
  ADD COLUMN detain_set_by       UUID REFERENCES public.profiles(id),
  ADD COLUMN detain_set_at       TIMESTAMPTZ;

CREATE INDEX idx_vessels_detain_flag
  ON public.vessels(detain_on_next_call)
  WHERE detain_on_next_call = TRUE;
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/029_escalation_vessels.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/029_escalation_columns_and_vessels_ext.sql supabase/tests/migrations/029_escalation_vessels.test.sql
git commit -m "feat(db): owner escalation columns + dormant detention (migration 029)"
```

---

## Task 9: EQUASIS scrape proposals table (dormant)

**Files:**
- Create: `supabase/migrations/030_equasis_scrape_proposals.sql`
- Create: `supabase/tests/migrations/030_equasis_scrape.test.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/030_equasis_scrape.test.sql`:

```sql
BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='equasis_scrape_proposals' AND table_schema='public'),
    'equasis_scrape_proposals table missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='equasis_scrape_proposals' AND column_name='proposed_email'),
    'equasis_scrape_proposals.proposed_email missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='equasis_scrape_proposals' AND column_name='applied'),
    'equasis_scrape_proposals.applied missing';
END $$;

-- Round-trip
DO $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.equasis_scrape_proposals (imo_number, proposed_owner_name, proposed_email)
  VALUES ('9999999', 'Some Owner Ltd', 'ops@some-owner.com')
  RETURNING id INTO v_id;

  ASSERT EXISTS (SELECT 1 FROM public.equasis_scrape_proposals WHERE id=v_id AND applied=FALSE),
    'proposal default applied should be FALSE';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/030_equasis_scrape.test.sql
```

Expected: fails on `equasis_scrape_proposals table missing`.

- [ ] **Step 3: Write migration 030**

Create `supabase/migrations/030_equasis_scrape_proposals.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030 : equasis_scrape_proposals (dormant until Phase 2)
-- Feature-flagged by app_config.feature.equasis_scraper_enabled.
-- Proposals are NEVER applied automatically — always human-validated.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.equasis_scrape_proposals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number           TEXT NOT NULL,
  shipowner_id         UUID REFERENCES public.shipowners(id),
  proposed_owner_name  TEXT,
  proposed_manager     TEXT,
  proposed_email       TEXT,
  proposed_country     TEXT,
  scraped_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by          UUID REFERENCES public.profiles(id),
  reviewed_at          TIMESTAMPTZ,
  applied              BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason      TEXT
);

CREATE INDEX idx_esp_pending
  ON public.equasis_scrape_proposals(imo_number, scraped_at DESC)
  WHERE reviewed_at IS NULL;

COMMENT ON TABLE public.equasis_scrape_proposals IS
  'Phase 2 feature (feature.equasis_scraper_enabled). Rows created by scraper worker, reviewed by Port Officer before application to shipowners.';
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/030_equasis_scrape.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/030_equasis_scrape_proposals.sql supabase/tests/migrations/030_equasis_scrape.test.sql
git commit -m "feat(db): equasis_scrape_proposals table — dormant (migration 030)"
```

---

## Task 10: SHIPOWNER role + RLS policies for new tables

**Files:**
- Create: `supabase/migrations/031_rls_carbon_tax_tables.sql`
- Create: `supabase/tests/migrations/031_rls_carbon_tax.test.sql`

Note: this is an extra migration because RLS for new tables deserves its own reviewable file, consistent with the project pattern of separating concerns per migration (see mig 004, mig 021).

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/migrations/031_rls_carbon_tax.test.sql`:

```sql
BEGIN;

-- user_role now includes SHIPOWNER
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='user_role' AND enumlabel='SHIPOWNER'
  ), 'user_role missing SHIPOWNER value';
END $$;

-- RLS enabled on new tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arrival_alerts','shipowners','owner_agent_mappings',
    'emission_factors','equasis_scrape_proposals'
  ] LOOP
    ASSERT (SELECT relrowsecurity FROM pg_class
             WHERE oid = ('public.'||t)::regclass),
      format('RLS not enabled on %s', t);
  END LOOP;
END $$;

-- At least one policy on each
DO $$
DECLARE t TEXT;
DECLARE n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arrival_alerts','shipowners','owner_agent_mappings',
    'emission_factors','equasis_scrape_proposals'
  ] LOOP
    SELECT COUNT(*) INTO n FROM pg_policies WHERE tablename=t AND schemaname='public';
    ASSERT n >= 1, format('%s has no RLS policies', t);
  END LOOP;
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/031_rls_carbon_tax.test.sql
```

Expected: fails on `user_role missing SHIPOWNER value`.

- [ ] **Step 3: Write migration 031**

The role enum is `public.user_role` with existing values PORT_OFFICER, FINANCE_ADMIN, SHIPPING_AGENT, SUPERADMIN, MANAGER (from migrations 001 + 020). This migration adds SHIPOWNER.

Create `supabase/migrations/031_rls_carbon_tax_tables.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 : RLS policies for carbon tax tables + SHIPOWNER role
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'SHIPOWNER';

-- Helper function: is caller admin?
CREATE OR REPLACE FUNCTION public.is_admin_or_officer()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role IN ('SUPERADMIN','PORT_OFFICER','FINANCE_ADMIN','MANAGER')
  );
$$;

-- ── arrival_alerts ─────────────────────────────────────────────────────────
ALTER TABLE public.arrival_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read all alerts"
  ON public.arrival_alerts FOR SELECT
  USING (public.is_admin_or_officer());

CREATE POLICY "agents read UNCLAIMED alerts"
  ON public.arrival_alerts FOR SELECT
  USING (
    status = 'UNCLAIMED'
    AND EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role = 'SHIPPING_AGENT')
  );

CREATE POLICY "agents read own claimed alerts"
  ON public.arrival_alerts FOR SELECT
  USING (matched_agent_id = auth.uid());

CREATE POLICY "admins write all alerts"
  ON public.arrival_alerts FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

-- ── shipowners ─────────────────────────────────────────────────────────────
ALTER TABLE public.shipowners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full shipowners"
  ON public.shipowners FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

CREATE POLICY "agents read shipowners"
  ON public.shipowners FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid() AND p.role = 'SHIPPING_AGENT')
  );

CREATE POLICY "shipowner reads self"
  ON public.shipowners FOR SELECT
  USING (profile_id = auth.uid());

-- ── owner_agent_mappings ───────────────────────────────────────────────────
ALTER TABLE public.owner_agent_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full mappings"
  ON public.owner_agent_mappings FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

CREATE POLICY "agent reads own mappings"
  ON public.owner_agent_mappings FOR SELECT
  USING (agent_profile_id = auth.uid());

-- ── emission_factors ───────────────────────────────────────────────────────
ALTER TABLE public.emission_factors ENABLE ROW LEVEL SECURITY;

-- Public read is fine: these are reference data.
CREATE POLICY "anyone reads factors"
  ON public.emission_factors FOR SELECT
  USING (TRUE);

CREATE POLICY "admins write factors"
  ON public.emission_factors FOR INSERT
  WITH CHECK (public.is_admin_or_officer());

CREATE POLICY "admins update factors"
  ON public.emission_factors FOR UPDATE
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

-- ── equasis_scrape_proposals (dormant, admin-only) ─────────────────────────
ALTER TABLE public.equasis_scrape_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full scrape proposals"
  ON public.equasis_scrape_proposals FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());
```

- [ ] **Step 4: Verify test passes**

```bash
supabase db reset
./supabase/tests/run.sh migrations/031_rls_carbon_tax.test.sql
```

Expected: `ROLLBACK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/031_rls_carbon_tax_tables.sql supabase/tests/migrations/031_rls_carbon_tax.test.sql
git commit -m "feat(db): SHIPOWNER role + RLS for carbon tax tables (migration 031)"
```

---

## Task 11: Foundation integration smoke test

**Files:**
- Create: `supabase/tests/migrations/foundation_integration.test.sql`

- [ ] **Step 1: Write the end-to-end smoke test**

Create `supabase/tests/migrations/foundation_integration.test.sql`:

```sql
-- End-to-end: simulates a full pro-forma row round-trip.
-- Verifies that transactions + arrival_alerts + shipowners + emission_factors
-- can be written together with all FKs satisfied.

BEGIN;

-- Disable RLS via service_role context (psql as postgres is superuser, RLS does not apply).
DO $$
DECLARE
  v_vessel UUID;
  v_owner UUID;
  v_agent UUID;
  v_alert UUID;
  v_factor UUID;
  v_txn UUID;
BEGIN
  -- Vessel (all NOT NULL columns required; see mig 003)
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999000099', '9999099', 'MV INTEGRATION TEST', 'TEST1', 'SO', 'CARGO',
            50000, 20000, 14.0, 'APPROACHING')
  RETURNING id INTO v_vessel;

  -- Shipowner (ghost)
  INSERT INTO public.shipowners (name, account_state)
  VALUES ('Integration Test Owner', 'GHOST')
  RETURNING id INTO v_owner;

  UPDATE public.vessels SET shipowner_id = v_owner WHERE id = v_vessel;

  -- Agent profile (use seeded demo shipping agent; profiles.id FK → auth.users)
  SELECT id INTO v_agent FROM public.profiles WHERE role='SHIPPING_AGENT' LIMIT 1;
  IF v_agent IS NULL THEN
    SELECT id INTO v_agent FROM public.profiles LIMIT 1;
  END IF;
  ASSERT v_agent IS NOT NULL,
    'integration test needs seeded profiles; run supabase db reset first';

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id)
  VALUES (v_owner, v_agent);

  -- Alert
  INSERT INTO public.arrival_alerts
    (vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
     estimated_route_nm, status, matched_agent_id, matched_via)
  VALUES
    (v_vessel, '9999099', 11.0, 46.0, 480, 140, 'MATCHED_AUTO', v_agent, 'AUTO_MAPPING')
  RETURNING id INTO v_alert;

  -- Emission factor (cascade pick)
  SELECT id INTO v_factor
    FROM public.emission_factors
   WHERE source='IMO_CATEGORY' AND vessel_category='CARGO'
     AND 10000 BETWEEN gt_min AND gt_max
   LIMIT 1;
  ASSERT v_factor IS NOT NULL, 'CARGO IMO_CATEGORY factor seed not found';

  -- Pro-forma transaction
  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, transaction_type, emissions_tco2, tax_amount_usd,
     status, document_type, arrival_alert_id, agent_profile_id, shipowner_id,
     distance_eez_nm, emission_factor_used_id, rate_usd_per_tco2, breakdown_json)
  VALUES
    (v_vessel, 'MV INTEGRATION TEST', '9999099', 'ENTRY_TAX', 13.3, 532.00,
     'PENDING', 'PROFORMA', v_alert, v_agent, v_owner,
     140, v_factor, 40.00,
     jsonb_build_object('distance_nm',140,'factor_g',95000,'factor_source','IMO_CATEGORY','rate',40))
  RETURNING id INTO v_txn;

  -- Link alert back
  UPDATE public.arrival_alerts
     SET status='PROFORMA_SENT', proforma_transaction_id = v_txn
   WHERE id = v_alert;

  -- Send a pgmq message
  PERFORM pgmq.send('proforma_queue', jsonb_build_object('arrival_alert_id', v_alert));

  -- Everything round-tripped cleanly
  ASSERT (SELECT status FROM public.arrival_alerts WHERE id=v_alert) = 'PROFORMA_SENT';
  ASSERT (SELECT document_type FROM public.transactions WHERE id=v_txn) = 'PROFORMA';
  ASSERT (SELECT COUNT(*) FROM pgmq.q_proforma_queue) >= 1;

  RAISE NOTICE 'Foundation integration test: all assertions passed';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run the integration test against the fully migrated DB**

```bash
supabase db reset
./supabase/tests/run.sh migrations/foundation_integration.test.sql
```

Expected: `NOTICE: Foundation integration test: all assertions passed`, `ROLLBACK`, exit 0.

- [ ] **Step 3: Run all migration tests to confirm no regressions**

```bash
for f in supabase/tests/migrations/*.test.sql; do
  echo "=== $f ==="
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done
echo "ALL MIGRATION TESTS PASSED"
```

Expected: `ALL MIGRATION TESTS PASSED`.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/migrations/foundation_integration.test.sql
git commit -m "test(db): end-to-end foundation integration smoke test"
```

---

## Task 12: Plan 1 closure — documentation + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` (append implementation status)

- [ ] **Step 1: Update spec with "Plan 1 applied" marker**

Open `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` and, just below the existing `**Status**` line (around line 4), add:

```markdown
**Plan 1 status**: Schema foundation applied — migrations 023–031 present, all migration tests green.
```

Preserve the existing content below.

- [ ] **Step 2: Run full migration suite one last time**

```bash
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}"
done
```

Expected: all pass.

- [ ] **Step 3: Final commit**

```bash
git add docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md
git commit -m "docs(spec): mark Plan 1 schema foundation as applied"
```

---

## Done criteria

Plan 1 is complete when:

1. Migrations 023–031 exist in `supabase/migrations/`.
2. `supabase db reset` applies cleanly with exit 0.
3. Every `*.test.sql` file under `supabase/tests/migrations/` passes.
4. `foundation_integration.test.sql` passes.
5. Spec document is annotated with Plan 1 status.
6. Git log shows 12 focused commits (one per task above).

Plan 2 (Go backend) can now proceed: it will consume `arrival_alerts`, `shipowners`, `emission_factors`, and `transactions.document_type` without blocking on further schema work.

---

## Spec coverage map

| Spec section | Covered by task |
|---|---|
| 5.1 Enums | Task 2 (arrival_alert_status), Task 3 (shipowner_account_state), Task 4 (emission_factor_source), Task 5 (document_type) |
| 5.2 arrival_alerts | Task 2 |
| 5.2 shipowners, owner_agent_mappings | Task 3 |
| 5.2 emission_factors | Task 4 |
| 5.2 equasis_scrape_proposals | Task 9 |
| 5.3 transactions extensions | Task 5 |
| 5.3 vessels extensions (shipowner_id, last_zone) | Task 3 |
| 5.3 vessels detention columns (dormant) | Task 8 |
| 5.3 user_role SHIPOWNER | Task 10 |
| 5.4 pgmq queues | Task 7 |
| 5.6 app_config keys | Task 6 |
| 5.8 seeds (emission_factors) | Task 4 |
| RLS for new tables | Task 10 |

Out of scope for Plan 1 (handled by later plans):
- §5.5 pg_cron job bodies (Plan 3, 4, 5 — each plan schedules its own jobs once the logic it calls exists)
- §5.7 GeoJSON polygons in `public/geo/` (Plan 2, alongside Go zone loader)
