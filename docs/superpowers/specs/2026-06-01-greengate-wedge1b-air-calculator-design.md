# GreenGate v8 — Wedge 1 · W1‑B: `calculator['AIR']` ICAO LTO (Go backend) — Design

> **Status:** design approved (brainstorming) 2026‑06‑01. Implementable scope = **W1‑B only**.
> **Parent design:** [docs/designs/GREENGATE_V8_MULTITENANT.md](../../designs/GREENGATE_V8_MULTITENANT.md) §6 (calc engine: `calculator[mode]`, ICAO LTO = LTO cycles × EDB factor, MTOW fallback + "approximate" flag, fail‑closed pricing), §4.
> **Builds on:** W1‑A (`air_emission_factors` table, mig 074) + the foundation (`methodologies` `ICAO_LTO` row from mig 071). **Branch:** `feat/greengate-wedge1b-air-calculator` (stacked on `feat/greengate-wedge1a-aviation`).

---

## 1. Goal

Add air carbon‑tax calculation to the Go backend (`backend/`) via a `calculator[mode]` dispatch. **MARITIME** (existing IMO distance‑based calc) stays byte‑identical; **AIR** = ICAO LTO (per‑LTO‑cycle CO2 from `air_emission_factors`, MTOW fallback + "approximate" flag), fail‑closed AIR pricing via an `app_config` rate key. **Go calc + HTTP contract + tests only** — no frontend pipeline wiring, no air transaction creation (that's W1‑C).

## 2. Architecture

A `ModeCalculator` interface + registry in `backend/internal/tax`. The existing `Calculator` becomes the **maritime** implementation behind it (no behavior change). A new `airCalculator` is the **air** implementation. `tax.Handler.Calculate` reads `mode` from the request (absent/empty → `MARITIME` for backward compatibility) and dispatches via the registry. Air computes per **LTO cycle**, not per distance.

## 3. Files

- **Modify** `backend/internal/tax/calculator.go` — add `ModeCalculator` interface (`Calculate(ctx, CalculateRequest) (Result, error)`) + a `map[string]ModeCalculator` registry; refactor the current maritime logic to implement it (same inputs/outputs). Keep maritime `Result`/`Breakdown` JSON stable.
- **Create** `backend/internal/tax/air.go` — `airCalculator`: emission factor via `emissions.LookupAir` (MTOW fallback from `methodologies.params` on miss); `tCO2 = co2_kg_per_lto_cycle × lto_cycles / 1000`; `USD = tCO2 × air_rate`; breakdown with `emission_source` + `approximate`.
- **Create** `backend/internal/emissions/air_factors.go` — `LookupAir(ctx, db, icaoType, engineType) (AirFactor, bool, error)`: exact `(icao_type, engine_type)` match → `icao_type`‑only (engine unknown) → `found=false` (caller does MTOW fallback). Mirrors the existing `emissions.Lookup` style; orders by most‑recent `effective_from`.
- **Create** `backend/internal/methodologies/params.go` — `LookupMTOWFallback(ctx, db) (slope, intercept float64, err error)`: reads `methodologies.params` for the `(mode='AIR', code='ICAO_LTO')` row.
- **Modify** `backend/internal/tax/handler.go` — extend `CalculateRequest` with `mode` + air fields (`icao_type`, `engine_type`, `mtow_kg`, `lto_cycles`); dispatch by mode; validation.
- **Create** `supabase/migrations/075_greengate_air_pricing_methodology.sql` — (a) `UPDATE methodologies SET params = '{"mtow_fallback":{"slope_kg_co2_per_kg_mtow":S,"intercept_kg":I}}'` for the `ICAO_LTO` row; (b) seed `app_config` key `carbon_tax.air_rate_usd_per_tco2` = the current `carbon_tax.rate_usd_per_tco2` value (admin‑tunable default; UPSERT, idempotent).
- **Create** tests: `backend/internal/tax/air_test.go`, `backend/internal/emissions/air_factors_test.go`, a handler dispatch test, and `supabase/tests/migrations/075_*.test.sql` (light structural: params set on `ICAO_LTO`, air rate key present).

## 4. The AIR calculation (ICAO LTO)

1. **Inputs:** `icao_type` (required), `engine_type` (optional), `mtow_kg`, `lto_cycles` (default `1`, must be > 0).
2. **Emission factor:** `LookupAir(icao_type, engine_type)` → exact match, else `icao_type`‑only, else miss.
   - **Hit** → `co2_kg_per_lto_cycle` from the row; `emission_source='ICAO_EDB'`; `approximate=false`.
   - **Miss** → MTOW fallback: `co2_kg_per_lto_cycle = slope × mtow_kg + intercept` (coefficients from `methodologies.params`); `emission_source='MTOW_FALLBACK'`; `approximate=true`. If `mtow_kg ≤ 0` → **error** (cannot estimate).
3. `tCO2 = co2_kg_per_lto_cycle × lto_cycles / 1000`.
4. **Rate:** `app_config` `carbon_tax.air_rate_usd_per_tco2` (honor `rate_override` like maritime). **Fail‑closed:** missing rate → error, never `$0`.
5. `USD = tCO2 × rate`.

## 5. MTOW fallback coefficients

Linear fit `co2_kg_per_lto ≈ slope × mtow_kg + intercept`, least‑squares over the 12 `air_emission_factors` seed rows paired with each type's MTOW. **Computed during implementation** and written to `methodologies.params` (the `ICAO_LTO` row, mig 075) — the Go calc reads them, never hardcodes. Indicative magnitude from the seed: `slope ≈ 0.029 kg CO2/kg MTOW`, `intercept ≈ 0` (exact values fixed in the plan).

## 6. Contract

`POST /api/v1/tax/calculate`:
```
maritime (unchanged, backward-compatible):
  { "mode"?:"MARITIME", "imo", "category", "gross_tonnage", "distance_nm", "rate_override"? }
air:
  { "mode":"AIR", "icao_type", "engine_type"?, "mtow_kg", "lto_cycles"?:1, "rate_override"? }
→ { "tco2", "usd_amount", "breakdown": {...} }
```
AIR breakdown: `{ emission_source: "ICAO_EDB"|"MTOW_FALLBACK", approximate, co2_kg_per_lto_cycle, lto_cycles, rate_usd_per_tco2 }`. Maritime breakdown unchanged. Implementation note: keep the maritime breakdown JSON stable — either extend the `Breakdown` struct with `omitempty` air fields or use a mode‑tagged breakdown (plan decides; maritime payload must not change).

## 7. Error handling (fail‑closed — design §6, "never a silent $0")

- Unknown `mode` → 400.
- AIR: empty `icao_type` → 400; `lto_cycles ≤ 0` → 400 (default 1 if absent); EDB miss **and** `mtow_kg ≤ 0` → 500 (cannot estimate); missing air rate → 500 (never 0).
- Maritime validation/behavior unchanged.

## 8. Testing

Go unit tests (`cd backend && go test ./...`):
- AIR EDB‑hit (exact match; and `icao_type`‑only match when engine unknown).
- AIR EDB‑miss → MTOW fallback, `approximate=true`, math correct vs the params coefficients.
- `mtow_kg ≤ 0` + miss → error.
- Missing air rate → error (fail‑closed), not 0.
- Mode dispatch: `MARITIME` (and absent mode) routes to the maritime calc; `AIR` routes to air; unknown mode → error.
- Handler 400 validation paths.
- `LookupAir` cascade + `LookupMTOWFallback` params read.
- **Existing maritime calculator/handler tests must stay green** (the refactor is behavior‑preserving).

pg: `supabase db reset` applies 001→075 clean; `075_*.test.sql` PASS (params on `ICAO_LTO`, air rate key seeded); full pg suite stays green.

## 9. Explicitly NOT in W1‑B

Air arrival detection / ADS‑B ingest / FIR geofence (W1‑C) · the frontend proforma‑pipeline call for air + air transaction creation (W1‑C) · onboarding / fleet UI / flip `jurisdiction_mode_config` AIR=enabled (W1‑D) · versioned `tariffs`/`revenue_split` tables (Wedge 2).

## 10. Notes

- Go module: `github.com/htleclerc/africgreen/backend`. Test: `cd backend && go test ./...`.
- The air calc's DB reads (`air_emission_factors`, `methodologies`) use the same `*sql.DB` as `emissions.Lookup`; the calc is a pure type‑keyed computation — jurisdiction enters only via the rate (single‑country for now), so no tenant scoping inside the Go calc.
- `lto_cycles` semantics: one arrival event = 1 LTO cycle by default; W1‑C will pass the value when it wires detection.
