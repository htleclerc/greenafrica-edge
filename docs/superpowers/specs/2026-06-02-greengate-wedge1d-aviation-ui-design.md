# GreenGate v8 — Wedge 1 · W1‑D: Activate AIR + aviation UI — Design

> **Status:** design (autonomous). Final Wedge 1 sub-project. Builds on W1‑A/B/C. **Branch:** `feat/greengate-wedge1d-aviation-ui` (stacked on wedge1c).
> **Parent:** GREENGATE_V8_MULTITENANT.md §5 step 1, §8 (UI: unified fleet, mode badges, "estimation approximée" flag).

## 1. Goal
Turn aviation **on** for Somaliland and surface it in the owner portal: flip `jurisdiction_mode_config` AIR=enabled; show aircraft alongside vessels in the owner fleet with **mode badges**; flag air transactions whose CO2 used the **MTOW fallback** ("estimation approximée").

## 2. Scope (decisions locked)
- **mig 078** — flip the Somaliland `AIR` `jurisdiction_mode_config` row (mig 071 inserted it `enabled=FALSE`): `enabled=TRUE`, `geofence_ref='somaliland-fir'`, `activated_at=NOW()`. Idempotent UPDATE. + pg test.
- **Unified fleet** — extend `/owner/(portal)/vessels/page.tsx`: also fetch the owner's `aircraft` via the RLS session client (the mig‑074 operator clause scopes to `operator_id → shipowners.profile_id = auth.uid()`), render an aircraft section/table mirroring `VesselsTable`, each row carrying a **mode badge** (🚢 Maritime / ✈ Air). Vessels get the maritime badge. Reuse `Os*` primitives.
- **Estimation‑approximée flag** — a small reusable badge (yellow) shown on air items whose tax used the MTOW fallback (`transactions.breakdown_json->>'emission_source' = 'MTOW_FALLBACK'` or `->>'approximate' = 'true'`). Surface it in the fleet's recent‑invoices list for air rows. Transparency per design §8.
- **Onboarding** — the operator model already supports `applicable_modes` incl. `AIR` (mig 071); air operators + their aircraft appear in the unified fleet. Deep self‑service air‑onboarding **form** changes are **deferred** (documented) — the data model + fleet surface are the W1‑D deliverable.

## 3. Components / files
- `supabase/migrations/078_greengate_activate_air_somaliland.sql` (+ `.test.sql`).
- `frontend/src/app/owner/(portal)/vessels/page.tsx` — add aircraft + air recent-invoice fetch.
- `frontend/src/app/owner/(portal)/vessels/AircraftTable.tsx` (new) — mirrors `VesselsTable`, aircraft columns (registration, icao24, icao_type, engine_type, compliance_status) + Air badge.
- `frontend/src/components/owner/ModeBadge.tsx` (new) — `<ModeBadge mode="MARITIME"|"AIR" />` (🚢/✈ + label). Reuse on vessel + aircraft rows.
- `frontend/src/components/owner/ApproxFlag.tsx` (new) — yellow "Estimation approximée / Approximate estimate" badge.
- Vitest for ModeBadge / ApproxFlag (render) + any data-shape test.

## 4. Verification
- `supabase db reset` 001→078 clean; `078_*.test.sql` PASS (AIR row enabled=TRUE + activated_at set + geofence_ref).
- `tsc` + `eslint` clean; `vitest` green (incl. new component tests).
- (Recommended follow-up, not gating here: visual QA of the fleet via the browse/design-review skills.)

## 5. NOT in W1-D
Deep air-operator self-service onboarding form; air agent-matching/claim UX; real ADS-B provider; multi-country mode matrix UI (Wedge 2); versioned tariffs (Wedge 2).
