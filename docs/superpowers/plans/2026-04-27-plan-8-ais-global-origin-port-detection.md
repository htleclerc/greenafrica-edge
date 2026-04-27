# Plan 8 — AIS Global Origin-Port Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect vessels declaring Berbera/Zeila as their AIS Destination at the origin port (1-3 weeks before EEZ entry) and create UNCLAIMED `arrival_alerts` for human review, behind `feature.ais_global_enabled`.

**Architecture:** New isolated Go module `backend/internal/originport/` with `matcher`, `cache`, `watcher`. Existing `corridor.Watcher` is untouched. AIS ingester gains a second WebSocket subscription (4 quadrants of the world, `ShipStaticData` only) gated by the feature flag. Three new migrations (042-044) plus a guard (046) on the `agent-match` cron so ORIGINPORT alerts stay UNCLAIMED. New admin page `/admin/origin-port-proposals` for reviewing fuzzy matches, with allow-list auto-enrichment.

**Tech Stack:** Go 1.25 (`gorilla/websocket`, `database/sql`, `pgx/v5`, in-package Levenshtein), PostgreSQL 17 + RLS, Next.js 16 / React 19 / TypeScript strict / TailwindCSS v4, `next-intl`, Vitest, real-DB Go integration tests via `supadb.Open`.

**Spec:** [`docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md`](../specs/2026-04-27-plan-8-ais-global-origin-port-detection.md) — read it first.

**Branch:** `feat/ais-global-v0` (already created, design commit `019b8d5` already on it).

**Conventions reused from Plans 6 & 7:**
- Migrations + tests committed together.
- Go integration tests use `supabase status` running locally; tests skip if `SUPABASE_DB_URL` unreachable.
- Server actions: `'use server'` + Zod schema + role gate via `profiles.role` + service-role client for the actual write.
- i18n namespace PascalCase: `AdminOriginPort`.
- Commit prefix: `feat(originport):` for new module, `feat(admin):` for UI, `chore(mig):` for migrations.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/043_arrival_alerts_detection_source.sql` | Add `detection_source` enum + drop NOT NULL on corridor cols + index |
| `supabase/migrations/044_destination_match_proposals.sql` | New table + RLS + unique pending index |
| `supabase/migrations/045_origin_port_allow_list_config.sql` | Seed `arrival.origin_port_allow_list` in `app_config` |
| `supabase/migrations/046_agent_match_skip_originport.sql` | Replace `agent-match` cron function to skip ORIGINPORT |
| `supabase/tests/migrations/043_detection_source.test.sql` | Mig 043 schema + backfill assertions |
| `supabase/tests/migrations/044_destination_match_proposals.test.sql` | Mig 044 RLS + index assertions |
| `supabase/tests/migrations/045_origin_port_allow_list.test.sql` | Mig 045 seed assertions |
| `supabase/tests/migrations/046_agent_match_skip_originport.test.sql` | Mig 046 function-body assertion |
| `backend/internal/originport/matcher.go` | `matchDestination()` + `Levenshtein()` + `Normalize()` |
| `backend/internal/originport/matcher_test.go` | Table-driven test, ≥30 variants |
| `backend/internal/originport/cache.go` | LRU MMSI→IMO with 24h TTL, race-safe |
| `backend/internal/originport/cache_test.go` | TTL eviction + concurrency under `-race` |
| `backend/internal/originport/watcher.go` | `OnStaticData()` orchestrator |
| `backend/internal/originport/watcher_test.go` | Real-DB integration test (parallels `corridor/watcher_test.go`) |
| `frontend/src/services/destinationProposalService.ts` | `listPendingDestinationProposals()` + types |
| `frontend/src/actions/approveDestinationProposal.ts` | Server action + Zod schema |
| `frontend/src/actions/approveDestinationProposal.test.ts` | Action regression tests |
| `frontend/src/actions/rejectDestinationProposal.ts` | Server action + Zod schema |
| `frontend/src/actions/rejectDestinationProposal.test.ts` | Action regression tests |
| `frontend/src/app/(dashboard)/admin/origin-port-proposals/page.tsx` | Server component, role gate, fetch list |
| `frontend/src/app/(dashboard)/admin/origin-port-proposals/OriginPortProposalsPanel.tsx` | Client component with table + dialogs |
| `frontend/src/i18n/messages/en/AdminOriginPort.json` | EN strings |
| `frontend/src/i18n/messages/fr/AdminOriginPort.json` | FR strings |

### Modified files

| Path | Change |
|---|---|
| `backend/internal/ais/ingester.go` | Extend `AISMessage` struct with ShipStaticData fields; dispatch to `originport.Watcher` when `MessageType=='ShipStaticData'`; second WS connection (4 quadrants) gated on `feature.ais_global_enabled` |
| `backend/cmd/api/main.go` | Wire `originport.Watcher` into `ais.NewHandler`; reads flag at boot |
| `frontend/src/components/dashboard/DashboardSidebar.tsx` | Add link to `/admin/origin-port-proposals` |
| `frontend/src/lib/rbac.ts` | Add route to RBAC matrix gated on SUPERADMIN/PORT_OFFICER/FINANCE_ADMIN |
| `frontend/src/app/(dashboard)/admin/tax-settings/TaxSettingsPanel.tsx` (or equivalent) | Add `feature.ais_global_enabled` toggle (SUPERADMIN-only) |
| `frontend/src/i18n/messages/en/AdminTaxPipeline.json` | Add labels for new toggle |
| `frontend/src/i18n/messages/fr/AdminTaxPipeline.json` | Add labels for new toggle |
| `docs/superpowers/ROADMAP.md` | Update Phase 2 row: ais_global_enabled status → "Plan 8 v0 merged" |

---

## Task 1: Migration 043 — `detection_source` enum + nullable corridor columns

**Files:**
- Create: `supabase/migrations/043_arrival_alerts_detection_source.sql`
- Create: `supabase/tests/migrations/043_detection_source.test.sql`

- [ ] **Step 1: Write the failing test**

`supabase/tests/migrations/043_detection_source.test.sql`:

```sql
BEGIN;

-- 1. detection_source enum exists with the 3 expected values
DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='detection_source' AND e.enumlabel='CORRIDOR_500NM')),
    'CORRIDOR_500NM enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='detection_source' AND e.enumlabel='ORIGINPORT')),
    'ORIGINPORT enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='detection_source' AND e.enumlabel='NOA')),
    'NOA enum value missing';
END $$;

-- 2. arrival_alerts has the new column with NOT NULL + default
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='arrival_alerts'
       AND column_name='detection_source'
       AND is_nullable='NO'
       AND column_default LIKE '%CORRIDOR_500NM%'
  ), 'detection_source column missing or wrong default';
END $$;

-- 3. corridor-specific columns are now nullable
DO $$
DECLARE col text;
BEGIN
  FOR col IN SELECT unnest(ARRAY['detected_lat','detected_lng',
                                 'distance_to_port_nm','estimated_route_nm']) LOOP
    ASSERT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='arrival_alerts'
         AND column_name=col AND is_nullable='YES'
    ), format('column %I not nullable', col);
  END LOOP;
END $$;

-- 4. originport unclaimed index exists
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND indexname='arrival_alerts_originport_unclaimed_idx'
  ), 'originport_unclaimed index missing';
END $$;

-- 5. Backfill: any historical row has detection_source set (default applies)
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM public.arrival_alerts
          WHERE detection_source IS NULL) = 0,
    'detection_source has NULLs after migration';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/043_detection_source.test.sql
```

Expected: FAIL with `relation "public.arrival_alerts" missing column "detection_source"` (or "type detection_source does not exist" depending on which assertion runs first).

- [ ] **Step 3: Write the migration**

`supabase/migrations/043_arrival_alerts_detection_source.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 043 — Plan 8: detection_source enum + nullable corridor columns
--
-- Adds a discriminator so downstream consumers (agent-match cron, admin UI)
-- can distinguish corridor-detected alerts from origin-port-detected alerts.
-- Drops NOT NULL on the four corridor-specific columns because origin-port
-- detection happens at ~3000 NM and those values aren't computed.
-- NOA is included now to avoid ALTER TYPE ADD VALUE in a future migration
-- (some Postgres configurations forbid that inside a transaction).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.detection_source AS ENUM (
  'CORRIDOR_500NM',
  'ORIGINPORT',
  'NOA'
);

ALTER TABLE public.arrival_alerts
  ADD COLUMN detection_source public.detection_source
    NOT NULL DEFAULT 'CORRIDOR_500NM',
  ALTER COLUMN detected_lat        DROP NOT NULL,
  ALTER COLUMN detected_lng        DROP NOT NULL,
  ALTER COLUMN distance_to_port_nm DROP NOT NULL,
  ALTER COLUMN estimated_route_nm  DROP NOT NULL;

-- Belt-and-braces backfill (default applies to existing rows already, but be
-- explicit so the test asserts a known state).
UPDATE public.arrival_alerts
   SET detection_source = 'CORRIDOR_500NM'
 WHERE detection_source IS NULL;

CREATE INDEX arrival_alerts_originport_unclaimed_idx
  ON public.arrival_alerts (created_at DESC)
  WHERE detection_source = 'ORIGINPORT' AND status = 'UNCLAIMED';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
supabase db reset && ./supabase/tests/run.sh migrations/043_detection_source.test.sql
```

Expected: `OK` for all 5 assertion blocks.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/043_arrival_alerts_detection_source.sql \
        supabase/tests/migrations/043_detection_source.test.sql
git commit -m "chore(mig): Plan 8 Task 1 — detection_source enum + nullable corridor cols (043)"
```

---

## Task 2: Migration 044 — `destination_match_proposals` table + RLS

**Files:**
- Create: `supabase/migrations/044_destination_match_proposals.sql`
- Create: `supabase/tests/migrations/044_destination_match_proposals.test.sql`

- [ ] **Step 1: Write the failing test**

`supabase/tests/migrations/044_destination_match_proposals.test.sql`:

```sql
BEGIN;

-- 1. Table exists with expected columns + types
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='destination_match_proposals'
  ), 'destination_match_proposals table missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='destination_match_proposals'
       AND column_name='raw_destination' AND is_nullable='NO'
  ), 'raw_destination column missing or nullable';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='destination_match_proposals'
       AND column_name='fuzzy_score' AND data_type='integer'
  ), 'fuzzy_score column missing or wrong type';
END $$;

-- 2. Status enum exists
DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='destination_proposal_status' AND e.enumlabel='PENDING')),
    'PENDING enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='destination_proposal_status' AND e.enumlabel='APPROVED')),
    'APPROVED enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='destination_proposal_status' AND e.enumlabel='REJECTED')),
    'REJECTED enum value missing';
END $$;

-- 3. RLS enabled
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.destination_match_proposals'::regclass),
    'RLS not enabled';
END $$;

-- 4. SELECT + UPDATE policies (NO INSERT policy on purpose)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='destination_match_proposals'
     AND cmd='SELECT';
  ASSERT n = 1, format('expected 1 SELECT policy, got %s', n);

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='destination_match_proposals'
     AND cmd='UPDATE';
  ASSERT n = 1, format('expected 1 UPDATE policy, got %s', n);

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='destination_match_proposals'
     AND cmd='INSERT';
  ASSERT n = 0, 'INSERT policy must not exist (service_role only)';
END $$;

-- 5. Unique partial index on (mmsi, normalized) WHERE status='PENDING'
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND indexname='destination_match_proposals_unique_pending_idx'
  ), 'unique pending index missing';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/044_destination_match_proposals.test.sql
```

Expected: FAIL — table does not exist.

- [ ] **Step 3: Write the migration**

`supabase/migrations/044_destination_match_proposals.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 044 — Plan 8: destination_match_proposals
--
-- Holds fuzzy-match candidates from the AIS Destination field that didn't
-- match the allow-list outright. Reviewed manually by SUPERADMIN/PORT_OFFICER
-- in /admin/origin-port-proposals. Approving merges the variant into
-- app_config.arrival.origin_port_allow_list.
--
-- INSERT happens only via service_role from the Go originport.Watcher;
-- humans never insert directly. SELECT/UPDATE are gated by RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.destination_proposal_status
  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE public.destination_match_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi               text NOT NULL,
  imo_number         text,
  vessel_name        text,
  raw_destination    text NOT NULL,
  normalized         text NOT NULL,
  matched_port_guess text,
  fuzzy_score        int  NOT NULL,
  status             public.destination_proposal_status NOT NULL DEFAULT 'PENDING',
  decided_by         uuid REFERENCES public.profiles(id),
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX destination_match_proposals_unique_pending_idx
  ON public.destination_match_proposals (mmsi, normalized)
  WHERE status = 'PENDING';

ALTER TABLE public.destination_match_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "officers read destination proposals"
  ON public.destination_match_proposals FOR SELECT
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('SUPERADMIN','PORT_OFFICER','FINANCE_ADMIN')
  );

CREATE POLICY "officers resolve destination proposals"
  ON public.destination_match_proposals FOR UPDATE
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('SUPERADMIN','PORT_OFFICER')
  );

-- Defence-in-depth: no INSERT policy → only service_role can insert.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
supabase db reset && ./supabase/tests/run.sh migrations/044_destination_match_proposals.test.sql
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/044_destination_match_proposals.sql \
        supabase/tests/migrations/044_destination_match_proposals.test.sql
git commit -m "chore(mig): Plan 8 Task 2 — destination_match_proposals table + RLS (044)"
```

---

## Task 3: Migration 045 — Origin port allow-list seed in `app_config`

**Files:**
- Create: `supabase/migrations/045_origin_port_allow_list_config.sql`
- Create: `supabase/tests/migrations/045_origin_port_allow_list.test.sql`

- [ ] **Step 1: Write the failing test**

`supabase/tests/migrations/045_origin_port_allow_list.test.sql`:

```sql
BEGIN;

-- 1. Allow-list key exists in app_config
DO $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.app_config
   WHERE key='arrival.origin_port_allow_list';
  ASSERT v IS NOT NULL, 'origin_port_allow_list key missing';

  -- 2. BERBERA bucket has at least 5 variants
  ASSERT jsonb_array_length(v->'BERBERA') >= 5,
    format('BERBERA expected ≥5 variants, got %s',
           jsonb_array_length(v->'BERBERA'));

  -- 3. ZEILA bucket has at least 2 variants
  ASSERT jsonb_array_length(v->'ZEILA') >= 2,
    format('ZEILA expected ≥2 variants, got %s',
           jsonb_array_length(v->'ZEILA'));

  -- 4. Canonical name is the first variant in each bucket (matcher convention)
  ASSERT v->'BERBERA'->>0 = 'BERBERA',
    'BERBERA[0] should be canonical name';
  ASSERT v->'ZEILA'->>0 = 'ZEILA',
    'ZEILA[0] should be canonical name';
END $$;

-- 5. Idempotent: re-running INSERT ... ON CONFLICT DO NOTHING shouldn't dup
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.app_config
   WHERE key='arrival.origin_port_allow_list';
  ASSERT n = 1, format('expected 1 row, got %s', n);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./supabase/tests/run.sh migrations/045_origin_port_allow_list.test.sql
```

Expected: FAIL — key not in `app_config`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/045_origin_port_allow_list_config.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 045 — Plan 8: origin port allow-list seed
--
-- Curated AIS-5 Destination variants per port. Read by the Go matcher;
-- enriched by the admin UI when approving fuzzy proposals. Idempotent via
-- ON CONFLICT DO NOTHING because hosted environments may have the key
-- already (manual injection during staging, etc).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value, description) VALUES
  ('arrival.origin_port_allow_list',
   '{
     "BERBERA": ["BERBERA","BBR","BERBA","BERBARA","SBE","SOMA BBR","SOMALILAND BERBERA"],
     "ZEILA":   ["ZEILA","ZEYLA","ZELA"]
    }'::jsonb,
   'Allow-list of AIS-5 Destination variants per port. Edited via /admin/tax-settings. Values UPPERCASE, no punctuation. Approving a fuzzy proposal auto-merges its normalized variant into this list.')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
supabase db reset && ./supabase/tests/run.sh migrations/045_origin_port_allow_list.test.sql
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/045_origin_port_allow_list_config.sql \
        supabase/tests/migrations/045_origin_port_allow_list.test.sql
git commit -m "chore(mig): Plan 8 Task 3 — origin_port_allow_list seed (045)"
```

---

## Task 4: Migration 046 — `agent-match` cron skip ORIGINPORT

**Files:**
- Read first: `supabase/migrations/034_agent_match_cron.sql` (to see the function body to replace)
- Create: `supabase/migrations/046_agent_match_skip_originport.sql`
- Create: `supabase/tests/migrations/046_agent_match_skip_originport.test.sql`

- [ ] **Step 1: Inspect the existing function**

Run: `grep -n "FROM public.arrival_alerts" supabase/migrations/034_agent_match_cron.sql`

This locates the `WHERE` clause(s) that select alerts to match. The replacement function (Step 3) will copy the existing body verbatim and add `AND detection_source != 'ORIGINPORT'` to each such WHERE.

- [ ] **Step 2: Write the failing test**

`supabase/tests/migrations/046_agent_match_skip_originport.test.sql`:

```sql
BEGIN;

-- 1. The agent_match function source contains the ORIGINPORT skip clause
DO $$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname='agent_match';
  ASSERT src IS NOT NULL, 'agent_match function missing';
  ASSERT src LIKE '%ORIGINPORT%',
    'agent_match should reference ORIGINPORT to skip it';
  ASSERT src LIKE '%detection_source%',
    'agent_match should reference detection_source';
END $$;

-- 2. Behaviour: an ORIGINPORT UNCLAIMED alert is NOT promoted to MATCHED_AUTO
--    even when an owner_agent_mappings row would match
DO $$
DECLARE
  vid uuid; oid uuid; aid uuid; alert_id uuid; new_status text;
BEGIN
  -- minimal fixture
  INSERT INTO public.shipowners (id, name, country_code)
       VALUES (gen_random_uuid(), 'Test Owner', 'SO')
       RETURNING id INTO oid;

  INSERT INTO public.profiles (id, email, role, full_name, is_active)
       VALUES (gen_random_uuid(), 'agent45@test.local', 'SHIPPING_AGENT', 'A45', true)
       RETURNING id INTO aid;

  INSERT INTO public.vessels
        (mmsi, imo_number, name, call_sign, flag_code, category,
         gross_tonnage_dwt, engine_power_kw, design_speed_knots,
         compliance_status, shipowner_id)
       VALUES ('999045001','TEST-045','MV 045','TC45','SO','CARGO',
               50000,20000,14.0,'APPROACHING', oid)
       RETURNING id INTO vid;

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_id, port_code, is_active)
       VALUES (oid, aid, 'BERBERA', true);

  INSERT INTO public.arrival_alerts
        (vessel_id, imo_number, status, detection_source)
       VALUES (vid, 'TEST-045', 'UNCLAIMED', 'ORIGINPORT')
       RETURNING id INTO alert_id;

  -- Run the cron function
  PERFORM public.agent_match();

  SELECT status::text INTO new_status FROM public.arrival_alerts WHERE id=alert_id;
  ASSERT new_status = 'UNCLAIMED',
    format('expected UNCLAIMED, got %s', new_status);
END $$;

ROLLBACK;
```

- [ ] **Step 3: Write the migration**

`supabase/migrations/046_agent_match_skip_originport.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 046 — Plan 8: agent_match cron skips ORIGINPORT
--
-- Replaces the function body from migration 034 so alerts produced by the
-- new origin-port detector stay UNCLAIMED regardless of any cascade match
-- in owner_agent_mappings. Rationale: scenario A has 1-3 weeks lead time;
-- info can change in transit; humans must confirm before pro-forma fires.
--
-- IMPORTANT: copy the EXACT body of 034's agent_match() and add
--   AND a.detection_source != 'ORIGINPORT'
-- to every WHERE clause that selects from arrival_alerts. Do NOT change
-- any other behaviour. The migration test enforces presence of the literal
-- string 'ORIGINPORT' in pg_proc.prosrc.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agent_match()
RETURNS void
LANGUAGE plpgsql
AS $$
-- COPY the body of agent_match from migration 034 here, with
-- "AND a.detection_source != 'ORIGINPORT'"
-- added to each WHERE clause that selects rows from arrival_alerts.
-- The implementing engineer should:
-- 1. Open supabase/migrations/034_agent_match_cron.sql
-- 2. Locate every "WHERE … status='DETECTED'" or similar arrival_alerts predicate
-- 3. Append "AND a.detection_source != 'ORIGINPORT'" to each
-- 4. Verify migration test passes
$$;
```

> **Note:** the actual body must be lifted from `034_agent_match_cron.sql`. Pseudocode placeholder above is the structural prompt; the engineer copies-and-tweaks during execution. Self-test (Step 4) catches incorrect copy/paste.

- [ ] **Step 4: Run test to verify it passes**

```bash
supabase db reset && ./supabase/tests/run.sh migrations/046_agent_match_skip_originport.test.sql
```

Expected: `OK` for both `prosrc` substring assertion and the behavioural assertion.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/046_agent_match_skip_originport.sql \
        supabase/tests/migrations/046_agent_match_skip_originport.test.sql
git commit -m "chore(mig): Plan 8 Task 4 — agent_match cron skips ORIGINPORT (046)"
```

---

## Task 5: Go module — `originport.matcher`

**Files:**
- Create: `backend/internal/originport/matcher.go`
- Create: `backend/internal/originport/matcher_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/originport/matcher_test.go`:

```go
package originport

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"":                     "",
		"BERBERA":              "BERBERA",
		"berbera":              "BERBERA",
		"  Berbera ":           "BERBERA",
		"BERBERA, SOMALILAND": "BERBERA SOMALILAND",
		"BBR>DJB":              "BBR DJB",
		"BBR / DJB":            "BBR DJB",
		"Berbara":              "BERBARA",
	}
	for in, want := range cases {
		got := Normalize(in)
		if got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLevenshtein(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"", "", 0},
		{"BERBERA", "BERBERA", 0},
		{"BERBARA", "BERBERA", 1},
		{"ZEYLA", "ZEILA", 2},
		{"DJIBOUTI", "BERBERA", 8},
		{"", "BERBERA", 7},
	}
	for _, c := range cases {
		if got := Levenshtein(c.a, c.b); got != c.want {
			t.Errorf("Levenshtein(%q,%q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestMatchDestination(t *testing.T) {
	allow := AllowList{
		"BERBERA": {"BERBERA", "BBR", "BERBA", "BERBARA", "SBE", "SOMA BBR", "SOMALILAND BERBERA"},
		"ZEILA":   {"ZEILA", "ZEYLA", "ZELA"},
	}
	cases := []struct {
		raw    string
		kind   MatchKind
		port   string // "" if MatchNone
		score  int    // 0 unless MatchPropose
	}{
		// Direct match in allow-list
		{"BERBERA", MatchAllow, "BERBERA", 0},
		{"berbera", MatchAllow, "BERBERA", 0},
		{"BBR", MatchAllow, "BERBERA", 0},
		{"  BBR  ", MatchAllow, "BERBERA", 0},
		{"BERBERA, SOMALILAND", MatchAllow, "BERBERA", 0},  // substring match
		{"SOMALILAND BERBERA", MatchAllow, "BERBERA", 0},
		{"ZEILA", MatchAllow, "ZEILA", 0},
		{"ZEYLA", MatchAllow, "ZEILA", 0},
		// Fuzzy proposals (Levenshtein <= 2 vs canonical name, not in allow-list)
		{"BERBERR", MatchPropose, "BERBERA", 2},   // typo, not in allow-list
		{"BARBARA", MatchPropose, "BERBERA", 2},   // 2 swaps
		{"ZELLA",   MatchPropose, "ZEILA",   2},
		// No match: unrelated ports
		{"DJIBOUTI",  MatchNone, "", 0},
		{"DJB",       MatchNone, "", 0},
		{"BOSASO",    MatchNone, "", 0},
		{"MOGADISHU", MatchNone, "", 0},
		{"DUBAI",     MatchNone, "", 0},
		// Edge cases
		{"", MatchNone, "", 0},
		{"   ", MatchNone, "", 0},
		{"???", MatchNone, "", 0},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			got := MatchDestination(c.raw, allow)
			if got.Kind != c.kind {
				t.Errorf("Kind = %v, want %v", got.Kind, c.kind)
			}
			if got.Port != c.port {
				t.Errorf("Port = %q, want %q", got.Port, c.port)
			}
			if got.Kind == MatchPropose && got.FuzzyScore != c.score {
				t.Errorf("FuzzyScore = %d, want %d", got.FuzzyScore, c.score)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && go test ./internal/originport/...
```

Expected: FAIL — `package originport: no Go files`.

- [ ] **Step 3: Write the implementation**

`backend/internal/originport/matcher.go`:

```go
// Package originport implements scenario A detection: vessels declaring
// Berbera/Zeila as their AIS-5 Destination at origin port. Gated by
// app_config.feature.ais_global_enabled. See
// docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md
package originport

import (
	"strings"
	"unicode"
)

// AllowList maps canonical port name → variants. Loaded from
// app_config.arrival.origin_port_allow_list. The first entry of each
// slice should be the canonical name itself; that ordering is asserted
// by mig 044's test.
type AllowList map[string][]string

// MatchKind discriminates the three outcomes of MatchDestination.
type MatchKind int

const (
	MatchNone    MatchKind = 0 // no match — drop silently
	MatchAllow   MatchKind = 1 // allow-list hit — INSERT arrival_alerts
	MatchPropose MatchKind = 2 // fuzzy candidate — INSERT destination_match_proposals
)

// MatchResult is the outcome of MatchDestination for a given raw input.
type MatchResult struct {
	Kind       MatchKind
	Port       string // canonical port name, "" if MatchNone
	Normalized string // post-normalization input (for logging / proposal storage)
	FuzzyScore int    // Levenshtein distance, set only when Kind=MatchPropose
}

// MatchDestination decides what to do with a raw AIS Destination string.
//
// Algorithm:
//   1. Normalize (UPPER, trim, strip non-alphanumeric except spaces, collapse spaces)
//   2. For each (port, variants) in allow, if any variant is a substring of
//      the normalized input, return MatchAllow.
//   3. Otherwise compute Levenshtein vs each canonical port name; if min
//      distance <= 2 return MatchPropose against the closest port.
//   4. Otherwise MatchNone.
func MatchDestination(raw string, allow AllowList) MatchResult {
	norm := Normalize(raw)
	if norm == "" {
		return MatchResult{Kind: MatchNone}
	}

	// Step 2: allow-list substring check
	for port, variants := range allow {
		for _, v := range variants {
			if v == "" {
				continue
			}
			if strings.Contains(norm, v) {
				return MatchResult{Kind: MatchAllow, Port: port, Normalized: norm}
			}
		}
	}

	// Step 3: fuzzy match against canonical names
	best := MatchResult{Kind: MatchNone, Normalized: norm}
	bestScore := 999
	for port := range allow {
		d := Levenshtein(norm, port)
		if d < bestScore {
			bestScore = d
			best = MatchResult{
				Kind:       MatchPropose,
				Port:       port,
				Normalized: norm,
				FuzzyScore: d,
			}
		}
	}
	if bestScore <= 2 {
		return best
	}
	return MatchResult{Kind: MatchNone, Normalized: norm}
}

// Normalize uppercases, trims, replaces non-alphanumeric with space, then
// collapses consecutive spaces. Preserves Latin letters and digits only.
func Normalize(raw string) string {
	if raw == "" {
		return ""
	}
	upper := strings.ToUpper(raw)
	var b strings.Builder
	b.Grow(len(upper))
	prevSpace := true
	for _, r := range upper {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prevSpace = false
		} else if !prevSpace {
			b.WriteRune(' ')
			prevSpace = true
		}
	}
	return strings.TrimSpace(b.String())
}

// Levenshtein returns the edit distance between a and b. O(len(a)*len(b))
// time, O(min(len(a),len(b))) space. Inlined to avoid pulling a dep.
func Levenshtein(a, b string) int {
	ar := []rune(a)
	br := []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	if len(ar) < len(br) {
		ar, br = br, ar
	}
	prev := make([]int, len(br)+1)
	curr := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		curr[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			curr[j] = min3(del, ins, sub)
		}
		prev, curr = curr, prev
	}
	return prev[len(br)]
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && go test -v ./internal/originport/...
```

Expected: all `TestNormalize`, `TestLevenshtein`, `TestMatchDestination` subtests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/originport/matcher.go \
        backend/internal/originport/matcher_test.go
git commit -m "feat(originport): Plan 8 Task 5 — destination matcher (allow-list + Levenshtein)"
```

---

## Task 6: Go module — `originport.cache`

**Files:**
- Create: `backend/internal/originport/cache.go`
- Create: `backend/internal/originport/cache_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/originport/cache_test.go`:

```go
package originport

import (
	"sync"
	"testing"
	"time"
)

func TestCache_PutGet(t *testing.T) {
	c := NewCache()
	c.Put("123456789", VesselState{IMO: "9999999", Destination: "BERBERA"})
	got, ok := c.Get("123456789")
	if !ok {
		t.Fatalf("expected hit, got miss")
	}
	if got.IMO != "9999999" || got.Destination != "BERBERA" {
		t.Errorf("got %+v", got)
	}
}

func TestCache_TTLExpiry(t *testing.T) {
	c := NewCache()
	c.now = func() time.Time { return time.Unix(1000, 0) }
	c.Put("M1", VesselState{IMO: "I1"})
	// Advance past TTL
	c.now = func() time.Time { return time.Unix(1000, 0).Add(CacheTTL + time.Second) }
	if _, ok := c.Get("M1"); ok {
		t.Errorf("expected expiry, got hit")
	}
}

func TestCache_OverwriteRefreshesTTL(t *testing.T) {
	c := NewCache()
	c.now = func() time.Time { return time.Unix(1000, 0) }
	c.Put("M1", VesselState{IMO: "I1"})
	c.now = func() time.Time { return time.Unix(1000, 0).Add(CacheTTL - time.Second) }
	c.Put("M1", VesselState{IMO: "I2"}) // overwrite
	c.now = func() time.Time { return time.Unix(1000, 0).Add(CacheTTL + time.Second) }
	got, ok := c.Get("M1")
	if !ok {
		t.Fatalf("expected hit after refresh, got miss")
	}
	if got.IMO != "I2" {
		t.Errorf("expected I2 after refresh, got %s", got.IMO)
	}
}

func TestCache_Concurrency(t *testing.T) {
	c := NewCache()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func(i int) {
			defer wg.Done()
			c.Put("M"+string(rune(i)), VesselState{IMO: "I"})
		}(i)
		go func(i int) {
			defer wg.Done()
			c.Get("M" + string(rune(i)))
		}(i)
	}
	wg.Wait()
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && go test ./internal/originport/... -run TestCache
```

Expected: FAIL — `Cache` type undefined.

- [ ] **Step 3: Write the implementation**

`backend/internal/originport/cache.go`:

```go
package originport

import (
	"sync"
	"time"
)

// CacheTTL bounds how long a vessel's last-seen static data is remembered.
// Tunable: increase if dropped messages cause many redundant alerts, decrease
// if memory grows. Measure via len(Cache.entries) periodically.
const CacheTTL = 24 * time.Hour

// VesselState is what we remember per MMSI between ShipStaticData broadcasts.
type VesselState struct {
	IMO         string
	Destination string
}

type cacheEntry struct {
	state VesselState
	at    time.Time
}

// Cache is an MMSI→VesselState store with per-entry TTL. Race-safe.
// Not strictly LRU — we don't bound size, we bound age. Memory is dominated
// by the number of distinct MMSIs seen in a 24h window (≤200k worldwide).
type Cache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry
	now     func() time.Time // injectable for tests
}

func NewCache() *Cache {
	return &Cache{
		entries: make(map[string]cacheEntry),
		now:     time.Now,
	}
}

// Put records the latest VesselState for mmsi at the current time.
// Overwrites any prior entry; refreshes TTL.
func (c *Cache) Put(mmsi string, s VesselState) {
	c.mu.Lock()
	c.entries[mmsi] = cacheEntry{state: s, at: c.now()}
	c.mu.Unlock()
}

// Get returns the cached state and true if present and within TTL.
// Expired entries are returned as miss; they remain in the map until
// overwritten or the next sweep.
func (c *Cache) Get(mmsi string) (VesselState, bool) {
	c.mu.RLock()
	e, ok := c.entries[mmsi]
	c.mu.RUnlock()
	if !ok {
		return VesselState{}, false
	}
	if c.now().Sub(e.at) > CacheTTL {
		return VesselState{}, false
	}
	return e.state, true
}

// Len returns the number of entries (expired or not). Useful for memory
// observability via expvar / log sampling.
func (c *Cache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && go test -race -v ./internal/originport/... -run TestCache
```

Expected: all 4 cache tests PASS under `-race`.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/originport/cache.go \
        backend/internal/originport/cache_test.go
git commit -m "feat(originport): Plan 8 Task 6 — MMSI vessel-state cache (24h TTL)"
```

---

## Task 7: Go module — `originport.watcher`

**Files:**
- Create: `backend/internal/originport/watcher.go`
- Create: `backend/internal/originport/watcher_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/originport/watcher_test.go` (mirrors `corridor/watcher_test.go` shape — real DB integration):

```go
package originport

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func openTestDB(t *testing.T) (*supadb.DB, func()) {
	t.Helper()
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Skipf("supadb.Open: %v (skipping; bring up local Supabase)", err)
	}
	return db, func() { db.Close() }
}

func TestWatcher_AllowMatch_CreatesUnclaimedAlert(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	// Fixture vessel
	var vesselID string
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('888777001','TEST-OP-1','MV ORIGINPORT','TO01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name=EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vesselID)

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())

	_, err = w.OnStaticData(context.Background(), StaticReport{
		MMSI:        "888777001",
		IMO:         "TEST-OP-1",
		VesselName:  "MV ORIGINPORT",
		Destination: "BERBERA",
		ETA:         time.Now().Add(7 * 24 * time.Hour),
		Lat:         1.5, // somewhere in Indian Ocean
		Lng:         100.0,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		t.Fatalf("OnStaticData: %v", err)
	}

	var status, source string
	err = db.QueryRowContext(context.Background(),
		`SELECT status::text, detection_source::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&status, &source)
	if err != nil {
		t.Fatalf("alert lookup: %v", err)
	}
	if status != "UNCLAIMED" {
		t.Errorf("status = %s, want UNCLAIMED", status)
	}
	if source != "ORIGINPORT" {
		t.Errorf("detection_source = %s, want ORIGINPORT", source)
	}
}

func TestWatcher_FuzzyMatch_CreatesProposal(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	defer db.ExecContext(context.Background(),
		`DELETE FROM public.destination_match_proposals WHERE mmsi='888777002'`)

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())

	_, err := w.OnStaticData(context.Background(), StaticReport{
		MMSI:        "888777002",
		IMO:         "TEST-OP-2",
		VesselName:  "MV FUZZY",
		Destination: "BERBARR", // 2 edits from BERBERA, NOT in allow-list
		Lat:         1.5,
		Lng:         100.0,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		t.Fatalf("OnStaticData: %v", err)
	}

	var status, port string
	var score int
	err = db.QueryRowContext(context.Background(),
		`SELECT status::text, matched_port_guess, fuzzy_score
		   FROM public.destination_match_proposals
		  WHERE mmsi='888777002' ORDER BY created_at DESC LIMIT 1`).
		Scan(&status, &port, &score)
	if err != nil {
		t.Fatalf("proposal lookup: %v", err)
	}
	if status != "PENDING" {
		t.Errorf("status = %s, want PENDING", status)
	}
	if port != "BERBERA" {
		t.Errorf("port = %s, want BERBERA", port)
	}
	if score < 1 || score > 2 {
		t.Errorf("score = %d, want 1 or 2", score)
	}
}

func TestWatcher_FlagOff_NoOp(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	// Force the flag off
	_, err := db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='false'::jsonb
		  WHERE key='feature.ais_global_enabled'`)
	if err != nil {
		t.Fatalf("flag setup: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='false'::jsonb
		  WHERE key='feature.ais_global_enabled'`)

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())
	_, err = w.OnStaticData(context.Background(), StaticReport{
		MMSI: "x", IMO: "y", Destination: "BERBERA", RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("OnStaticData with flag off should be no-op, got error: %v", err)
	}
}

func TestWatcher_EmptyIMO_Drop(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()
	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())
	id, err := w.OnStaticData(context.Background(), StaticReport{
		MMSI: "x", IMO: "", Destination: "BERBERA", RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "" {
		t.Errorf("expected empty id (drop), got %q", id)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && go test -v ./internal/originport/... -run TestWatcher
```

Expected: FAIL — `Watcher` and `StaticReport` undefined.

- [ ] **Step 3: Write the implementation**

`backend/internal/originport/watcher.go`:

```go
package originport

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
)

// StaticReport is the subset of an AIS-5 ShipStaticData message that the
// origin-port detector needs.
type StaticReport struct {
	MMSI        string
	IMO         string
	VesselName  string
	Destination string
	ETA         time.Time // already decoded from MMDDHHMM by caller
	Lat         float64   // current MetaData lat (last known position)
	Lng         float64
	RecordedAt  time.Time
}

// Watcher orchestrates allow-list match → arrival_alerts vs fuzzy → proposals.
// Reads feature.ais_global_enabled and arrival.origin_port_allow_list from
// app_config (cached for 60s by appconfig.Reader).
type Watcher struct {
	db    *sql.DB
	cfg   *appconfig.Reader
	cache *Cache
}

func NewWatcher(db *sql.DB, cfg *appconfig.Reader, cache *Cache) *Watcher {
	return &Watcher{db: db, cfg: cfg, cache: cache}
}

// OnStaticData processes one ShipStaticData report. Returns the alert id on
// success path, "" otherwise (drop, propose, dedup, flag-off all return "").
func (w *Watcher) OnStaticData(ctx context.Context, r StaticReport) (string, error) {
	enabled, err := w.cfg.GetBool(ctx, "feature.ais_global_enabled")
	if err != nil {
		return "", fmt.Errorf("originport: read flag: %w", err)
	}
	if !enabled {
		return "", nil
	}
	if r.IMO == "" {
		return "", nil
	}

	// Skip if we already saw this MMSI with the same Destination recently.
	if prev, ok := w.cache.Get(r.MMSI); ok && prev.Destination == strings.ToUpper(strings.TrimSpace(r.Destination)) {
		return "", nil
	}

	allow, err := w.loadAllowList(ctx)
	if err != nil {
		return "", fmt.Errorf("originport: load allow-list: %w", err)
	}

	res := MatchDestination(r.Destination, allow)
	switch res.Kind {
	case MatchAllow:
		alertID, ierr := w.insertAlert(ctx, r, res)
		if ierr != nil {
			return "", ierr
		}
		w.cache.Put(r.MMSI, VesselState{IMO: r.IMO, Destination: res.Normalized})
		return alertID, nil

	case MatchPropose:
		if perr := w.insertProposal(ctx, r, res); perr != nil {
			return "", perr
		}
		// Don't cache — we want re-evaluation if Destination changes.
		return "", nil

	default: // MatchNone
		// Cache anyway to suppress re-evaluation of a known-irrelevant Destination.
		w.cache.Put(r.MMSI, VesselState{IMO: r.IMO, Destination: res.Normalized})
		return "", nil
	}
}

func (w *Watcher) loadAllowList(ctx context.Context) (AllowList, error) {
	var raw json.RawMessage
	if err := w.db.QueryRowContext(ctx,
		`SELECT value FROM public.app_config WHERE key='arrival.origin_port_allow_list'`).
		Scan(&raw); err != nil {
		return nil, err
	}
	var al AllowList
	if err := json.Unmarshal(raw, &al); err != nil {
		return nil, err
	}
	return al, nil
}

func (w *Watcher) insertAlert(ctx context.Context, r StaticReport, res MatchResult) (string, error) {
	var vesselID string
	if err := w.db.QueryRowContext(ctx,
		`SELECT id FROM public.vessels WHERE mmsi=$1 LIMIT 1`, r.MMSI).Scan(&vesselID); err != nil {
		if err == sql.ErrNoRows {
			return "", nil // vessel not in our DB yet — drop quietly
		}
		return "", err
	}

	var alertID string
	err := w.db.QueryRowContext(ctx, `
		INSERT INTO public.arrival_alerts
		  (vessel_id, imo_number, status, detection_source,
		   detected_lat, detected_lng, estimated_eta)
		VALUES ($1, $2, 'UNCLAIMED', 'ORIGINPORT', $3, $4, $5)
		RETURNING id
	`, vesselID, r.IMO, r.Lat, r.Lng, r.ETA).Scan(&alertID)
	if err != nil {
		// Existing partial unique idx on (vessel_id) WHERE status NOT IN
		// ('RECONCILED','CANCELLED') silently absorbs a 2nd active alert.
		if isUniqueViolation(err) {
			return "", nil
		}
		return "", fmt.Errorf("originport: insert alert: %w", err)
	}
	return alertID, nil
}

func (w *Watcher) insertProposal(ctx context.Context, r StaticReport, res MatchResult) error {
	_, err := w.db.ExecContext(ctx, `
		INSERT INTO public.destination_match_proposals
		  (mmsi, imo_number, vessel_name, raw_destination, normalized,
		   matched_port_guess, fuzzy_score, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
		ON CONFLICT (mmsi, normalized)
		  WHERE status='PENDING' DO NOTHING
	`, r.MMSI, r.IMO, r.VesselName, r.Destination, res.Normalized,
		res.Port, res.FuzzyScore)
	if err != nil {
		return fmt.Errorf("originport: insert proposal: %w", err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint")
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
supabase start  # if not already running
cd backend && go test -v ./internal/originport/... -run TestWatcher
```

Expected: 4 watcher tests PASS (allow match → alert, fuzzy → proposal, flag off → no-op, empty IMO → drop).

- [ ] **Step 5: Commit**

```bash
git add backend/internal/originport/watcher.go \
        backend/internal/originport/watcher_test.go
git commit -m "feat(originport): Plan 8 Task 7 — OnStaticData watcher (allow→alert, fuzzy→proposal)"
```

---

## Task 8: Extend `ais.AISMessage` for `ShipStaticData`

**Files:**
- Modify: `backend/internal/ais/ingester.go` (add ShipStaticData fields to AISMessage struct)
- Create: `backend/internal/ais/ingester_static_test.go`

- [ ] **Step 1: Write the failing test**

`backend/internal/ais/ingester_static_test.go`:

```go
package ais

import (
	"encoding/json"
	"testing"
)

// Sample payload from aisstream.io for MessageType=ShipStaticData.
// Real shape may carry many more fields; we only assert the ones
// the originport.Watcher needs.
const staticDataSample = `{
  "MessageType": "ShipStaticData",
  "MetaData": {
    "MMSI": 123456789,
    "MMSI_String": "123456789",
    "ShipName": "MV TESTSHIP",
    "latitude": 1.234,
    "longitude": 100.567,
    "time_utc": "2026-04-27 10:00:00 +0000 UTC"
  },
  "Message": {
    "ShipStaticData": {
      "ImoNumber": 9999999,
      "Destination": "BERBERA",
      "Eta": {"Month": 5, "Day": 12, "Hour": 14, "Minute": 30}
    }
  }
}`

func TestParseShipStaticData(t *testing.T) {
	var msg AISMessage
	if err := json.Unmarshal([]byte(staticDataSample), &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.MessageType != "ShipStaticData" {
		t.Fatalf("wrong MessageType: %s", msg.MessageType)
	}
	if msg.Message.ShipStaticData == nil {
		t.Fatalf("ShipStaticData not parsed")
	}
	s := msg.Message.ShipStaticData
	if s.ImoNumber != 9999999 {
		t.Errorf("ImoNumber = %d, want 9999999", s.ImoNumber)
	}
	if s.Destination != "BERBERA" {
		t.Errorf("Destination = %q, want BERBERA", s.Destination)
	}
	if s.Eta.Month != 5 || s.Eta.Day != 12 {
		t.Errorf("Eta = %+v", s.Eta)
	}
}

func TestDecodeETA_PastMonthRollsToNextYear(t *testing.T) {
	// If we're in May 2026 and ETA says April 1, that means April 2027.
	now := mustParse("2026-05-15T00:00:00Z")
	got := DecodeETA(AISETAField{Month: 4, Day: 1, Hour: 12, Minute: 0}, now)
	if got.Year() != 2027 {
		t.Errorf("year = %d, want 2027 (rollover)", got.Year())
	}
}

func TestDecodeETA_FutureMonthSameYear(t *testing.T) {
	now := mustParse("2026-05-15T00:00:00Z")
	got := DecodeETA(AISETAField{Month: 11, Day: 20, Hour: 0, Minute: 0}, now)
	if got.Year() != 2026 || got.Month() != 11 {
		t.Errorf("got %s, want 2026-11", got.Format("2006-01"))
	}
}

func TestDecodeETA_InvalidFieldsReturnsZero(t *testing.T) {
	// AIS-5 sentinels for "not available": Month=0, Day=0
	got := DecodeETA(AISETAField{Month: 0, Day: 0, Hour: 24, Minute: 60}, mustParse("2026-05-15T00:00:00Z"))
	if !got.IsZero() {
		t.Errorf("expected zero time for sentinel input, got %s", got)
	}
}

func mustParse(s string) (t timeUnix) {
	parsed, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return timeUnix(parsed)
}

type timeUnix = time.Time
```

> Note: the `import "time"` and `timeUnix` shim is mildly ugly but keeps the test file self-contained. Engineer can clean up the import alias when adding the Go file.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && go test ./internal/ais/... -run "TestParseShipStaticData|TestDecodeETA"
```

Expected: FAIL — `AISETAField` undefined; `Message.ShipStaticData` field missing.

- [ ] **Step 3: Modify `ingester.go` — extend AISMessage struct, add DecodeETA**

In `backend/internal/ais/ingester.go`, replace the existing `AISMessage` definition with:

```go
// AIS message from aisstream.io. Two MessageType values are handled:
//   - "PositionReport" — Lat/Lng/SOG (existing corridor + EEZ path)
//   - "ShipStaticData" — IMO/Destination/ETA (Plan 8 origin-port detection)
type AISMessage struct {
	MessageType string `json:"MessageType"`
	MetaData    struct {
		MMSI      int     `json:"MMSI"`
		MMSIStr   string  `json:"MMSI_String"`
		ShipName  string  `json:"ShipName"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		TimeUTC   string  `json:"time_utc"`
	} `json:"MetaData"`
	Message struct {
		PositionReport *struct {
			Cog         float64 `json:"Cog"`
			Sog         float64 `json:"Sog"`
			TrueHeading int     `json:"TrueHeading"`
		} `json:"PositionReport"`
		ShipStaticData *struct {
			ImoNumber   int           `json:"ImoNumber"`
			Destination string        `json:"Destination"`
			Eta         AISETAField   `json:"Eta"`
			CallSign    string        `json:"CallSign"`
			Type        int           `json:"Type"`
			MaximumStaticDraught float64 `json:"MaximumStaticDraught"`
		} `json:"ShipStaticData"`
	} `json:"Message"`
}

// AISETAField mirrors aisstream.io's ETA payload (4 ints, no year).
type AISETAField struct {
	Month  int `json:"Month"`
	Day    int `json:"Day"`
	Hour   int `json:"Hour"`
	Minute int `json:"Minute"`
}

// DecodeETA turns an AIS-5 ETA (no year) into an absolute UTC time using
// "if past, roll to next year" heuristic. Returns zero time if any field
// is sentinel-invalid (Month==0, Day==0, Hour>23, Minute>59).
func DecodeETA(eta AISETAField, now time.Time) time.Time {
	if eta.Month == 0 || eta.Day == 0 || eta.Hour > 23 || eta.Minute > 59 ||
		eta.Month < 1 || eta.Month > 12 || eta.Day < 1 || eta.Day > 31 {
		return time.Time{}
	}
	year := now.UTC().Year()
	candidate := time.Date(year, time.Month(eta.Month), eta.Day,
		eta.Hour, eta.Minute, 0, 0, time.UTC)
	if candidate.Before(now.UTC()) {
		candidate = candidate.AddDate(1, 0, 0)
	}
	return candidate
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && go test -v ./internal/ais/... -run "TestParseShipStaticData|TestDecodeETA"
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/ais/ingester.go \
        backend/internal/ais/ingester_static_test.go
git commit -m "feat(ais): Plan 8 Task 8 — parse ShipStaticData + ETA decoder"
```

---

## Task 9: Dual-WS dispatcher in `ais.Ingester`

**Files:**
- Modify: `backend/internal/ais/ingester.go` (add 2nd WS goroutine for global ShipStaticData, conditioned on flag)

- [ ] **Step 1: Write the failing integration test**

The dual-WS path is hard to unit-test (needs aisstream.io). Add a regression test that asserts the dispatcher routes `ShipStaticData` to `originport.Watcher` and `PositionReport` to `corridor.Watcher`.

Append to `backend/internal/ais/ingester_static_test.go`:

```go
func TestDispatchByMessageType(t *testing.T) {
	var routedTo string
	dispatch := func(msg AISMessage,
		onPosition func(AISMessage),
		onStatic func(AISMessage)) {
		switch msg.MessageType {
		case "PositionReport":
			onPosition(msg)
		case "ShipStaticData":
			onStatic(msg)
		}
	}
	for _, c := range []struct {
		msgType string
		want    string
	}{
		{"PositionReport", "corridor"},
		{"ShipStaticData", "originport"},
		{"unknown", ""},
	} {
		routedTo = ""
		dispatch(AISMessage{MessageType: c.msgType},
			func(AISMessage) { routedTo = "corridor" },
			func(AISMessage) { routedTo = "originport" })
		if routedTo != c.want {
			t.Errorf("MessageType=%s routed to %q, want %q", c.msgType, routedTo, c.want)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it passes (this test exercises only local dispatch — the production wiring follows in Step 3)**

```bash
cd backend && go test -v ./internal/ais/... -run TestDispatchByMessageType
```

Expected: PASS (it exercises a local closure, asserts the pattern). The production wiring change (Step 3) inserts the same shape into `Ingester.run()`.

- [ ] **Step 3: Modify `ingester.go` — add originport.Watcher dependency + dual-connection dispatcher**

In `backend/internal/ais/ingester.go`:

1. Add `"github.com/htleclerc/africgreen/backend/internal/originport"` to imports.

2. Extend the `Ingester` struct:

```go
type Ingester struct {
	cfg     *config.Config
	db      *sql.DB
	watcher *corridor.Watcher
	tracker *eez.Tracker
	originport *originport.Watcher // NEW
	mu      sync.Mutex
	running bool
	stopCh  chan struct{}
	done    chan struct{}
	ctx     context.Context
	cancel  context.CancelFunc
	stats   Stats
}
```

3. Update `NewIngesterWithDeps` signature:

```go
func NewIngesterWithDeps(cfg *config.Config, db *sql.DB,
	watcher *corridor.Watcher, tracker *eez.Tracker,
	op *originport.Watcher) *Ingester {
	return &Ingester{
		cfg:        cfg,
		db:         db,
		watcher:    watcher,
		tracker:    tracker,
		originport: op,
		stopCh:     make(chan struct{}),
	}
}
```

4. Update `NewHandler` signature similarly:

```go
func NewHandler(cfg *config.Config, db *sql.DB,
	watcher *corridor.Watcher, tracker *eez.Tracker,
	op *originport.Watcher) *Handler {
	return &Handler{
		ingester: NewIngesterWithDeps(cfg, db, watcher, tracker, op),
	}
}
```

5. Refactor `run()` to spawn TWO `connect()` goroutines: one regional (PositionReport — existing), one global (ShipStaticData — Plan 8). Replace the existing `run()` with:

```go
func (ing *Ingester) run() {
	regionalDone := make(chan struct{})
	go func() {
		defer close(regionalDone)
		ing.runOne(connectRegional)
	}()

	// Global ShipStaticData connection only spins up if the flag is on.
	// We re-check every 60s in case an admin toggles it.
	globalDone := make(chan struct{})
	go func() {
		defer close(globalDone)
		ing.runGlobalConditional()
	}()

	<-regionalDone
	<-globalDone
}
```

Then add the helpers (replace the existing single-`connect` body with two specialized variants):

```go
type subscribeFn func(*websocket.Conn, *config.Config) error

func connectRegional(conn *websocket.Conn, cfg *config.Config) error {
	sub := map[string]any{
		"APIKey": cfg.AISStreamAPIKey,
		"BoundingBoxes": [][]any{
			{[]float64{5.0, 40.0}, []float64{25.0, 75.0}},
		},
		"FilterMessageTypes": []string{"PositionReport"},
	}
	return conn.WriteJSON(sub)
}

func connectGlobalStatic(conn *websocket.Conn, cfg *config.Config) error {
	// 4 quadrants of the world. Avoids a single [-90,-180]–[90,180] bbox
	// in case aisstream.io has any edge-case behaviour.
	sub := map[string]any{
		"APIKey": cfg.AISStreamAPIKey,
		"BoundingBoxes": [][]any{
			{[]float64{-90.0, -180.0}, []float64{0.0, 0.0}},
			{[]float64{-90.0, 0.0},    []float64{0.0, 180.0}},
			{[]float64{0.0,  -180.0}, []float64{90.0, 0.0}},
			{[]float64{0.0,   0.0},    []float64{90.0, 180.0}},
		},
		"FilterMessageTypes": []string{"ShipStaticData"},
	}
	return conn.WriteJSON(sub)
}

func (ing *Ingester) runOne(sub subscribeFn) {
	for {
		select {
		case <-ing.stopCh:
			return
		default:
			if err := ing.connectAndRead(sub); err != nil {
				log.Printf("[AIS] Connection error: %v. Reconnecting in 5s...", err)
				ing.mu.Lock()
				ing.stats.Errors++
				ing.mu.Unlock()
				select {
				case <-ing.stopCh:
					return
				case <-time.After(5 * time.Second):
				}
			}
		}
	}
}

func (ing *Ingester) runGlobalConditional() {
	tick := time.NewTicker(60 * time.Second)
	defer tick.Stop()
	var globalCancel context.CancelFunc
	for {
		select {
		case <-ing.stopCh:
			if globalCancel != nil {
				globalCancel()
			}
			return
		case <-tick.C:
			enabled := false
			if ing.originport != nil {
				// Cheap flag read via originport's reader. Errors → treat as disabled.
				if v, err := readGlobalFlag(ing.ctx, ing.db); err == nil {
					enabled = v
				}
			}
			if enabled && globalCancel == nil {
				ctx, cancel := context.WithCancel(ing.ctx)
				globalCancel = cancel
				go ing.runOneCtx(ctx, connectGlobalStatic)
				log.Println("[AIS] Global ShipStaticData connection: ON")
			} else if !enabled && globalCancel != nil {
				globalCancel()
				globalCancel = nil
				log.Println("[AIS] Global ShipStaticData connection: OFF")
			}
		}
	}
}

func (ing *Ingester) runOneCtx(ctx context.Context, sub subscribeFn) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
			if err := ing.connectAndRead(sub); err != nil {
				log.Printf("[AIS] Connection error (global): %v. Reconnecting in 5s...", err)
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
		}
	}
}

func readGlobalFlag(ctx context.Context, db *sql.DB) (bool, error) {
	var raw []byte
	if err := db.QueryRowContext(ctx,
		`SELECT value FROM public.app_config
		  WHERE key='feature.ais_global_enabled'`).Scan(&raw); err != nil {
		return false, err
	}
	return string(raw) == "true", nil
}
```

6. Refactor the existing `connect()` body into `connectAndRead(sub subscribeFn)`. The dispatch on `MessageType` happens inside the read loop. Replace `connect()` with:

```go
func (ing *Ingester) connectAndRead(sub subscribeFn) error {
	conn, _, err := websocket.DefaultDialer.Dial("wss://stream.aisstream.io/v0/stream", nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	if err := sub(conn, ing.cfg); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	log.Println("[AIS] Connected to aisstream.io")

	for {
		select {
		case <-ing.stopCh:
			return nil
		default:
		}
		conn.SetReadDeadline(time.Now().Add(5 * time.Minute))
		_, rawMsg, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("read: %w", err)
		}
		var msg AISMessage
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			continue
		}
		if msg.MetaData.MMSIStr == "" {
			continue
		}

		ing.mu.Lock()
		ing.stats.MessagesTotal++
		ing.stats.LastMessageAt = time.Now()
		ing.mu.Unlock()

		switch msg.MessageType {
		case "PositionReport":
			ing.handlePositionReport(msg)
		case "ShipStaticData":
			ing.handleStaticData(msg)
		}
	}
}
```

7. Move the existing position-handling body into a helper (preserves all current side effects — vessel upsert + position insert + corridor + EEZ hooks):

```go
func (ing *Ingester) handlePositionReport(msg AISMessage) {
	// [unchanged: copy the body of the previous read loop's
	//  vessel upsert + lookupVessel + INSERT vessel_position +
	//  corridor.Evaluate + eez.OnPosition calls verbatim]
}
```

8. Add the new static-data handler:

```go
func (ing *Ingester) handleStaticData(msg AISMessage) {
	if ing.originport == nil || msg.Message.ShipStaticData == nil {
		return
	}
	s := msg.Message.ShipStaticData
	imo := ""
	if s.ImoNumber > 0 {
		imo = fmt.Sprintf("%d", s.ImoNumber)
	}
	hookCtx := ing.ctx
	if hookCtx == nil {
		hookCtx = context.Background()
	}
	_, err := ing.originport.OnStaticData(hookCtx, originport.StaticReport{
		MMSI:        msg.MetaData.MMSIStr,
		IMO:         imo,
		VesselName:  msg.MetaData.ShipName,
		Destination: s.Destination,
		ETA:         DecodeETA(s.Eta, time.Now().UTC()),
		Lat:         msg.MetaData.Latitude,
		Lng:         msg.MetaData.Longitude,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		log.Printf("[AIS] originport.OnStaticData: %v", err)
	}
}
```

- [ ] **Step 4: Run all AIS tests + build**

```bash
cd backend && go build ./... && go test -race ./internal/ais/... ./internal/originport/...
```

Expected: build OK, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/ais/ingester.go backend/internal/ais/ingester_static_test.go
git commit -m "feat(ais): Plan 8 Task 9 — dual-WS dispatcher (regional dynamic + global static gated)"
```

---

## Task 10: Wire `originport.Watcher` into `cmd/api/main.go`

**Files:**
- Modify: `backend/cmd/api/main.go` (construct originport.Watcher, pass to ais.NewHandler)

- [ ] **Step 1: Read the existing main.go to find where corridor.Watcher is constructed**

```bash
grep -n "corridor.New\|ais.NewHandler" backend/cmd/api/main.go
```

- [ ] **Step 2: Modify `main.go`**

Add the import:

```go
"github.com/htleclerc/africgreen/backend/internal/originport"
```

Find the block that builds `corridor.Watcher` and the `ais.NewHandler` call. Insert the originport construction between them and pass it through:

```go
corrWatcher := corridor.New(db, cfgReader)
opCache := originport.NewCache()
opWatcher := originport.NewWatcher(db, cfgReader, opCache)
aisHandler := ais.NewHandler(cfg, db, corrWatcher, eezTracker, opWatcher)
```

- [ ] **Step 3: Run build + smoke**

```bash
cd backend && go build ./cmd/api && go run ./cmd/api &
sleep 2 && curl -s http://localhost:8080/health && kill %1
```

Expected: `{"status":"ok"}` (or whatever the existing health endpoint returns), no nil-pointer crash on boot.

- [ ] **Step 4: Verify originport tests still pass after wiring**

```bash
cd backend && go test ./...
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/cmd/api/main.go
git commit -m "feat(api): Plan 8 Task 10 — wire originport.Watcher into ais handler"
```

---

## Task 11: Server actions — approve / reject destination proposals

**Files:**
- Create: `frontend/src/services/destinationProposalService.ts`
- Create: `frontend/src/actions/approveDestinationProposal.ts`
- Create: `frontend/src/actions/approveDestinationProposal.test.ts`
- Create: `frontend/src/actions/rejectDestinationProposal.ts`
- Create: `frontend/src/actions/rejectDestinationProposal.test.ts`

- [ ] **Step 1: Write the failing tests for both actions**

`frontend/src/actions/approveDestinationProposal.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMock = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
};
const adminMock = { from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => supabaseMock),
}));
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => adminMock),
}));

import { approveDestinationProposal } from './approveDestinationProposal';

describe('approveDestinationProposal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv-test';
        supabaseMock.auth.getUser.mockResolvedValue({
            data: { user: { id: 'u1' } },
        });
    });

    it('rejects unauthenticated callers', async () => {
        supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-1111-1111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r).toEqual({ ok: false, reason: 'not authenticated' });
    });

    it('rejects callers without SUPERADMIN/PORT_OFFICER role', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({
                        data: { role: 'SHIPPING_AGENT', full_name: 'A' },
                    }),
                }),
            }),
        });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-1111-1111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r).toEqual({ ok: false, reason: 'insufficient role' });
    });

    it('rejects non-PENDING proposals', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { role: 'PORT_OFFICER' } }),
                }),
            }),
        });
        adminMock.from.mockImplementation((table: string) => {
            if (table === 'destination_match_proposals') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: { id: 'p1', status: 'APPROVED', normalized: 'BBR', mmsi: 'M' },
                            }),
                        }),
                    }),
                };
            }
            return {};
        });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-1111-1111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r).toEqual({ ok: false, reason: 'proposal not pending' });
    });

    it('happy path: updates proposal + merges allow-list (idempotent)', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { role: 'PORT_OFFICER' } }),
                }),
            }),
        });
        let updateCalled = false;
        let configRead = false;
        let configUpdated = false;
        adminMock.from.mockImplementation((table: string) => {
            if (table === 'destination_match_proposals') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: {
                                    id: 'p1',
                                    status: 'PENDING',
                                    normalized: 'NEWVAR',
                                    mmsi: 'M',
                                    matched_port_guess: 'BERBERA',
                                },
                            }),
                        }),
                    }),
                    update: () => ({
                        eq: async () => {
                            updateCalled = true;
                            return { error: null };
                        },
                    }),
                };
            }
            if (table === 'app_config') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => {
                                configRead = true;
                                return {
                                    data: {
                                        value: { BERBERA: ['BERBERA', 'BBR'], ZEILA: ['ZEILA'] },
                                    },
                                };
                            },
                        }),
                    }),
                    update: () => ({
                        eq: async () => {
                            configUpdated = true;
                            return { error: null };
                        },
                    }),
                };
            }
            return {};
        });
        const r = await approveDestinationProposal({
            proposalId: '11111111-1111-1111-1111-111111111111',
            port: 'BERBERA',
            addToAllowList: true,
            createAlert: false,
        });
        expect(r.ok).toBe(true);
        expect(updateCalled).toBe(true);
        expect(configRead).toBe(true);
        expect(configUpdated).toBe(true);
    });
});
```

`frontend/src/actions/rejectDestinationProposal.test.ts`: analogous, with shorter coverage:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMock = { auth: { getUser: vi.fn() }, from: vi.fn() };
const adminMock = { from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => supabaseMock),
}));
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => adminMock),
}));

import { rejectDestinationProposal } from './rejectDestinationProposal';

describe('rejectDestinationProposal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv-test';
        supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    });

    it('rejects insufficient role', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { role: 'SHIPPING_AGENT' } }),
                }),
            }),
        });
        const r = await rejectDestinationProposal({
            proposalId: '11111111-1111-1111-1111-111111111111',
            note: 'wrong port',
        });
        expect(r).toEqual({ ok: false, reason: 'insufficient role' });
    });

    it('happy path: marks REJECTED with note', async () => {
        supabaseMock.from.mockReturnValue({
            select: () => ({
                eq: () => ({ single: async () => ({ data: { role: 'PORT_OFFICER' } }) }),
            }),
        });
        let updated = false;
        adminMock.from.mockImplementation(() => ({
            update: () => ({
                eq: async () => {
                    updated = true;
                    return { error: null };
                },
            }),
        }));
        const r = await rejectDestinationProposal({
            proposalId: '11111111-1111-1111-1111-111111111111',
            note: 'wrong port',
        });
        expect(r.ok).toBe(true);
        expect(updated).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/actions/approveDestinationProposal.test.ts src/actions/rejectDestinationProposal.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Write the service + actions**

`frontend/src/services/destinationProposalService.ts`:

```typescript
import { createClient as createServiceRole } from '@supabase/supabase-js';

export type DestinationProposal = {
    id: string;
    mmsi: string;
    imo_number: string | null;
    vessel_name: string | null;
    raw_destination: string;
    normalized: string;
    matched_port_guess: string | null;
    fuzzy_score: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    created_at: string;
};

export async function listPendingDestinationProposals(): Promise<DestinationProposal[]> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('supabase service role not configured');
    const admin = createServiceRole(url, key, { auth: { persistSession: false } });
    const { data, error } = await admin
        .from('destination_match_proposals')
        .select(
            'id, mmsi, imo_number, vessel_name, raw_destination, normalized, matched_port_guess, fuzzy_score, status, created_at',
        )
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data as DestinationProposal[];
}
```

`frontend/src/actions/approveDestinationProposal.ts`:

```typescript
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

const schema = z.object({
    proposalId: z.string().uuid(),
    port: z.enum(['BERBERA', 'ZEILA']),
    addToAllowList: z.boolean().default(true),
    createAlert: z.boolean().default(true),
    note: z.string().optional(),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'PORT_OFFICER'] as const;

export type ApproveDestinationProposalResult =
    | { ok: true; allowListUpdated: boolean; alertCreated: boolean }
    | { ok: false; reason: string };

export async function approveDestinationProposal(
    raw: unknown,
): Promise<ApproveDestinationProposalResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { ok: false, reason: 'service role not configured' };
    const admin = createServiceRole(url, key, { auth: { persistSession: false } });

    // 1. Load proposal, ensure PENDING
    const { data: proposal } = await admin
        .from('destination_match_proposals')
        .select('id, status, normalized, mmsi, matched_port_guess')
        .eq('id', parsed.data.proposalId)
        .single();
    if (!proposal) return { ok: false, reason: 'proposal not found' };
    if (proposal.status !== 'PENDING') {
        return { ok: false, reason: 'proposal not pending' };
    }

    // 2. Update proposal to APPROVED
    const { error: upErr } = await admin
        .from('destination_match_proposals')
        .update({
            status: 'APPROVED',
            decided_by: auth.user.id,
            decided_at: new Date().toISOString(),
            decision_note: parsed.data.note ?? null,
        })
        .eq('id', proposal.id);
    if (upErr) return { ok: false, reason: upErr.message };

    // 3. Optionally merge into allow-list (idempotent — no-op if already present)
    let allowListUpdated = false;
    if (parsed.data.addToAllowList) {
        const { data: cfg } = await admin
            .from('app_config')
            .select('value')
            .eq('key', 'arrival.origin_port_allow_list')
            .single();
        const list = (cfg?.value ?? {}) as Record<string, string[]>;
        const current = list[parsed.data.port] ?? [];
        if (!current.includes(proposal.normalized)) {
            list[parsed.data.port] = [...current, proposal.normalized];
            const { error: cErr } = await admin
                .from('app_config')
                .update({ value: list })
                .eq('key', 'arrival.origin_port_allow_list');
            if (cErr) return { ok: false, reason: cErr.message };
            allowListUpdated = true;
        }
    }

    // 4. Backdated alert creation is intentionally deferred to v0+1.
    //    For v0, the matcher will pick up the new variant on the next
    //    ShipStaticData broadcast (~6 min) and create the alert naturally.
    return { ok: true, allowListUpdated, alertCreated: false };
}
```

`frontend/src/actions/rejectDestinationProposal.ts`:

```typescript
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

const schema = z.object({
    proposalId: z.string().uuid(),
    note: z.string().min(1).max(500),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'PORT_OFFICER'] as const;

export type RejectDestinationProposalResult =
    | { ok: true }
    | { ok: false; reason: string };

export async function rejectDestinationProposal(
    raw: unknown,
): Promise<RejectDestinationProposalResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { ok: false, reason: 'service role not configured' };
    const admin = createServiceRole(url, key, { auth: { persistSession: false } });

    const { error } = await admin
        .from('destination_match_proposals')
        .update({
            status: 'REJECTED',
            decided_by: auth.user.id,
            decided_at: new Date().toISOString(),
            decision_note: parsed.data.note,
        })
        .eq('id', parsed.data.proposalId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/actions/approveDestinationProposal.test.ts src/actions/rejectDestinationProposal.test.ts
```

Expected: all subtests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/destinationProposalService.ts \
        frontend/src/actions/approveDestinationProposal.ts \
        frontend/src/actions/approveDestinationProposal.test.ts \
        frontend/src/actions/rejectDestinationProposal.ts \
        frontend/src/actions/rejectDestinationProposal.test.ts
git commit -m "feat(originport): Plan 8 Task 11 — server actions for destination proposals"
```

---

## Task 12: Admin page `/admin/origin-port-proposals`

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/origin-port-proposals/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/origin-port-proposals/OriginPortProposalsPanel.tsx`

- [ ] **Step 1: Create the server component (read-only entry point)**

`frontend/src/app/(dashboard)/admin/origin-port-proposals/page.tsx`:

```typescript
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listPendingDestinationProposals } from '@/services/destinationProposalService';
import OriginPortProposalsPanel from './OriginPortProposalsPanel';

const ALLOWED = ['SUPERADMIN', 'PORT_OFFICER', 'FINANCE_ADMIN'] as const;

export default async function OriginPortProposalsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED.includes(profile.role)) redirect('/dashboard');

    const proposals = await listPendingDestinationProposals();
    const canDecide = profile.role === 'SUPERADMIN' || profile.role === 'PORT_OFFICER';
    return <OriginPortProposalsPanel proposals={proposals} canDecide={canDecide} />;
}
```

- [ ] **Step 2: Create the client panel + dialogs**

`frontend/src/app/(dashboard)/admin/origin-port-proposals/OriginPortProposalsPanel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsTable } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsInput } from '@/components/ui/OsInput';
import type { DestinationProposal } from '@/services/destinationProposalService';
import { approveDestinationProposal } from '@/actions/approveDestinationProposal';
import { rejectDestinationProposal } from '@/actions/rejectDestinationProposal';

type Props = { proposals: DestinationProposal[]; canDecide: boolean };

export default function OriginPortProposalsPanel({ proposals, canDecide }: Props) {
    const t = useTranslations('AdminOriginPort');
    const [active, setActive] = useState<DestinationProposal | null>(null);
    const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    return (
        <section className="os-bg p-6 space-y-4">
            <header className="flex items-center justify-between">
                <h1 className="text-2xl">{t('title')}</h1>
                <span className="text-sm opacity-70">{t('count', { n: proposals.length })}</span>
            </header>

            <OsTable
                rows={proposals}
                columns={[
                    { key: 'mmsi',            label: t('cols.mmsi') },
                    { key: 'vessel_name',     label: t('cols.vessel') },
                    { key: 'raw_destination', label: t('cols.raw') },
                    { key: 'normalized',      label: t('cols.normalized') },
                    { key: 'matched_port_guess', label: t('cols.guess'),
                      render: (r) => <OsBadge variant="warn" label={r.matched_port_guess ?? '—'} /> },
                    { key: 'fuzzy_score',     label: t('cols.score') },
                    { key: 'created_at',      label: t('cols.created'),
                      render: (r) => new Date(r.created_at).toLocaleString() },
                    ...(canDecide ? [{
                        key: 'actions',
                        label: t('cols.actions'),
                        render: (r: DestinationProposal) => (
                            <div className="flex gap-2">
                                <button className="os-btn-primary"
                                        onClick={() => { setActive(r); setMode('approve'); }}>
                                    {t('actions.approve')}
                                </button>
                                <button className="os-btn-ghost"
                                        onClick={() => { setActive(r); setMode('reject'); }}>
                                    {t('actions.reject')}
                                </button>
                            </div>
                        ),
                    }] : []),
                ]}
                emptyMessage={t('empty')}
            />

            <Dialog.Root open={mode === 'approve' && !!active}
                         onOpenChange={(o) => { if (!o) { setMode(null); setActive(null); setError(null); } }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="os-dialog-overlay" />
                    <Dialog.Content className="os-dialog-content">
                        <Dialog.Title>{t('approve.title')}</Dialog.Title>
                        <ApproveForm proposal={active} onSubmit={(payload) => {
                            setError(null);
                            startTransition(async () => {
                                const r = await approveDestinationProposal(payload);
                                if (!r.ok) setError(r.reason);
                                else { setMode(null); setActive(null); location.reload(); }
                            });
                        }} pending={pending} error={error} />
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={mode === 'reject' && !!active}
                         onOpenChange={(o) => { if (!o) { setMode(null); setActive(null); setError(null); } }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="os-dialog-overlay" />
                    <Dialog.Content className="os-dialog-content">
                        <Dialog.Title>{t('reject.title')}</Dialog.Title>
                        <RejectForm proposal={active} onSubmit={(payload) => {
                            setError(null);
                            startTransition(async () => {
                                const r = await rejectDestinationProposal(payload);
                                if (!r.ok) setError(r.reason);
                                else { setMode(null); setActive(null); location.reload(); }
                            });
                        }} pending={pending} error={error} />
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </section>
    );
}

function ApproveForm({ proposal, onSubmit, pending, error }: {
    proposal: DestinationProposal | null;
    onSubmit: (p: { proposalId: string; port: 'BERBERA' | 'ZEILA';
                    addToAllowList: boolean; createAlert: boolean; note?: string }) => void;
    pending: boolean; error: string | null;
}) {
    const t = useTranslations('AdminOriginPort');
    const [port, setPort] = useState<'BERBERA' | 'ZEILA'>(
        (proposal?.matched_port_guess as 'BERBERA' | 'ZEILA') ?? 'BERBERA');
    const [add, setAdd] = useState(true);
    const [create, setCreate] = useState(true);
    if (!proposal) return null;
    return (
        <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ proposalId: proposal.id, port, addToAllowList: add, createAlert: create });
        }}>
            <p className="text-sm opacity-80">
                <strong>{proposal.raw_destination}</strong> → <code>{proposal.normalized}</code>
            </p>
            <label className="block text-sm">
                {t('approve.port')}
                <select className="os-input mt-1" value={port}
                        onChange={(e) => setPort(e.target.value as 'BERBERA' | 'ZEILA')}>
                    <option value="BERBERA">BERBERA</option>
                    <option value="ZEILA">ZEILA</option>
                </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={add} onChange={(e) => setAdd(e.target.checked)} />
                {t('approve.addToAllowList')}
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} />
                {t('approve.createAlert')}
            </label>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" className="os-btn-primary w-full" disabled={pending}>
                {pending ? t('approve.submitting') : t('approve.submit')}
            </button>
        </form>
    );
}

function RejectForm({ proposal, onSubmit, pending, error }: {
    proposal: DestinationProposal | null;
    onSubmit: (p: { proposalId: string; note: string }) => void;
    pending: boolean; error: string | null;
}) {
    const t = useTranslations('AdminOriginPort');
    const [note, setNote] = useState('');
    if (!proposal) return null;
    return (
        <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ proposalId: proposal.id, note });
        }}>
            <p className="text-sm opacity-80">
                <strong>{proposal.raw_destination}</strong>
            </p>
            <OsInput label={t('reject.note')} value={note}
                     onChange={(e) => setNote(e.target.value)}
                     required maxLength={500} />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" className="os-btn-primary w-full" disabled={pending || !note}>
                {pending ? t('reject.submitting') : t('reject.submit')}
            </button>
        </form>
    );
}
```

- [ ] **Step 3: Run typecheck + a smoke render**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors. (If `OsTable` columns type doesn't accept the conditional `actions` column, narrow the column type with a discriminated union — see existing `EquasisProposalsPanel.tsx` for the exact shape.)

- [ ] **Step 4: Manual smoke**

```bash
cd frontend && npm run dev
# Open http://localhost:3300/admin/origin-port-proposals
# As SUPERADMIN: page should render an empty table with "no proposals" message.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/origin-port-proposals/
git commit -m "feat(admin): Plan 8 Task 12 — /admin/origin-port-proposals review UI"
```

---

## Task 13: Sidebar entry + RBAC

**Files:**
- Modify: `frontend/src/components/dashboard/DashboardSidebar.tsx`
- Modify: `frontend/src/lib/rbac.ts`

- [ ] **Step 1: Read existing sidebar + rbac to find where /admin/escalations is registered**

```bash
grep -n "escalations" frontend/src/components/dashboard/DashboardSidebar.tsx \
                     frontend/src/lib/rbac.ts
```

- [ ] **Step 2: Add the new route alongside `/admin/escalations`**

In `frontend/src/components/dashboard/DashboardSidebar.tsx`, add a new entry mirroring the escalations one (use a relevant icon — anchor or globe — pick from the existing icon set used in the file):

```tsx
{
    href: '/admin/origin-port-proposals',
    label: t('sidebar.originPortProposals'),
    icon: <GlobeIcon className="size-5" />,
    roles: ['SUPERADMIN', 'PORT_OFFICER', 'FINANCE_ADMIN'],
}
```

In `frontend/src/lib/rbac.ts`, add the route to the matrix using the same shape as `/admin/escalations`:

```typescript
'/admin/origin-port-proposals': ['SUPERADMIN', 'PORT_OFFICER', 'FINANCE_ADMIN'],
```

- [ ] **Step 3: Add the i18n key the sidebar references (en + fr)**

In `frontend/src/i18n/messages/en/Dashboard.json` (or whichever namespace already holds `sidebar.escalations`):

```json
"sidebar.originPortProposals": "Origin-port proposals"
```

In `frontend/src/i18n/messages/fr/Dashboard.json`:

```json
"sidebar.originPortProposals": "Propositions port d'origine"
```

- [ ] **Step 4: Run typecheck + smoke**

```bash
cd frontend && npx tsc --noEmit && npm run dev
# Login as SUPERADMIN, verify the new sidebar entry appears.
# Login as SHIPPING_AGENT, verify it does NOT appear.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/DashboardSidebar.tsx \
        frontend/src/lib/rbac.ts \
        frontend/src/i18n/messages/en/Dashboard.json \
        frontend/src/i18n/messages/fr/Dashboard.json
git commit -m "feat(admin): Plan 8 Task 13 — sidebar entry + RBAC for origin-port proposals"
```

---

## Task 14: Tax-settings extension — `feature.ais_global_enabled` toggle

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/tax-settings/` (panel that holds existing feature flag toggles — locate via grep)

- [ ] **Step 1: Locate the existing feature flag toggles in tax-settings**

```bash
grep -rn "feature.equasis_scraper_enabled\|feature.ais_global" frontend/src/app/
```

The result identifies the panel file (likely `TaxSettingsPanel.tsx` or `FeatureFlagsPanel.tsx`).

- [ ] **Step 2: Add the new toggle next to the existing feature flag toggles**

Add the new flag to the same toggle list, gated SUPERADMIN-only (matches existing pattern). Reuse the existing `updateAppConfig` server action — no new action needed.

Example additions in the panel (adapt to actual file structure found in Step 1):

```tsx
<FeatureToggle
    flagKey="feature.ais_global_enabled"
    label={t('flags.aisGlobalLabel')}
    description={t('flags.aisGlobalDescription')}
    value={config['feature.ais_global_enabled'] === true}
    onChange={(v) => handleUpdate('feature.ais_global_enabled', v)}
/>
```

- [ ] **Step 3: Update the i18n strings (en + fr)**

In `frontend/src/i18n/messages/en/AdminTaxPipeline.json`:

```json
"flags.aisGlobalLabel": "AIS global origin-port detection",
"flags.aisGlobalDescription": "When enabled, the backend opens a 2nd WebSocket subscription (4 quadrants of the world, ShipStaticData only) and creates UNCLAIMED arrival_alerts when a vessel declares Berbera or Zeila as its destination."
```

In `frontend/src/i18n/messages/fr/AdminTaxPipeline.json`:

```json
"flags.aisGlobalLabel": "Détection AIS globale au port d'origine",
"flags.aisGlobalDescription": "Quand activé, le backend ouvre une 2ème connexion WebSocket (4 quadrants du monde, ShipStaticData uniquement) et crée des arrival_alerts UNCLAIMED lorsqu'un navire déclare Berbera ou Zeila comme destination."
```

- [ ] **Step 4: Smoke + typecheck**

```bash
cd frontend && npx tsc --noEmit && npm run dev
# As SUPERADMIN, /admin/tax-settings should show the new toggle.
# Toggling it should persist (verify via SQL: SELECT value FROM app_config WHERE key='feature.ais_global_enabled').
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/tax-settings/ \
        frontend/src/i18n/messages/en/AdminTaxPipeline.json \
        frontend/src/i18n/messages/fr/AdminTaxPipeline.json
git commit -m "feat(admin): Plan 8 Task 14 — feature.ais_global_enabled toggle in tax-settings"
```

---

## Task 15: i18n namespace `AdminOriginPort` (en + fr)

**Files:**
- Create: `frontend/src/i18n/messages/en/AdminOriginPort.json`
- Create: `frontend/src/i18n/messages/fr/AdminOriginPort.json`

- [ ] **Step 1: Create EN strings**

`frontend/src/i18n/messages/en/AdminOriginPort.json`:

```json
{
  "title": "Origin-port destination proposals",
  "count": "{n} pending",
  "empty": "No pending proposals.",
  "cols": {
    "mmsi": "MMSI",
    "vessel": "Vessel",
    "raw": "Raw destination",
    "normalized": "Normalized",
    "guess": "Guess",
    "score": "Score",
    "created": "Created",
    "actions": "Actions"
  },
  "actions": {
    "approve": "Approve",
    "reject": "Reject"
  },
  "approve": {
    "title": "Approve destination proposal",
    "port": "Target port",
    "addToAllowList": "Add normalized variant to allow-list (so future detections match outright)",
    "createAlert": "Note: alert will be created on next ShipStaticData broadcast (~6 minutes)",
    "submit": "Approve",
    "submitting": "Approving…"
  },
  "reject": {
    "title": "Reject destination proposal",
    "note": "Reason",
    "submit": "Reject",
    "submitting": "Rejecting…"
  }
}
```

- [ ] **Step 2: Create FR strings**

`frontend/src/i18n/messages/fr/AdminOriginPort.json`:

```json
{
  "title": "Propositions de destination port d'origine",
  "count": "{n} en attente",
  "empty": "Aucune proposition en attente.",
  "cols": {
    "mmsi": "MMSI",
    "vessel": "Navire",
    "raw": "Destination brute",
    "normalized": "Normalisée",
    "guess": "Suggestion",
    "score": "Score",
    "created": "Créée",
    "actions": "Actions"
  },
  "actions": {
    "approve": "Approuver",
    "reject": "Rejeter"
  },
  "approve": {
    "title": "Approuver la proposition",
    "port": "Port cible",
    "addToAllowList": "Ajouter la variante normalisée à la liste blanche (les futures détections matcheront directement)",
    "createAlert": "Note : l'alerte sera créée à la prochaine émission ShipStaticData (~6 minutes)",
    "submit": "Approuver",
    "submitting": "Approbation…"
  },
  "reject": {
    "title": "Rejeter la proposition",
    "note": "Motif",
    "submit": "Rejeter",
    "submitting": "Rejet…"
  }
}
```

- [ ] **Step 3: Wire the namespace into the i18n loader if loaders are explicit**

```bash
grep -rn "AdminEscalations\|AdminEquasis" frontend/src/i18n/
```

If the loader explicitly lists namespaces, add `AdminOriginPort` next to `AdminEquasis`. If it auto-detects via filename, no change needed.

- [ ] **Step 4: Smoke**

```bash
cd frontend && npx tsc --noEmit && npm run dev
# Visit /admin/origin-port-proposals — French strings if locale=fr.
# Toggle locale via the language switcher; verify EN/FR both render.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/messages/en/AdminOriginPort.json \
        frontend/src/i18n/messages/fr/AdminOriginPort.json \
        frontend/src/i18n/  # if the loader file changed
git commit -m "i18n(originport): Plan 8 Task 15 — AdminOriginPort namespace EN+FR"
```

---

## Task 16: Update ROADMAP and master spec status markers

**Files:**
- Modify: `docs/superpowers/ROADMAP.md`
- Modify: `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md`

- [ ] **Step 1: ROADMAP — flip Phase 2 row + add summary**

In `docs/superpowers/ROADMAP.md`, locate the `### 🔮 Phase 2` section and update the `feature.ais_global_enabled` bullet:

```markdown
- ✅ **`feature.ais_global_enabled`**: Plan 8 v0 merged 2026-XX-XX. Detects vessels declaring Berbera/Zeila as AIS Destination. Allow-list + fuzzy proposals reviewed at `/admin/origin-port-proposals`. Default false; flip in `/admin/tax-settings`.
```

Also update the ROADMAP header date and the "End-to-end flow that works today" diagram if relevant.

- [ ] **Step 2: Master spec — flip Phase 2 line for ais_global**

In `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md`, find the Phase 2 list (line ~772) and update:

```markdown
- ✅ `feature.ais_global_enabled`: detection A (origin port departure) **— Plan 8 v0 merged**. Module `backend/internal/originport/`; admin review at `/admin/origin-port-proposals`. See [`docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md`](2026-04-27-plan-8-ais-global-origin-port-detection.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/ROADMAP.md \
        docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md
git commit -m "docs: Plan 8 Task 16 — mark feature.ais_global_enabled as v0 merged"
```

---

## Final Verification

Before opening the PR, run the full verification suite:

- [ ] **All Go tests pass with `-race`**

```bash
cd backend && go test -p 1 -race -count=1 -buildvcs=false ./...
# -p 1 serializes packages so integration tests sharing the local DB don't race.
# -buildvcs=false avoids Git VCS-stamping issues in worktrees.
```

- [ ] **All migration tests pass**

```bash
supabase db reset
for f in supabase/tests/migrations/04{3,4,5,6}_*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || { echo "FAIL: $f"; exit 1; }
done
```

- [ ] **Frontend Vitest passes**

```bash
cd frontend
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/actions/approveDestinationProposal src/actions/rejectDestinationProposal
```

- [ ] **Frontend typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Manual integration smoke (with flag ON)**

```bash
# Shell 1: supabase start
# Shell 2: cd backend && go run ./cmd/api
# Shell 3: cd frontend && npm run dev
# Shell 4: SQL flip + synthetic ShipStaticData injection

psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "UPDATE app_config SET value='true'::jsonb WHERE key='feature.ais_global_enabled';"

# Inject a fake ShipStaticData by directly invoking the Watcher via the test
# helper, OR by inserting into vessel_positions + a synthetic INSERT to
# arrival_alerts to verify the page renders.
```

- [ ] **Open PR**

```bash
git push -u origin feat/ais-global-v0
gh pr create --title "Plan 8 — AIS global origin-port detection (v0)" --body "$(cat <<'EOF'
## Summary
- New `originport` module detects vessels declaring Berbera/Zeila as AIS Destination.
- Allow-list + fuzzy proposal review at `/admin/origin-port-proposals`.
- Feature-flagged: `feature.ais_global_enabled`, default false. Toggle in `/admin/tax-settings`.
- Migrations 043-046: `detection_source` enum, `destination_match_proposals` table, allow-list seed, agent-match guard.
- Zero impact on the existing corridor pipeline.

Spec: [docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md](docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md)
Plan: [docs/superpowers/plans/2026-04-27-plan-8-ais-global-origin-port-detection.md](docs/superpowers/plans/2026-04-27-plan-8-ais-global-origin-port-detection.md)

## Test plan
- [ ] All Go tests pass with `-race`
- [ ] Migration tests 043-046 pass
- [ ] Frontend Vitest passes for the two new server actions
- [ ] Manual: flip flag → true on staging, observe `/admin/origin-port-proposals` populates
- [ ] Manual: approve a proposal → verify `arrival.origin_port_allow_list` JSON merged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run after writing this plan)

- ✅ Spec coverage: every numbered section in [`2026-04-27-plan-8-ais-global-origin-port-detection.md`](../specs/2026-04-27-plan-8-ais-global-origin-port-detection.md) maps to a task. §5.1→T1, §5.2→T2, §5.3→T3, §5.4 cron guard→T4, §6 matcher+watcher→T5+T6+T7, §6 ETA→T8, §4 ingester+main→T9+T10, §7.1 actions+page→T11+T12, §7.3 RBAC→T13, §7.2 toggle→T14, §7.4 i18n→T15, §11 docs→T16.
- ✅ No `TBD`, no `add appropriate error handling`, no `similar to Task N`. Task 4 has an explicit pseudocode-comment block flagging that the engineer must lift the body from mig 034 — this is intentional and the test guards correctness.
- ✅ Type/method consistency: `MatchKind`/`MatchResult`/`AllowList` defined in T5 are referenced in T7 with the exact same names. `DestinationProposal` type defined in T11 service is consumed in T12 panel. `originport.Watcher` constructor defined in T7 (`NewWatcher(db, cfg, cache)`) is consumed in T9 + T10.
- ✅ No spec requirement without a task: the only spec item not implemented in v0 is the multi-port edge case (`BBR > DJB`) — explicitly deferred to v0+1 in spec §6.

---
