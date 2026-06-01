# GreenGate v8 — Wedge 1‑A: Aviation Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `aircraft` and `air_emission_factors` tables (with ICAO‑EDB seed, RLS, and a cross‑tenant isolation test) so the rest of Wedge 1 (calculator, detection, onboarding) has a data foundation — additively, without touching maritime tables.

**Architecture:** One additive migration (`074`) mirroring proven maritime patterns: `aircraft` ≈ `vessels` (tenant‑scoped, mig‑073‑style staff RLS, reuses the `compliance_status` enum), `air_emission_factors` ≈ `methodologies` (global reference, read‑all/admin‑write). One pg test mirrors the mig‑073 isolation test. One frontend line adds `'aircraft'` to the tenant‑scoped table set.

**Tech Stack:** PostgreSQL 18 (Supabase local via Docker), `supabase db reset` + `psql` test harness (`supabase/tests/run.sh`), TypeScript (Next.js), vitest/eslint.

**Spec:** [docs/superpowers/specs/2026-06-01-greengate-wedge1a-aviation-foundation-design.md](../specs/2026-06-01-greengate-wedge1a-aviation-foundation-design.md)

**Branch:** `feat/greengate-wedge1a-aviation` (already created, stacked on `feat/greengate-v8-foundation`).

---

## File Structure

- **Create** `supabase/migrations/074_greengate_aircraft_aviation.sql` — both tables, indexes, RLS, grants, `air_emission_factors` seed.
- **Create** `supabase/tests/migrations/074_greengate_aircraft_aviation.test.sql` — structural + cross‑tenant isolation assertions.
- **Modify** `frontend/src/lib/supabase/tenant.ts` — add `'aircraft'` to `TENANT_SCOPED_TABLES`.
- **Modify** `frontend/src/lib/supabase/tenant.test.ts` — extend the table‑set assertion (only if one exists; verified in Task 4).

Reference (read‑only, do not edit): mig 003 (`compliance_status` enum, vessels), mig 071 (`current_jurisdiction_ids()`, `methodologies` policies, Somaliland jurisdiction id `00000000-0000-4000-8000-00000000534f`), mig 073 (staff RLS filter pattern + isolation test).

---

## Task 1: Migration 074 — `aircraft` + `air_emission_factors`

**Files:**
- Create: `supabase/migrations/074_greengate_aircraft_aviation.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/074_greengate_aircraft_aviation.sql` with exactly:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 074: GreenGate v8 — Wedge 1-A aviation data foundation (ADDITIVE)
--
-- New tables only; no change to maritime tables. Mirrors the maritime asset/operator
-- pattern (design §2: disjoint vessels + aircraft):
--   • aircraft            ≈ vessels       (tenant-scoped; mig-073-style staff RLS)
--   • air_emission_factors ≈ methodologies (global reference; read-all, admin-write)
-- Mode is implicitly AIR for aircraft (mirrors vessels' implicit MARITIME — no column).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── aircraft (tenant-scoped asset; operator = generalised shipowners entity) ──
CREATE TABLE IF NOT EXISTS public.aircraft (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icao24            TEXT,                                   -- 24-bit Mode S hex (ADS-B key ≈ vessels.mmsi)
  registration      TEXT,                                  -- tail number, e.g. '6O-AAA' (≈ vessels.name)
  icao_type         TEXT,                                  -- ICAO type designator 'A320' (drives EDB lookup)
  engine_type       TEXT,                                  -- engine family/type (second EDB key)
  mtow_kg           INTEGER,                               -- max takeoff weight (W1-B MTOW fallback input)
  operator_id       UUID REFERENCES public.shipowners(id), -- NULL until claimed; GHOST-linked in W1-C
  jurisdiction_id   UUID NOT NULL
                      DEFAULT '00000000-0000-4000-8000-00000000534f'
                      REFERENCES public.jurisdictions(id),
  compliance_status public.compliance_status NOT NULL DEFAULT 'APPROACHING',  -- reuse mig-003 enum
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aircraft_icao24
  ON public.aircraft (icao24) WHERE icao24 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aircraft_operator     ON public.aircraft (operator_id);
CREATE INDEX IF NOT EXISTS idx_aircraft_jurisdiction ON public.aircraft (jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_aircraft_registration ON public.aircraft (registration);

COMMENT ON TABLE public.aircraft IS
  'GreenGate v8 Wedge 1: AIR-mode asset (disjoint from vessels). icao24 = ADS-B Mode S correlation key; icao_type drives air_emission_factors lookup; operator_id → shipowners (generalised operator).';

ALTER TABLE public.aircraft ENABLE ROW LEVEL SECURITY;

-- SELECT: the operating shipowner (via shipowners.profile_id) OR staff confined to
-- their jurisdiction (mig-073 pattern). Mirrors vessels "Shipping agents see own fleet".
DROP POLICY IF EXISTS "operators + staff see aircraft" ON public.aircraft;
CREATE POLICY "operators + staff see aircraft"
  ON public.aircraft FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.shipowners s
             WHERE s.id = aircraft.operator_id AND s.profile_id = auth.uid())
    OR ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
         AND jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
  );

-- Write: admins/officers confined to their jurisdiction (mirrors shipowners "admins full").
-- Service-role (TenantScopedClient) bypasses RLS for system writes (W1-C detection, etc.).
DROP POLICY IF EXISTS "admins manage aircraft" ON public.aircraft;
CREATE POLICY "admins manage aircraft"
  ON public.aircraft FOR ALL
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  )
  WITH CHECK (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aircraft TO service_role;

-- ── air_emission_factors (global reference; mirrors methodologies) ────────────
CREATE TABLE IF NOT EXISTS public.air_emission_factors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icao_type            TEXT NOT NULL,
  engine_type          TEXT,
  co2_kg_per_lto_cycle NUMERIC NOT NULL,   -- CO2 per standard ICAO LTO cycle
  source               TEXT,               -- 'ICAO_EDB' for seeded rows
  effective_from       DATE NOT NULL,
  UNIQUE (icao_type, engine_type, effective_from)
);

COMMENT ON TABLE public.air_emission_factors IS
  'GreenGate v8 Wedge 1: CO2 per ICAO LTO cycle by aircraft type/engine. Seeded rows are ICAO-EDB-derived (LTO fuel burn × 3.16 kg CO2/kg). Types absent here fall back to an MTOW estimate in the W1-B calculator (with an "approximate" flag).';

ALTER TABLE public.air_emission_factors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads air emission factors" ON public.air_emission_factors;
CREATE POLICY "anyone reads air emission factors"
  ON public.air_emission_factors FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "admins write air emission factors" ON public.air_emission_factors;
CREATE POLICY "admins write air emission factors"
  ON public.air_emission_factors FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.air_emission_factors TO service_role;

-- ── seed: representative types at Somaliland airports (Hargeisa/Berbera) ──────
-- Values are ICAO-EDB-derived approximations (full-LTO-cycle fuel burn × 3.16 kg
-- CO2/kg); validate against the current ICAO EDB before production billing.
INSERT INTO public.air_emission_factors (icao_type, engine_type, co2_kg_per_lto_cycle, source, effective_from) VALUES
  ('A320', 'CFM56-5B',  2600, 'ICAO_EDB', DATE '2026-06-01'),
  ('A20N', 'LEAP-1A',   2150, 'ICAO_EDB', DATE '2026-06-01'),
  ('A321', 'CFM56-5B',  2950, 'ICAO_EDB', DATE '2026-06-01'),
  ('B738', 'CFM56-7B',  2800, 'ICAO_EDB', DATE '2026-06-01'),
  ('B38M', 'LEAP-1B',   2400, 'ICAO_EDB', DATE '2026-06-01'),
  ('E190', 'CF34-10E',  1900, 'ICAO_EDB', DATE '2026-06-01'),
  ('CRJ9', 'CF34-8C',   1650, 'ICAO_EDB', DATE '2026-06-01'),
  ('AT76', 'PW127',      560, 'ICAO_EDB', DATE '2026-06-01'),
  ('DH8D', 'PW150A',     650, 'ICAO_EDB', DATE '2026-06-01'),
  ('B763', 'CF6-80C2',  5500, 'ICAO_EDB', DATE '2026-06-01'),
  ('A332', 'CF6-80E1',  7000, 'ICAO_EDB', DATE '2026-06-01'),
  ('B788', 'GEnx-1B',   6500, 'ICAO_EDB', DATE '2026-06-01')
ON CONFLICT (icao_type, engine_type, effective_from) DO NOTHING;

-- DOWN: DROP TABLE public.air_emission_factors; DROP TABLE public.aircraft;
-- (both are additive — dropping them is safe; no maritime data depends on them.)
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/074_greengate_aircraft_aviation.sql
git commit -m "feat(db): GreenGate v8 W1-A - aircraft + air_emission_factors (mig 074)"
```

---

## Task 2: Migration 074 pg test (structural + cross‑tenant isolation)

**Files:**
- Create: `supabase/tests/migrations/074_greengate_aircraft_aviation.test.sql`

- [ ] **Step 1: Write the test (mirrors the mig‑073 isolation test)**

Create `supabase/tests/migrations/074_greengate_aircraft_aviation.test.sql` with exactly:

```sql
-- Test 074: aviation data foundation — structure + cross-tenant aircraft isolation
BEGIN;

-- ── Part 1: structural ───────────────────────────────────────────────────────
DO $$
BEGIN
  -- both tables exist
  IF to_regclass('public.aircraft') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: table public.aircraft is missing';
  END IF;
  IF to_regclass('public.air_emission_factors') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: table public.air_emission_factors is missing';
  END IF;

  -- aircraft key columns present
  PERFORM 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='aircraft'
      AND column_name IN ('icao24','registration','icao_type','engine_type',
                          'mtow_kg','operator_id','jurisdiction_id','compliance_status')
    GROUP BY table_name HAVING count(*) = 8;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: aircraft is missing one or more expected columns';
  END IF;

  -- aircraft RLS enabled
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aircraft'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: RLS not enabled on aircraft';
  END IF;

  -- the staff clause carries the jurisdiction filter (mig-073 invariant)
  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
        WHERE polname = 'operators + staff see aircraft'
          AND polrelid = 'public.aircraft'::regclass) NOT LIKE '%current_jurisdiction_ids%' THEN
    RAISE EXCEPTION 'TEST FAILED: aircraft SELECT policy lacks the jurisdiction filter';
  END IF;

  -- seed present + anon-readable policy exists
  IF (SELECT count(*) FROM public.air_emission_factors) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED: air_emission_factors seed is empty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polname = 'anyone reads air emission factors'
                    AND polrelid = 'public.air_emission_factors'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: air_emission_factors read policy missing';
  END IF;
END $$;

-- ── Part 2: behavioral cross-tenant isolation (a Somaliland officer must not see
--           another jurisdiction's aircraft). Mirrors the mig-073 test. ────────
DO $$
DECLARE
  so_jid  UUID := '00000000-0000-4000-8000-00000000534f';
  tst_jid UUID := '11111111-1111-4111-8111-111111111111';
  user_a  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST', 'Test Country', 'ACTIVE') ON CONFLICT (code) DO NOTHING;
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('6O-SO1', 'A320', so_jid);
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('TST-AC1', 'A320', tst_jid);

  INSERT INTO auth.users (id, email) VALUES (user_a, 'a@air-isolation.test') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (user_a, 'a@air-isolation.test', 'Officer A', 'PORT_OFFICER', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
    VALUES (user_a, so_jid) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_a::text)::text, true);
  SET LOCAL ROLE authenticated;

  IF EXISTS (SELECT 1 FROM public.aircraft WHERE jurisdiction_id = tst_jid) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer can see a TST-jurisdiction aircraft (cross-tenant leak)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.aircraft WHERE jurisdiction_id = so_jid) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer cannot see their own-jurisdiction aircraft';
  END IF;

  RESET ROLE;
END $$;

ROLLBACK;
SELECT '074 GreenGate aviation data foundation: PASS' AS test_result;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/migrations/074_greengate_aircraft_aviation.test.sql
git commit -m "test(db): W1-A aircraft isolation + structural test (mig 074)"
```

---

## Task 3: Apply + verify the migration on real Postgres

**Files:** none (verification)

- [ ] **Step 1: Reset the DB (applies 001→074 + seed)**

Run: `cd c:/Users/lecle/Workspace/africgreen && supabase db reset`
Expected: ends with `Finished supabase db reset on branch ...`, no `ERROR`. The output should include `Applying migration 074_greengate_aircraft_aviation.sql...`.

- [ ] **Step 2: Run the 074 test**

Run: `cd c:/Users/lecle/Workspace/africgreen && bash supabase/tests/run.sh migrations/074_greengate_aircraft_aviation.test.sql`
Expected: final line `074 GreenGate aviation data foundation: PASS`, exit 0.

- [ ] **Step 3: Confirm no regression in the foundation tests**

Run: `cd c:/Users/lecle/Workspace/africgreen && for t in 071_greengate_foundation_tenancy 072_greengate_money_jurisdiction 073_greengate_staff_rls_jurisdiction 058_payments_rls; do bash supabase/tests/run.sh "migrations/${t}.test.sql" >/dev/null 2>&1 && echo "$t PASS" || echo "$t FAIL"; done`
Expected: all four print `PASS`.

If any step fails, fix the migration/test inline and re-run Steps 1–3 before continuing.

---

## Task 4: Register `aircraft` as a tenant-scoped table (frontend)

**Files:**
- Modify: `frontend/src/lib/supabase/tenant.ts`
- Test: `frontend/src/lib/supabase/tenant.test.ts` (extend only if it asserts the set)

- [ ] **Step 1: Add `'aircraft'` to the set**

In `frontend/src/lib/supabase/tenant.ts`, the `TENANT_SCOPED_TABLES` set currently lists 9 tables (`transactions` … `owner_notifications`). Add `'aircraft'`:

```ts
export const TENANT_SCOPED_TABLES: ReadonlySet<string> = new Set([
    'transactions',
    'arrival_alerts',
    'vessels',
    'aircraft',
    'shipowners',
    'payments',
    'wallets',
    'wallet_ledger',
    'refunds',
    'owner_notifications',
]);
```

- [ ] **Step 2: Update the stale table-count in the test title**

`frontend/src/lib/supabase/tenant.test.ts` line ~110 reads `it('covers all 9 tenant-scoped tables in the allowlist', ...)`. The body loops over `TENANT_SCOPED_TABLES` dynamically (no hard-coded list), so it still passes with the new table — but the title count is now stale. Change `9` → `10`:

```ts
    it('covers all 10 tenant-scoped tables in the allowlist', () => {
```

- [ ] **Step 3: Run the tenant tests**

Run: `cd c:/Users/lecle/Workspace/africgreen/frontend && npx vitest run src/lib/supabase/tenant.test.ts 2>&1 | tail -10`
Expected: PASS (the loop now also scopes `aircraft`).

- [ ] **Step 4: Commit**

```bash
cd c:/Users/lecle/Workspace/africgreen
git add frontend/src/lib/supabase/tenant.ts frontend/src/lib/supabase/tenant.test.ts
git commit -m "feat(security): scope aircraft through TenantScopedClient (W1-A)"
```

---

## Task 5: Final gates

**Files:** none (verification)

- [ ] **Step 1: TypeScript**

Run: `cd c:/Users/lecle/Workspace/africgreen/frontend && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 2: ESLint (service-role gate still 0 violations)**

Run: `cd c:/Users/lecle/Workspace/africgreen/frontend && npx eslint src/lib/supabase/tenant.ts 2>&1 | tail -5`
Expected: no output.

- [ ] **Step 3: Vitest (no regressions)**

Run: `cd c:/Users/lecle/Workspace/africgreen/frontend && npx vitest run 2>&1 | tail -6`
Expected: same pass count as before (571 passed | 11 skipped), 0 failures.

- [ ] **Step 4: Confirm clean tree**

Run: `cd c:/Users/lecle/Workspace/africgreen && git status --short`
Expected: empty (everything committed across Tasks 1–4).

---

## Done criteria

- `supabase db reset` applies 001→074 clean; `074` pg test + 071/072/073/058 all PASS.
- `aircraft` (tenant-scoped, mig-073 RLS) + `air_emission_factors` (global reference, seeded) exist.
- `aircraft` is in `TENANT_SCOPED_TABLES`; tsc + eslint + vitest green.
- No maritime table touched; no calculator/detection/UI (those are W1-B/C/D).
