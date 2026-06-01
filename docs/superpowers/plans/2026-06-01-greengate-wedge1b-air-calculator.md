# GreenGate v8 — Wedge 1‑B: `calculator['AIR']` ICAO LTO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add air carbon‑tax calculation to the Go backend via a `calculator[mode]` dispatch — ICAO LTO (per‑LTO‑cycle CO2 from `air_emission_factors`, MTOW fallback + approximate flag), fail‑closed AIR pricing — leaving the maritime calc byte‑identical.

**Architecture:** A `ModeCalculator` interface + registry in `backend/internal/tax`. The existing `Calculator` (maritime) stays untouched; a thin `maritimeMode` adapter implements the interface. A new `airCalculator` implements the air path. `tax.Handler.Calculate` reads `mode` (absent → `MARITIME`) and dispatches. `Result.Breakdown` becomes `any` so each mode returns its own breakdown struct (maritime JSON unchanged).

**Tech Stack:** Go 1.26 (`cd backend && go test ./...`, real local Supabase DB at `127.0.0.1:54322`), PostgreSQL (Supabase), `supabase db reset` + psql harness.

**Spec:** [docs/superpowers/specs/2026-06-01-greengate-wedge1b-air-calculator-design.md](../specs/2026-06-01-greengate-wedge1b-air-calculator-design.md)

**Branch:** `feat/greengate-wedge1b-air-calculator` (already created; spec committed).

**Preconditions:** local Supabase running; mig 074 (`air_emission_factors` + seed) + the `ICAO_LTO` `methodologies` row (mig 071) present on this branch.

---

## File Structure

- **Create** `supabase/migrations/075_greengate_air_pricing_methodology.sql` — MTOW‑fallback coefficients on the `ICAO_LTO` methodology + seed `carbon_tax.air_rate_usd_per_tco2`.
- **Create** `supabase/tests/migrations/075_greengate_air_pricing_methodology.test.sql` — structural assertions.
- **Create** `backend/internal/emissions/air_factors.go` — `LookupAir` over `air_emission_factors`.
- **Create** `backend/internal/emissions/air_factors_test.go`.
- **Create** `backend/internal/methodologies/params.go` — `LookupMTOWFallback` reading `methodologies.params`.
- **Create** `backend/internal/methodologies/params_test.go`.
- **Create** `backend/internal/tax/air.go` — `airCalculator` + `AirBreakdown`.
- **Create** `backend/internal/tax/air_test.go`.
- **Modify** `backend/internal/tax/calculator.go` — `Result.Breakdown` → `any`; add `ModeCalculator` interface + `maritimeMode` adapter + `NewModeRegistry`.
- **Modify** `backend/internal/tax/calculator_test.go` — 2 lines: type‑assert `res.Breakdown.(Breakdown)`.
- **Modify** `backend/internal/tax/handler.go` — `CalculateRequest` air fields + `mode` dispatch.
- **Create** `backend/internal/tax/handler_dispatch_test.go` — mode routing + validation.

---

## Task 1: Migration 075 — MTOW fallback coefficients + AIR rate seed

**Files:**
- Create: `supabase/migrations/075_greengate_air_pricing_methodology.sql`
- Create: `supabase/tests/migrations/075_greengate_air_pricing_methodology.test.sql`

- [ ] **Step 1: Compute the MTOW‑fallback linear fit**

The fallback estimates `co2_kg_per_lto ≈ slope × mtow_kg + intercept`. Compute an ordinary least‑squares fit over these 12 `(mtow_kg, co2_kg_per_lto_cycle)` pairs (the mig‑074 seed types paired with each type's MTOW):

```
A320 78000 2600 | A20N 79000 2150 | A321 93500 2950 | B738 79000 2800
B38M 82200 2400 | E190 51800 1900 | CRJ9 38330 1650 | AT76 23000 560
DH8D 29257 650  | B763 186880 5500 | A332 242000 7000 | B788 227930 6500
```

The least‑squares fit over these pairs is **slope = 0.0280748, intercept = 222.0** (`slope = (nΣxy − ΣxΣy)/(nΣx² − (Σx)²)`, `intercept = ȳ − slope·x̄`). Step 2's migration hardcodes these. **Verify** by recomputing (a throwaway `go run`/python one‑liner over the 12 pairs) — they should match to ~4 significant figures (sanity: A332 242000→~7016 vs seed 7000; B763 186880→~5469 vs 5500; turboprops correctly fall *below* the line). If your recomputation differs materially, use your values and update Step 2.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/075_greengate_air_pricing_methodology.sql` (substitute the computed `<SLOPE>`/`<INTERCEPT>`):

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 075: GreenGate v8 — Wedge 1-B air pricing + ICAO LTO methodology params
--
-- (a) MTOW-fallback coefficients on the ICAO_LTO methodology (mig 071 row). The Go
--     air calculator reads these to estimate CO2/LTO for aircraft types absent from
--     air_emission_factors (flagged "approximate"). Linear fit over the mig-074 seed.
-- (b) Seed carbon_tax.air_rate_usd_per_tco2 = the current maritime rate (admin-tunable
--     default). The calc is fail-closed: a missing rate errors, never a silent $0.
-- ADDITIVE / idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.methodologies
   SET params = jsonb_build_object(
         'mtow_fallback', jsonb_build_object(
           'slope_kg_co2_per_kg_mtow', 0.0280748::numeric,
           'intercept_kg',             222.0::numeric
         ))
 WHERE mode = 'AIR' AND code = 'ICAO_LTO';

-- Seed the AIR rate from the maritime rate (only if maritime exists; idempotent).
INSERT INTO public.app_config (key, value, updated_at)
SELECT 'carbon_tax.air_rate_usd_per_tco2', value, NOW()
  FROM public.app_config
 WHERE key = 'carbon_tax.rate_usd_per_tco2'
ON CONFLICT (key) DO NOTHING;

-- DOWN: UPDATE public.methodologies SET params = NULL WHERE mode='AIR' AND code='ICAO_LTO';
--       DELETE FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2';
```

- [ ] **Step 3: Write the pg test**

Create `supabase/tests/migrations/075_greengate_air_pricing_methodology.test.sql`:

```sql
-- Test 075: air pricing + ICAO LTO methodology params
BEGIN;
DO $$
DECLARE
  v_slope     NUMERIC;
  v_intercept NUMERIC;
  v_air_rate  NUMERIC;
  v_mar_rate  NUMERIC;
BEGIN
  -- (a) MTOW fallback coefficients present + positive slope on the ICAO_LTO methodology
  SELECT (params->'mtow_fallback'->>'slope_kg_co2_per_kg_mtow')::numeric,
         (params->'mtow_fallback'->>'intercept_kg')::numeric
    INTO v_slope, v_intercept
    FROM public.methodologies WHERE mode = 'AIR' AND code = 'ICAO_LTO';
  IF v_slope IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: ICAO_LTO mtow_fallback slope not set';
  END IF;
  IF v_slope <= 0 THEN
    RAISE EXCEPTION 'TEST FAILED: mtow_fallback slope must be positive, got %', v_slope;
  END IF;

  -- (b) air rate seeded equal to the maritime rate
  SELECT value::text::numeric INTO v_air_rate FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2';
  SELECT value::text::numeric INTO v_mar_rate FROM public.app_config WHERE key = 'carbon_tax.rate_usd_per_tco2';
  IF v_air_rate IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: carbon_tax.air_rate_usd_per_tco2 not seeded';
  END IF;
  IF v_air_rate <> v_mar_rate THEN
    RAISE EXCEPTION 'TEST FAILED: air rate % != maritime rate %', v_air_rate, v_mar_rate;
  END IF;
END $$;
ROLLBACK;
SELECT '075 GreenGate air pricing + methodology params: PASS' AS test_result;
```

- [ ] **Step 4: Apply + verify**

Run: `cd c:/Users/lecle/Workspace/africgreen && supabase db reset`
Expected: ends `Finished supabase db reset ...`, includes `Applying migration 075_...`, no `ERROR`.

Run: `bash supabase/tests/run.sh migrations/075_greengate_air_pricing_methodology.test.sql`
Expected: `075 GreenGate air pricing + methodology params: PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/075_greengate_air_pricing_methodology.sql supabase/tests/migrations/075_greengate_air_pricing_methodology.test.sql
git commit -m "feat(db): W1-B air rate + ICAO LTO MTOW-fallback params (mig 075)"
```

---

## Task 2: `emissions.LookupAir`

**Files:**
- Create: `backend/internal/emissions/air_factors.go`
- Test: `backend/internal/emissions/air_factors_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/emissions/air_factors_test.go` (reuses `openTestDB` from `factors_test.go`, same package):

```go
package emissions

import (
	"context"
	"testing"
)

func TestLookupAir_ExactAndIcaoOnlyAndMiss(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()
	ctx := context.Background()

	// exact (icao_type, engine_type) hit — seeded by mig 074
	f, found, err := LookupAir(ctx, db, "A320", "CFM56-5B")
	if err != nil {
		t.Fatalf("LookupAir A320: %v", err)
	}
	if !found || f.CO2KgPerLTOCycle != 2600 {
		t.Fatalf("A320/CFM56-5B: found=%v co2=%v, want true/2600", found, f.CO2KgPerLTOCycle)
	}

	// icao_type match with unknown engine still resolves the type row
	f2, found2, err := LookupAir(ctx, db, "A320", "UNKNOWN-ENGINE")
	if err != nil {
		t.Fatalf("LookupAir A320 unknown engine: %v", err)
	}
	if !found2 || f2.CO2KgPerLTOCycle != 2600 {
		t.Fatalf("A320 icao-only: found=%v co2=%v, want true/2600", found2, f2.CO2KgPerLTOCycle)
	}

	// miss — unseeded type → found=false, no error
	_, found3, err := LookupAir(ctx, db, "ZZZZ", "")
	if err != nil {
		t.Fatalf("LookupAir miss returned error: %v", err)
	}
	if found3 {
		t.Fatalf("ZZZZ: found=true, want false")
	}
}
```

- [ ] **Step 2: Run to verify it fails (compile error — LookupAir undefined)**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/emissions/ -run TestLookupAir`
Expected: FAIL — `undefined: LookupAir`.

- [ ] **Step 3: Implement**

Create `backend/internal/emissions/air_factors.go`:

```go
package emissions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// AirFactor is one row of air_emission_factors (CO2 per ICAO LTO cycle).
type AirFactor struct {
	ID               string
	Source           string
	CO2KgPerLTOCycle float64
}

// LookupAir resolves an air emission factor by aircraft type. It prefers an exact
// (icao_type, engine_type) match, then any row for the icao_type, then most-recent
// effective_from. A type with no row returns found=false (no error) so the caller
// can apply the MTOW fallback.
func LookupAir(ctx context.Context, db *sql.DB, icaoType, engineType string) (AirFactor, bool, error) {
	const q = `
		SELECT id, COALESCE(source, ''), co2_kg_per_lto_cycle
		  FROM public.air_emission_factors
		 WHERE icao_type = $1
		 ORDER BY CASE WHEN $2 <> '' AND engine_type = $2 THEN 0 ELSE 1 END,
		          effective_from DESC
		 LIMIT 1
	`
	var f AirFactor
	err := db.QueryRowContext(ctx, q, icaoType, engineType).
		Scan(&f.ID, &f.Source, &f.CO2KgPerLTOCycle)
	if errors.Is(err, sql.ErrNoRows) {
		return AirFactor{}, false, nil
	}
	if err != nil {
		return AirFactor{}, false, fmt.Errorf("air emissions lookup icao=%s engine=%s: %w", icaoType, engineType, err)
	}
	return f, true, nil
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/emissions/ -run TestLookupAir -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/emissions/air_factors.go backend/internal/emissions/air_factors_test.go
git commit -m "feat(backend): emissions.LookupAir over air_emission_factors (W1-B)"
```

---

## Task 3: `methodologies.LookupMTOWFallback`

**Files:**
- Create: `backend/internal/methodologies/params.go`
- Test: `backend/internal/methodologies/params_test.go`

- [ ] **Step 1: Write the failing test**

Create `backend/internal/methodologies/params_test.go`:

```go
package methodologies

import (
	"context"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestLookupMTOWFallback_ReadsParams(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	defer db.Close()

	slope, intercept, err := LookupMTOWFallback(context.Background(), db)
	if err != nil {
		t.Fatalf("LookupMTOWFallback: %v", err)
	}
	if slope <= 0 {
		t.Fatalf("slope = %v, want > 0", slope)
	}
	_ = intercept // intercept may be ~0; just assert it loaded without error
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/methodologies/ 2>&1 | tail -5`
Expected: FAIL — package/`LookupMTOWFallback` undefined.

- [ ] **Step 3: Implement**

Create `backend/internal/methodologies/params.go`:

```go
// Package methodologies reads versioned CO2 methodology parameters from
// public.methodologies (control-plane). Currently exposes the ICAO LTO
// MTOW-fallback coefficients used by the air tax calculator.
package methodologies

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

type mtowFallback struct {
	Slope     float64 `json:"slope_kg_co2_per_kg_mtow"`
	Intercept float64 `json:"intercept_kg"`
}

// LookupMTOWFallback returns the (slope, intercept) of the ICAO LTO MTOW-fallback
// linear model from methodologies.params (mode='AIR', code='ICAO_LTO').
// Errors if the row or the mtow_fallback params are absent (fail-closed).
func LookupMTOWFallback(ctx context.Context, db *sql.DB) (slope, intercept float64, err error) {
	const q = `
		SELECT params->'mtow_fallback'
		  FROM public.methodologies
		 WHERE mode = 'AIR' AND code = 'ICAO_LTO'
		 ORDER BY version DESC
		 LIMIT 1
	`
	var raw []byte
	if err = db.QueryRowContext(ctx, q).Scan(&raw); err != nil {
		return 0, 0, fmt.Errorf("methodologies: ICAO_LTO params: %w", err)
	}
	if raw == nil {
		return 0, 0, fmt.Errorf("methodologies: ICAO_LTO mtow_fallback params not set")
	}
	var f mtowFallback
	if err = json.Unmarshal(raw, &f); err != nil {
		return 0, 0, fmt.Errorf("methodologies: ICAO_LTO mtow_fallback unmarshal: %w", err)
	}
	return f.Slope, f.Intercept, nil
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/methodologies/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/methodologies/params.go backend/internal/methodologies/params_test.go
git commit -m "feat(backend): methodologies.LookupMTOWFallback (W1-B)"
```

---

## Task 4: `airCalculator` + `Result.Breakdown` → `any`

**Files:**
- Modify: `backend/internal/tax/calculator.go` (Result.Breakdown type)
- Modify: `backend/internal/tax/calculator_test.go` (2 lines)
- Create: `backend/internal/tax/air.go`
- Test: `backend/internal/tax/air_test.go`

- [ ] **Step 1: Change `Result.Breakdown` to `any` in `calculator.go`**

In `backend/internal/tax/calculator.go`, change the `Result` struct field type (only the `Breakdown` field):

```go
type Result struct {
	TCO2      float64 `json:"tco2"`
	USDAmount float64 `json:"usd_amount"`
	Breakdown any     `json:"breakdown"`
}
```

(The maritime `Calculate` still assigns `Breakdown: Breakdown{...}` — boxing a `Breakdown` into `any` marshals to the identical JSON, so the maritime response is unchanged.)

- [ ] **Step 2: Fix the 2 maritime test lines**

In `backend/internal/tax/calculator_test.go`, replace the two `res.Breakdown.` accesses with a type assertion. Change:

```go
	if res.Breakdown.EmissionsFactorSource != "IMO_CATEGORY" {
		t.Fatalf("source = %q, want IMO_CATEGORY", res.Breakdown.EmissionsFactorSource)
	}
	if res.Breakdown.RateUSDPerTCO2 != 40 {
		t.Fatalf("rate = %v, want 40", res.Breakdown.RateUSDPerTCO2)
	}
```

to:

```go
	bd, ok := res.Breakdown.(Breakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want tax.Breakdown", res.Breakdown)
	}
	if bd.EmissionsFactorSource != "IMO_CATEGORY" {
		t.Fatalf("source = %q, want IMO_CATEGORY", bd.EmissionsFactorSource)
	}
	if bd.RateUSDPerTCO2 != 40 {
		t.Fatalf("rate = %v, want 40", bd.RateUSDPerTCO2)
	}
```

- [ ] **Step 3: Write the failing air test**

Create `backend/internal/tax/air_test.go`:

```go
package tax

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func openAirTestDB(t *testing.T) (*sql.DB, *appconfig.Reader) {
	t.Helper()
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	return db, appconfig.New(db)
}

func TestAir_EDBHit(t *testing.T) {
	db, cfg := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, cfg)
	// A320 EDB = 2600 kg/LTO; 1 cycle → 2.6 tCO2; rate 40 (seeded = maritime) → 104 USD
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: 1,
	})
	if err != nil {
		t.Fatalf("Calculate: %v", err)
	}
	if res.USDAmount < 103.9 || res.USDAmount > 104.1 {
		t.Fatalf("USD = %v, want ~104", res.USDAmount)
	}
	bd, ok := res.Breakdown.(AirBreakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want AirBreakdown", res.Breakdown)
	}
	if bd.EmissionSource != "ICAO_EDB" || bd.Approximate {
		t.Fatalf("source=%q approximate=%v, want ICAO_EDB/false", bd.EmissionSource, bd.Approximate)
	}
}

func TestAir_MTOWFallback(t *testing.T) {
	db, cfg := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, cfg)
	// Unseeded type → MTOW fallback, approximate=true, positive amount.
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "ZZZZ", MTOWKg: 80000, LTOCycles: 1,
	})
	if err != nil {
		t.Fatalf("Calculate: %v", err)
	}
	bd, ok := res.Breakdown.(AirBreakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want AirBreakdown", res.Breakdown)
	}
	if bd.EmissionSource != "MTOW_FALLBACK" || !bd.Approximate {
		t.Fatalf("source=%q approximate=%v, want MTOW_FALLBACK/true", bd.EmissionSource, bd.Approximate)
	}
	if res.USDAmount <= 0 {
		t.Fatalf("USD = %v, want > 0", res.USDAmount)
	}
}

func TestAir_MissNoMTOW_Errors(t *testing.T) {
	db, cfg := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, cfg)
	_, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "ZZZZ", MTOWKg: 0, LTOCycles: 1,
	})
	if err == nil {
		t.Fatal("expected error when type unseeded and mtow_kg<=0")
	}
}

func TestAir_MissingRate_FailsClosed(t *testing.T) {
	db, _ := openAirTestDB(t)
	defer db.Close()
	ctx := context.Background()
	const key = "carbon_tax.air_rate_usd_per_tco2"
	var rawVal []byte
	if err := db.QueryRowContext(ctx, `SELECT value FROM public.app_config WHERE key=$1`, key).Scan(&rawVal); err != nil {
		t.Fatalf("read rate: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM public.app_config WHERE key=$1`, key); err != nil {
		t.Fatalf("delete rate: %v", err)
	}
	defer db.ExecContext(ctx, `INSERT INTO public.app_config(key,value,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, key, rawVal)

	calc := newAirCalculator(db, appconfig.New(db)) // fresh reader → no cached rate
	_, err := calc.Calculate(ctx, CalculateRequest{Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: 1})
	if err == nil {
		t.Fatal("expected fail-closed error on missing air rate, got nil (silent $0 is forbidden)")
	}
}
```

(`CalculateRequest` gains air fields in Task 5; this test references them and compiles once both Task 4 and Task 5 are done. Air calc + struct land here; the request fields land in Task 5. To keep this task self-compiling, the air calc reads from `CalculateRequest` — so add the air fields to `CalculateRequest` in **this** task's Step 4, then complete the handler dispatch in Task 5.)

- [ ] **Step 4: Add air fields to `CalculateRequest` + implement `air.go`**

In `backend/internal/tax/handler.go`, extend `CalculateRequest` (add the 5 air fields; keep existing maritime fields):

```go
type CalculateRequest struct {
	Mode         string   `json:"mode,omitempty"` // "MARITIME" (default) | "AIR"
	IMO          string   `json:"imo,omitempty"`
	Category     string   `json:"category,omitempty"`
	GrossTonnage int      `json:"gross_tonnage,omitempty"`
	DistanceNM   float64  `json:"distance_nm,omitempty"`
	ICAOType     string   `json:"icao_type,omitempty"`
	EngineType   string   `json:"engine_type,omitempty"`
	MTOWKg       int      `json:"mtow_kg,omitempty"`
	LTOCycles    int      `json:"lto_cycles,omitempty"`
	RateOverride *float64 `json:"rate_override,omitempty"`
}
```

Create `backend/internal/tax/air.go`:

```go
package tax

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/emissions"
	"github.com/htleclerc/africgreen/backend/internal/methodologies"
)

// AirBreakdown is the air-mode breakdown (per ICAO LTO cycle).
type AirBreakdown struct {
	EmissionSource   string  `json:"emission_source"` // ICAO_EDB | MTOW_FALLBACK
	Approximate      bool    `json:"approximate"`
	CO2KgPerLTOCycle float64 `json:"co2_kg_per_lto_cycle"`
	LTOCycles        int     `json:"lto_cycles"`
	RateUSDPerTCO2   float64 `json:"rate_usd_per_tco2"`
}

type airCalculator struct {
	db  *sql.DB
	cfg *appconfig.Reader
}

func newAirCalculator(db *sql.DB, cfg *appconfig.Reader) *airCalculator {
	return &airCalculator{db: db, cfg: cfg}
}

// Calculate implements ModeCalculator for AIR (ICAO LTO).
func (a *airCalculator) Calculate(ctx context.Context, req CalculateRequest) (Result, error) {
	if req.ICAOType == "" {
		return Result{}, fmt.Errorf("air: icao_type required")
	}
	cycles := req.LTOCycles
	if cycles == 0 {
		cycles = 1
	}
	if cycles < 0 {
		return Result{}, fmt.Errorf("air: lto_cycles must be non-negative")
	}

	co2PerLTO := 0.0
	source := ""
	approximate := false

	f, found, err := emissions.LookupAir(ctx, a.db, req.ICAOType, req.EngineType)
	if err != nil {
		return Result{}, fmt.Errorf("air: factor lookup: %w", err)
	}
	if found {
		co2PerLTO = f.CO2KgPerLTOCycle
		source = "ICAO_EDB"
	} else {
		if req.MTOWKg <= 0 {
			return Result{}, fmt.Errorf("air: no emission factor for %q and mtow_kg<=0; cannot estimate", req.ICAOType)
		}
		slope, intercept, perr := methodologies.LookupMTOWFallback(ctx, a.db)
		if perr != nil {
			return Result{}, fmt.Errorf("air: mtow fallback: %w", perr)
		}
		co2PerLTO = slope*float64(req.MTOWKg) + intercept
		source = "MTOW_FALLBACK"
		approximate = true
	}

	rate := 0.0
	if req.RateOverride != nil {
		rate = *req.RateOverride
	} else {
		v, rerr := a.cfg.GetFloat(ctx, "carbon_tax.air_rate_usd_per_tco2")
		if rerr != nil {
			return Result{}, fmt.Errorf("air: rate: %w", rerr)
		}
		rate = v
	}

	tco2 := co2PerLTO * float64(cycles) / 1000.0
	usd := tco2 * rate

	return Result{
		TCO2:      tco2,
		USDAmount: usd,
		Breakdown: AirBreakdown{
			EmissionSource:   source,
			Approximate:      approximate,
			CO2KgPerLTOCycle: co2PerLTO,
			LTOCycles:        cycles,
			RateUSDPerTCO2:   rate,
		},
	}, nil
}
```

- [ ] **Step 5: Run tests (maritime + air)**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/tax/ -run 'TestCalculate_UsesCascadeAndRate|TestAir' -v`
Expected: PASS (maritime cascade test still green with the type assertion; all 4 air tests pass).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/tax/calculator.go backend/internal/tax/calculator_test.go backend/internal/tax/air.go backend/internal/tax/air_test.go backend/internal/tax/handler.go
git commit -m "feat(backend): air ICAO LTO calculator + AirBreakdown (W1-B)"
```

---

## Task 5: `ModeCalculator` interface + registry + handler dispatch

**Files:**
- Modify: `backend/internal/tax/calculator.go` (interface + adapter + registry)
- Modify: `backend/internal/tax/handler.go` (dispatch)
- Test: `backend/internal/tax/handler_dispatch_test.go`

- [ ] **Step 1: Write the failing dispatch test**

Create `backend/internal/tax/handler_dispatch_test.go`:

```go
package tax

import (
	"context"
	"testing"
)

func TestModeRegistry_DispatchesAndDefaults(t *testing.T) {
	db, cfg := openAirTestDB(t) // helper from air_test.go (same package)
	defer db.Close()
	reg := NewModeRegistry(db, cfg)

	if _, ok := reg["MARITIME"]; !ok {
		t.Fatal("registry missing MARITIME")
	}
	if _, ok := reg["AIR"]; !ok {
		t.Fatal("registry missing AIR")
	}

	// MARITIME routes to the maritime calc (CARGO/30000/140 → ~532 USD, IMO_CATEGORY).
	mres, err := reg["MARITIME"].Calculate(context.Background(), CalculateRequest{
		Mode: "MARITIME", IMO: "none", Category: "CARGO", GrossTonnage: 30000, DistanceNM: 140,
	})
	if err != nil {
		t.Fatalf("maritime dispatch: %v", err)
	}
	if mres.USDAmount < 531 || mres.USDAmount > 533 {
		t.Fatalf("maritime USD = %v, want ~532", mres.USDAmount)
	}
	if _, ok := mres.Breakdown.(Breakdown); !ok {
		t.Fatalf("maritime breakdown type = %T, want tax.Breakdown", mres.Breakdown)
	}

	// AIR routes to the air calc (A320 → AirBreakdown).
	ares, err := reg["AIR"].Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: 1,
	})
	if err != nil {
		t.Fatalf("air dispatch: %v", err)
	}
	if _, ok := ares.Breakdown.(AirBreakdown); !ok {
		t.Fatalf("air breakdown type = %T, want AirBreakdown", ares.Breakdown)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/tax/ -run TestModeRegistry 2>&1 | tail -5`
Expected: FAIL — `undefined: NewModeRegistry`.

- [ ] **Step 3: Add the interface + adapter + registry to `calculator.go`**

Append to `backend/internal/tax/calculator.go`:

```go
// ModeCalculator computes carbon tax for one transport mode from a CalculateRequest.
type ModeCalculator interface {
	Calculate(ctx context.Context, req CalculateRequest) (Result, error)
}

// maritimeMode adapts the existing (maritime) Calculator to ModeCalculator.
type maritimeMode struct{ c *Calculator }

func (m maritimeMode) Calculate(ctx context.Context, req CalculateRequest) (Result, error) {
	return m.c.Calculate(ctx, Input{
		IMO:          req.IMO,
		Category:     req.Category,
		GrossTonnage: req.GrossTonnage,
		DistanceNM:   req.DistanceNM,
		RateOverride: req.RateOverride,
	})
}

// NewModeRegistry builds the mode→calculator dispatch map.
func NewModeRegistry(db *sql.DB, cfg *appconfig.Reader) map[string]ModeCalculator {
	return map[string]ModeCalculator{
		"MARITIME": maritimeMode{c: NewCalculator(db, cfg)},
		"AIR":      newAirCalculator(db, cfg),
	}
}
```

- [ ] **Step 4: Rewire the handler to dispatch by mode**

In `backend/internal/tax/handler.go`, replace the `Handler` struct, `NewHandler`, and `Calculate` method with:

```go
// Handler exposes tax calculation endpoints.
type Handler struct {
	cfg      *config.Config
	registry map[string]ModeCalculator
}

// NewHandler builds a tax HTTP handler. db + appcfg may be nil during early wiring;
// the handler returns 503 in that case rather than panicking.
func NewHandler(cfg *config.Config, db *sql.DB, appcfg *appconfig.Reader) *Handler {
	h := &Handler{cfg: cfg}
	if db != nil && appcfg != nil {
		h.registry = NewModeRegistry(db, appcfg)
	}
	return h
}

// Calculate handles single-asset tax calculation, dispatched by mode.
// POST /api/v1/tax/calculate
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	if h.registry == nil {
		http.Error(w, `{"error":"tax calculator not wired (db/appcfg missing)"}`, http.StatusServiceUnavailable)
		return
	}
	var req CalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	mode := req.Mode
	if mode == "" {
		mode = "MARITIME"
	}
	calc, ok := h.registry[mode]
	if !ok {
		http.Error(w, `{"error":"unknown mode"}`, http.StatusBadRequest)
		return
	}

	switch mode {
	case "MARITIME":
		if req.Category == "" || req.DistanceNM < 0 {
			http.Error(w, `{"error":"category and distance_nm are required"}`, http.StatusBadRequest)
			return
		}
	case "AIR":
		if req.ICAOType == "" {
			http.Error(w, `{"error":"icao_type is required"}`, http.StatusBadRequest)
			return
		}
		if req.LTOCycles < 0 {
			http.Error(w, `{"error":"lto_cycles must be non-negative"}`, http.StatusBadRequest)
			return
		}
	}

	res, err := calc.Calculate(r.Context(), req)
	if err != nil {
		log.Printf("[tax] calculate mode=%s imo=%s icao=%s: %v", mode, req.IMO, req.ICAOType, err)
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}
```

(Leave `BatchCalculate` unchanged. The `Input` struct and `Calculator` stay as-is.)

- [ ] **Step 5: Run the dispatch test + the whole tax package**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go test ./internal/tax/ -v 2>&1 | tail -20`
Expected: PASS (maritime cascade, all air tests, dispatch test).

- [ ] **Step 6: Commit**

```bash
git add backend/internal/tax/calculator.go backend/internal/tax/handler.go backend/internal/tax/handler_dispatch_test.go
git commit -m "feat(backend): calculator[mode] dispatch (maritime|air) in tax handler (W1-B)"
```

---

## Task 6: Full verification

**Files:** none (verification)

- [ ] **Step 1: DB reset (apply 001→075)**

Run: `cd c:/Users/lecle/Workspace/africgreen && supabase db reset 2>&1 | tail -3`
Expected: `Finished supabase db reset ...`, no `ERROR`.

- [ ] **Step 2: Go build + vet + full test**

Run: `cd c:/Users/lecle/Workspace/africgreen/backend && go build ./... && go vet ./... && go test ./... 2>&1 | tail -25`
Expected: build OK, vet clean, all packages `ok` / `PASS` (maritime + air + emissions + methodologies). No `FAIL`.

- [ ] **Step 3: pg suite regression**

Run: `cd c:/Users/lecle/Workspace/africgreen && for t in 071_greengate_foundation_tenancy 074_greengate_aircraft_aviation 075_greengate_air_pricing_methodology; do bash supabase/tests/run.sh "migrations/${t}.test.sql" >/dev/null 2>&1 && echo "$t PASS" || echo "$t FAIL"; done`
Expected: all three `PASS`.

- [ ] **Step 4: Confirm clean tree**

Run: `cd c:/Users/lecle/Workspace/africgreen && git status --short`
Expected: only pre-existing untracked items (`.claude/settings.local.json`, `supabase/qa-screenshots/`); all W1‑B code committed.

---

## Done criteria

- `calculator[mode]` dispatch live: maritime unchanged (existing test green), AIR = ICAO LTO with EDB lookup + MTOW fallback (`approximate` flag) + fail‑closed AIR pricing.
- mig 075 applies clean; `075` pg test + 071/074 regression PASS.
- `go build ./... && go vet ./... && go test ./...` all green against the reset DB.
- No frontend pipeline wiring / detection / UI (those are W1‑C/D).
