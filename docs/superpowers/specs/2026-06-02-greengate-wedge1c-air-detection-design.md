# GreenGate v8 — Wedge 1 · W1‑C: Air arrival detection → proforma — Design

> **Status:** design (autonomous, per PO "enchaîne jusqu'à la fin"). Builds on W1‑A (`aircraft`, `air_emission_factors`) + W1‑B (`calculator['AIR']`). **Branch:** `feat/greengate-wedge1c-air-detection` (stacked on wedge1b).
> **Parent:** [GREENGATE_V8_MULTITENANT.md](../../designs/GREENGATE_V8_MULTITENANT.md) §5 step 1 (FIR geofence, ADS‑B ingest, air arrival), §6.

## 1. Goal
Mirror the maritime arrival→proforma flow for aviation: ingest ADS‑B positions → detect Somaliland‑FIR entry → create an air `arrival_alert` (`mode='AIR'`) → run the air proforma pipeline (calls the W1‑B air calc) → `mode='AIR'` PROFORMA transaction. GHOST operator auto‑created on detection, exactly like `vessels → GHOST shipowner`.

## 2. Architecture (mirror maritime)
| Maritime | Air (W1‑C) |
|---|---|
| `/api/ais/ingest` → `vessel_positions` | `/api/adsb/ingest` → `aircraft_positions` (provider‑agnostic, secret‑auth) |
| `internal/eez` point‑in‑polygon `Detect(lat,lng)` | `internal/fir` `Detect(lat,lng)` (Somaliland FIR polygon) |
| arrival_alert (vessel_id) | arrival_alert (`aircraft_id`, `mode='AIR'`) |
| `proformaPipelineService` (vessel → tax calc → txn) | same service, **AIR branch** (aircraft → air calc → `mode='AIR'` txn) |

## 3. Decisions (locked, documented)
- **ADS‑B source = provider‑agnostic ingest endpoint** (`/api/adsb/ingest`, mirrors `/api/ais/ingest`), auth via `ADSB_INGEST_SECRET` (fallback `AIS_INGEST_SECRET`). Real feed (OpenSky/aggregator) **deferred** — same posture as maritime AIS.
- **FIR polygon hardcoded in Go** `internal/fir` (mirrors `eez.SomalilandZones`); an **approximate** Somaliland/Hargeisa‑FIR bounding ring (lat ~7.5–11.8 N, lng ~42.5–49.5 E), documented as approximate, refine later. No DB table for the polygon.
- **`arrival_alerts` reused** + new nullable `aircraft_id` (mode discriminates; `vessel_id` already nullable for air rows). `mode` column already exists (mig 071).
- **GHOST operator**: ADS‑B detection of an aircraft with no `operator_id` → `getOrCreateGhost`‑style GHOST `shipowners` row (`applicable_modes ⊇ {AIR}`) + link.
- **lto_cycles = 1** per detected arrival (one landing event).

## 4. Decomposition
- **W1‑C‑1 (DB + FIR + ingest + detection)**: mig 076 (`aircraft_positions` + `arrival_alerts.aircraft_id` + RLS + isolation test); Go `internal/fir` (polygon + `Detect` + tests); `/api/adsb/ingest` route (upsert aircraft by `icao24`, insert positions, GHOST operator, FIR‑entry → air `arrival_alert` + enqueue proforma).
- **W1‑C‑2 (air proforma pipeline)**: extend `proformaPipelineService` with a `mode='AIR'` branch (load `aircraft` not `vessel`, POST `/api/v1/tax/calculate` `{mode:"AIR", icao_type, engine_type, mtow_kg, lto_cycles:1}`, insert `mode='AIR'` PROFORMA transaction with `aircraft_id`); Vitest coverage.

## 5. Schema (mig 076)
```sql
CREATE TABLE public.aircraft_positions (
  id UUID PK default gen_random_uuid(),
  aircraft_id UUID NOT NULL REFERENCES public.aircraft(id) ON DELETE CASCADE,
  lat NUMERIC(9,6) NOT NULL, lng NUMERIC(9,6) NOT NULL,
  altitude_ft INTEGER, ground_speed_kt NUMERIC(6,1), heading NUMERIC(5,1),
  in_fir BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);  -- index (aircraft_id, recorded_at DESC)
ALTER TABLE public.arrival_alerts ADD COLUMN IF NOT EXISTS aircraft_id UUID REFERENCES public.aircraft(id);
-- vessel_id becomes nullable for air rows; a CHECK ensures exactly one of (vessel_id, aircraft_id) per mode.
```
RLS: `aircraft_positions` mirrors `vessel_positions` (admin/owner read via aircraft→operator; service‑role writes). `arrival_alerts` policies already carry the mig‑073 staff jurisdiction filter; the air rows ride the same `jurisdiction_id`.

## 6. Fail‑closed / correctness
The air proforma pipeline propagates the W1‑B calc's fail‑closed errors (missing AIR rate → pipeline error, no PROFORMA at $0). FIR detection is additive (a position outside the FIR simply creates no alert).

## 7. Tests
- mig 076 pg test: tables/columns/RLS + the `(vessel_id XOR aircraft_id)` CHECK + cross‑tenant isolation on `aircraft_positions`.
- Go `internal/fir`: a point inside Berbera/Hargeisa → in‑FIR true; a point in the Gulf of Aden far north / Indian Ocean → false; ray‑casting edge cases (mirror eez tests).
- Vitest: `/api/adsb/ingest` (auth, upsert, GHOST, FIR‑entry alert) + the air proforma branch (air calc call shape, `mode='AIR'` txn).
- `supabase db reset` 001→076 clean; `go test -p 1 ./...` green.

## 8. NOT in W1‑C
Real ADS‑B provider integration (endpoint is provider‑agnostic); air agent‑matching/claim UX (alerts auto‑created `MATCHED_AUTO` for v1); a dedicated Go watcher loop (detection runs in the ingest path); onboarding + fleet UI + flip AIR‑enabled (W1‑D); versioned tariffs (Wedge 2).
