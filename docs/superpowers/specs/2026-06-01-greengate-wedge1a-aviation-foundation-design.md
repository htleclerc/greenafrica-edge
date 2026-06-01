# GreenGate v8 — Wedge 1 (Aviation Somaliland) · W1‑A: Aviation Data Foundation — Design

> **Status:** design approved (brainstorming) 2026‑06‑01. Implementable scope of this spec = **W1‑A only**.
> **Parent design (source of truth):** [docs/designs/GREENGATE_V8_MULTITENANT.md](../../designs/GREENGATE_V8_MULTITENANT.md) — §4 (data model), §5 step 1 (Wedge 1), §6 (calc engine), §8 (UI).
> **Builds on:** the GreenGate v8 Foundation (PR #43 → develop, migs 071–073): `transport_mode` enum, `methodologies` (incl. `ICAO_LTO` seeded), `jurisdiction_mode_config` (Somaliland AIR row present but `enabled=false`), `mode` discriminators, `shipowners.applicable_modes`, the mig‑073 staff jurisdiction RLS filter, and the `TenantScopedClient` factory.

---

## 1. Wedge 1 decomposition (full scope confirmed by PO)

Wedge 1 = **Aviation Somaliland**, spanning supabase + the Go backend (`backend/`) + the frontend. Too large for a single spec → decomposed into four sub‑projects, each with its own spec → plan → implement cycle (the way Plan 7 ran in phases):

| Sub | Layer | Scope |
|---|---|---|
| **W1‑A** | supabase | `aircraft` + `air_emission_factors` tables, ICAO‑EDB seed, RLS + cross‑tenant isolation test. **(this spec)** |
| **W1‑B** | Go backend | `calculator[mode]` dispatch registry + ICAO LTO calc + MTOW fallback (+ "approximate" flag) + fail‑closed AIR pricing via an `app_config` rate key |
| **W1‑C** | Go backend | FIR geofence (mirrors `internal/eez`) + ADS‑B position ingest (mirrors `internal/ais`) + air `arrival_alerts` → proforma pipeline; GHOST operator auto‑create on detection |
| **W1‑D** | frontend | air‑operator onboarding via `/owner`, unified vessels+aircraft fleet, mode badges/filter, "estimation approximée" flag, flip `jurisdiction_mode_config` AIR=enabled |

W1‑B/C/D are recorded here for forward context only; each gets its own brainstorm + spec when reached.

---

## 2. W1‑A goal & constraints

- **Additive only** — two *new* tables; no expand/contract, no change to existing maritime tables. Safe to ship + bake independently.
- **Mirror the maritime asset/operator pattern.** Design §2 chose disjoint `vessels` + `aircraft` (not a unified generic "asset" table). `aircraft` ≈ `vessels`; `air_emission_factors` ≈ `methodologies`.
- `aircraft` is **tenant‑scoped** (`jurisdiction_id`) and carries the mig‑073‑style staff RLS isolation **from day one**, so aviation staff isolation matches maritime before any second country onboards.
- `air_emission_factors` is a **global reference** table (read‑all, admin‑write), like `methodologies`.
- Delivered as **one migration `074` + curated seed + one isolation test** + one small frontend change.

---

## 3. Schema

### 3.1 `aircraft` (tenant‑scoped, mirrors `vessels`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `icao24` | TEXT | 24‑bit Mode S hex, lowercase 6‑hex. **ADS‑B correlation key** (≈ `vessels.mmsi`). UNIQUE (partial, non‑null). |
| `registration` | TEXT | Tail number, e.g. `6O‑AAA` (≈ `vessels.name`) |
| `icao_type` | TEXT | ICAO type designator, e.g. `A320` — drives the EDB emission‑factor lookup |
| `engine_type` | TEXT | Engine family / type — second EDB lookup key |
| `mtow_kg` | INTEGER | Max takeoff weight — input to the W1‑B MTOW fallback |
| `operator_id` | UUID NULL → `shipowners(id)` | Generalized operator; NULL until claimed. GHOST‑linked in W1‑C. |
| `jurisdiction_id` | UUID NOT NULL → `jurisdictions(id)` | DEFAULT Somaliland `00000000-0000-4000-8000-00000000534f`. Mode is **implicitly AIR** (no `mode` column, mirroring `vessels`' implicit MARITIME). |
| `compliance_status` | TEXT NOT NULL DEFAULT `'APPROACHING'` | Mirrors `vessels.compliance_status` values/semantics |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

- **Indexes:** `UNIQUE(icao24) WHERE icao24 IS NOT NULL`; btree on `operator_id`, `jurisdiction_id`, `registration`.
- **RLS:** clone the post‑073 `vessels` policies — existing owner/relation clauses **plus** the staff "see all" clause guarded by `jurisdiction_id = ANY(current_jurisdiction_ids())`. (So an officer in jurisdiction A never sees a jurisdiction‑B aircraft.)

### 3.2 `air_emission_factors` (global reference, mirrors `methodologies`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `icao_type` | TEXT NOT NULL | |
| `engine_type` | TEXT | nullable (type‑level row when engine unknown) |
| `co2_kg_per_lto_cycle` | NUMERIC NOT NULL | CO2 per standard ICAO LTO cycle |
| `source` | TEXT | `'ICAO_EDB'` for seeded rows |
| `effective_from` | DATE NOT NULL | versioning |

- `UNIQUE(icao_type, engine_type, effective_from)`.
- **RLS:** read‑all (`USING (TRUE)`), write SUPERADMIN/FINANCE_ADMIN — mirror the `methodologies` write policy.
- **Seed:** ~20–40 aircraft types common at Somaliland airports (Berbera/Hargeisa) — e.g. `A320`, `A20N`, `B738`, `B38M`, `AT76`, `DH8D`, `E190`, `B788`, `B763`, `A332`, … — with `co2_kg_per_lto_cycle` derived from **published ICAO‑EDB LTO fuel burn × 3.16 kg CO2/kg fuel**. `source='ICAO_EDB'`, `effective_from` = launch date.

### 3.3 MTOW fallback (NOT W1‑A)

The fallback for aircraft types absent from `air_emission_factors` (estimate CO2/LTO from `mtow_kg` + raise the yellow "estimation approximée" flag) is **calculator logic → W1‑B**. W1‑A ships only the lookup table + `aircraft.mtow_kg`. W1‑A does **not** fabricate fallback coefficients; W1‑B will populate `methodologies.params` (the `ICAO_LTO` row, already inserted by mig 071) with the regression constants.

---

## 4. GHOST operator reuse

`aircraft.operator_id` is a **nullable** FK to `shipowners`. Auto‑detection (W1‑C) will mint a GHOST `shipowners` row with `applicable_modes` containing `'AIR'` (column exists since mig 071) and link `operator_id` — exactly the maritime `vessels → GHOST shipowner` flow. W1‑A provides only the nullable FK; no GHOST logic here.

---

## 5. Frontend touch

Add `'aircraft'` to `TENANT_SCOPED_TABLES` in `frontend/src/lib/supabase/tenant.ts` so any future `createTenantClient(jid)` auto‑injects `jurisdiction_id` on aircraft queries and the ESLint service‑role gate keeps holding. This is the only frontend change in W1‑A (no UI yet).

---

## 6. Migration & verification plan

- **`supabase/migrations/074_greengate_aircraft_aviation.sql`** — create both tables + indexes + RLS policies + grants; seed `air_emission_factors`. Additive; idempotent guards (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`) consistent with 071–073.
- **`supabase/tests/migrations/074_*.test.sql`** — (1) structural: both tables exist with expected columns/indexes; aircraft RLS enabled and the staff policy carries the `current_jurisdiction_ids()` filter; air_emission_factors readable by anon, writable only by admin. (2) **cross‑tenant isolation** (RLS‑as‑user): an officer whose `user_jurisdictions` = Somaliland cannot `SELECT` an aircraft stamped with a second (test) jurisdiction — mirrors the mig‑073 isolation test that proved the GATE.
- **Gates:** `supabase db reset` applies 001→074 clean; the 074 pg test PASSes; `tsc` + `eslint` (service‑role rule still 0 violations) + `vitest` green.

---

## 7. Pricing note (confirmed with PO)

AIR tariff is **deferred to W1‑B** and will reuse the existing `app_config` rate mechanism with an AIR‑specific key (e.g. `carbon_tax.air_rate_usd_per_tco2`) — **not** the design's versioned `tariffs` table (deferred to Wedge 2). The W1‑B calculator stays fail‑closed: a missing AIR rate → alert, never a silent $0.

---

## 8. Explicitly NOT in W1‑A

- ICAO LTO calculator + MTOW fallback math + `calculator[mode]` dispatch (W1‑B).
- FIR geofence + ADS‑B ingest + air `arrival_alerts` + proforma pipeline + GHOST auto‑create (W1‑C).
- Aviation onboarding, unified fleet UI, mode badges/filter, "approximate" flag, flipping `jurisdiction_mode_config` AIR=enabled (W1‑D).
- AIR tariff/pricing key (W1‑B); versioned `tariffs` / `revenue_split_rule` tables (Wedge 2).

---

## 9. Open items for later wedges (not blocking W1‑A)

- **W1‑C ADS‑B data source** (OpenSky Network / commercial aggregator / partner feed) — decide at W1‑C brainstorm.
- **FIR polygon** for Somaliland airspace → populates `jurisdiction_mode_config.geofence_ref` (W1‑C).
- **MTOW fallback regression** exact constants (W1‑B).
