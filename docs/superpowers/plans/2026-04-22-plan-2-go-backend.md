# Carbon Tax Pro-Forma — Plan 2: Go Backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Go backend at `backend/` with the code that (a) watches AIS positions for 500 NM corridor entry, (b) detects EEZ entry / exit, (c) computes the emissions-factor cascade, (d) calculates tax at the configured USD/tCO₂ rate, and (e) exposes an alert distance-final HTTP endpoint. After Plan 2, the data pipeline can emit `arrival_alerts` and provide the numbers that Plan 3 (pro-forma) and Plan 4 (reconciliation) need.

**Architecture:** New Go packages under `backend/internal/` connect to the already-migrated Supabase database over `database/sql` (libpq) using the connection string from `SUPABASE_DB_URL`. This sits alongside the existing HTTP/PostgREST path used by `internal/ais/ingester.go` — we do not rewrite the ingester; we add hooks. Each module has a single clear responsibility (config, emissions, corridor, EEZ tracking, reconciliation, alert handler) and is individually testable. A small SQL helper migration (032) adds an RPC function for distance aggregation because that computation is cheaper in SQL than in Go.

**Tech Stack:** Go 1.23, `github.com/jackc/pgx/v5/stdlib` or `github.com/lib/pq` (either works with `database/sql`), Go standard test runner, existing `github.com/gorilla/websocket`, existing `github.com/joho/godotenv`.

**Spec reference:** `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` sections 4, 6.1, 6.5, 12.

**Plan 1 follow-ups to address here:** add SHIPOWNER read policy on `arrival_alerts` and `transactions` (migration 032 inside Task 0 of this plan).

**Scope boundaries:**
- IN scope: Go code for corridor detection, EEZ tracking, emissions cascade, tax calculator, reconcile sweeper, alert distance-final endpoint; a small RPC migration.
- OUT of scope: Next.js workers (Plan 3), PDF generation (Plan 3), Resend email (Plan 3), admin UIs (Plan 5).

**Prereqs:**
- Plan 1 applied (`supabase db reset` ok, 10 migration tests green).
- Local Supabase running on `127.0.0.1:54322`.
- `go --version` returns 1.23+.
- `SUPABASE_DB_URL` set in `backend/.env` or process env to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

---

## Test Strategy

Each Go file gets a `_test.go` sibling exercising:
- Pure-logic functions (distance, cascade ordering) with table-driven tests and no DB.
- DB-touching functions with an integration test that spins up against the running local Supabase, truncates the relevant tables in setup, runs, and leaves the DB in a pre-test state (wrapped in a TX that rollbacks, or explicit cleanup).

The existing `handle_updated_at` trigger and RLS (mig 031) do not apply when connecting as `postgres` superuser — so integration tests run without RLS getting in the way.

**Run all tests:** `cd backend && go test ./... -count=1`

---

## File Structure

```
backend/
  go.mod                                    (modify: add pgx/stdlib)
  internal/
    supadb/
      client.go                             (new — opens sql.DB from SUPABASE_DB_URL)
      client_test.go
    appconfig/
      reader.go                             (new — key→jsonb lookup with TTL cache)
      reader_test.go
    emissions/
      factors.go                            (new — cascade lookup client)
      factors_test.go
    tax/
      calculator.go                         (refactor existing)
      calculator_test.go                    (extend)
      handler.go                            (modify — richer response)
    geo/
      haversine.go                          (new — distance math, shared)
      haversine_test.go
    corridor/
      watcher.go                            (new — 500 NM detector)
      watcher_test.go
    eez/
      detector.go                           (existing — unchanged)
      tracker.go                            (new — entry/exit edge detection)
      tracker_test.go
    reconcile/
      sweeper.go                            (new — periodic ARRIVED→DEPARTED_EEZ transition)
      sweeper_test.go
    alerts/
      handler.go                            (new — GET /api/v1/alerts/:id/distance-final)
      handler_test.go
    ais/
      ingester.go                           (modify — hook corridor + eez tracker after each position)
  cmd/api/
    main.go                                 (modify — wire new handler, launch reconcile sweeper)

supabase/migrations/
  032_alert_distance_rpc.sql                (new — SQL RPC for haversine sum over vessel_positions)
  033_shipowner_read_policies.sql           (new — follow-up RLS policies)

supabase/tests/migrations/
  032_alert_distance.test.sql
  033_shipowner_policies.test.sql
```

---

## Task 0: Schema helpers (migrations 032 + 033)

These are Plan 1 follow-ups that Plan 2 depends on. We apply them first so the Go code has a stable target.

**Files:**
- Create: `supabase/migrations/032_alert_distance_rpc.sql`
- Create: `supabase/migrations/033_shipowner_read_policies.sql`
- Create: `supabase/tests/migrations/032_alert_distance.test.sql`
- Create: `supabase/tests/migrations/033_shipowner_policies.test.sql`

### Step 1 — Write the failing tests

Create `supabase/tests/migrations/032_alert_distance.test.sql`:

```sql
BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='alert_distance_final_nm'
  ), 'function alert_distance_final_nm missing';
END $$;

-- Round trip
DO $$
DECLARE
  v_vessel UUID;
  v_alert  UUID;
  v_dist   NUMERIC;
BEGIN
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999111001','9999111','TEST 032','T032','SO','CARGO',50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts
    (vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm, status,
     arrived_at, departed_eez_at)
  VALUES
    (v_vessel,'9999111',11.0,46.0,0,'DEPARTED_EEZ',
     NOW() - INTERVAL '1 hour', NOW())
  RETURNING id INTO v_alert;

  -- Two synthetic positions 60 NM apart inside the EEZ window
  INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, zone, recorded_at) VALUES
    (v_vessel, 11.00, 45.00, 90, 12, 'EEZ', NOW() - INTERVAL '50 minutes'),
    (v_vessel, 11.00, 46.00, 90, 12, 'EEZ', NOW() - INTERVAL '10 minutes');

  SELECT public.alert_distance_final_nm(v_alert) INTO v_dist;

  -- 1 degree of longitude at 11 deg latitude ≈ 59 NM; allow ±3 NM tolerance
  ASSERT v_dist BETWEEN 55 AND 65,
    format('alert_distance_final_nm returned %s, expected ~59 NM', v_dist);
END $$;

ROLLBACK;
```

Create `supabase/tests/migrations/033_shipowner_policies.test.sql`:

```sql
BEGIN;

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='arrival_alerts' AND schemaname='public'
     AND policyname='shipowner reads own vessel alerts';
  ASSERT n = 1, 'SHIPOWNER read policy on arrival_alerts missing';

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='transactions' AND schemaname='public'
     AND policyname='shipowner reads own transactions';
  ASSERT n = 1, 'SHIPOWNER read policy on transactions missing';
END $$;

ROLLBACK;
```

Run both, confirm they fail:

```bash
./supabase/tests/run.sh migrations/032_alert_distance.test.sql   # ERROR: function missing
./supabase/tests/run.sh migrations/033_shipowner_policies.test.sql  # ERROR: policy missing
```

### Step 2 — Write migration 032

Create `supabase/migrations/032_alert_distance_rpc.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032 : RPC — alert_distance_final_nm
-- Sums haversine segments across vessel_positions between EEZ entry (arrived_at)
-- and EEZ exit (departed_eez_at) for a given arrival_alert. Returned unit: NM.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.alert_distance_final_nm(p_alert_id UUID)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH alert AS (
    SELECT vessel_id, arrived_at, departed_eez_at
      FROM public.arrival_alerts
     WHERE id = p_alert_id
       AND arrived_at IS NOT NULL
       AND departed_eez_at IS NOT NULL
  ),
  points AS (
    SELECT
      vp.lat,
      vp.lng,
      ROW_NUMBER() OVER (ORDER BY vp.recorded_at) AS rn
    FROM public.vessel_positions vp
    JOIN alert a
      ON vp.vessel_id = a.vessel_id
     AND vp.recorded_at >= a.arrived_at
     AND vp.recorded_at <= a.departed_eez_at
  ),
  segments AS (
    SELECT
      p1.lat AS lat1, p1.lng AS lng1,
      p2.lat AS lat2, p2.lng AS lng2
    FROM points p1
    JOIN points p2 ON p2.rn = p1.rn + 1
  )
  SELECT COALESCE(SUM(
    -- Haversine in NM: R_earth_nm * 2 * asin(sqrt(a))
    3440.065 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(lat2 - lat1) / 2), 2)
      + COS(RADIANS(lat1)) * COS(RADIANS(lat2))
        * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
    ))
  ), 0)
  FROM segments;
$$;

COMMENT ON FUNCTION public.alert_distance_final_nm IS
  'Compute total nautical miles transited inside the EEZ for a reconciled alert, summing haversine segments between vessel positions ordered by recorded_at.';
```

### Step 3 — Write migration 033

Create `supabase/migrations/033_shipowner_read_policies.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 033 : SHIPOWNER read policies (follow-up from Plan 1 review)
-- ─────────────────────────────────────────────────────────────────────────────
-- A shipowner with a portal account (profile.role = SHIPOWNER and
-- shipowners.profile_id = auth.uid()) should see alerts and transactions
-- attached to their own vessels.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "shipowner reads own vessel alerts"
  ON public.arrival_alerts FOR SELECT
  USING (EXISTS (
    SELECT 1
      FROM public.vessels v
      JOIN public.shipowners s ON s.id = v.shipowner_id
     WHERE v.id = arrival_alerts.vessel_id
       AND s.profile_id = auth.uid()
  ));

CREATE POLICY "shipowner reads own transactions"
  ON public.transactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipowners s
     WHERE s.id = transactions.shipowner_id
       AND s.profile_id = auth.uid()
  ));
```

### Step 4 — Verify and commit

```bash
supabase db reset
./supabase/tests/run.sh migrations/032_alert_distance.test.sql   # ROLLBACK, exit 0
./supabase/tests/run.sh migrations/033_shipowner_policies.test.sql

git add supabase/migrations/032_alert_distance_rpc.sql \
        supabase/migrations/033_shipowner_read_policies.sql \
        supabase/tests/migrations/032_alert_distance.test.sql \
        supabase/tests/migrations/033_shipowner_policies.test.sql
git commit -m "feat(db): alert_distance_final_nm RPC + SHIPOWNER read policies (migrations 032-033)"
```

---

## Task 1: supadb — sql.DB factory

Extract DB connection setup once so every downstream package uses the same factory.

**Files:**
- Create: `backend/internal/supadb/client.go`
- Create: `backend/internal/supadb/client_test.go`
- Modify: `backend/go.mod` (add `github.com/jackc/pgx/v5` dep)

### Step 1 — Add the driver

```bash
cd backend
go get github.com/jackc/pgx/v5/stdlib
```

### Step 2 — Write the failing test

`backend/internal/supadb/client_test.go`:

```go
package supadb

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestOpen_PingsTheDB(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := Open(url)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
```

Run: `go test ./internal/supadb/ -v` — expected FAIL: `undefined: Open`.

### Step 3 — Implement

`backend/internal/supadb/client.go`:

```go
// Package supadb holds the single sql.DB connection factory used by every
// domain package that needs to read or write Supabase Postgres directly.
package supadb

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open returns a *sql.DB connected to the given postgres URL.
// The pool is configured conservatively (5 conns) because the Go backend
// is a single-replica long-running service; if we scale horizontally we
// will revisit the pool size.
func Open(url string) (*sql.DB, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("supadb open: %w", err)
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	return db, nil
}
```

### Step 4 — Verify

```bash
go test ./internal/supadb/ -v
```

Expected: PASS.

### Step 5 — Commit

```bash
git add backend/go.mod backend/go.sum backend/internal/supadb/
git commit -m "feat(backend): supadb.Open factory for SUPABASE_DB_URL"
```

---

## Task 2: appconfig reader with TTL cache

Read `app_config` keys with a 60s in-memory cache so hot paths don't hammer the DB.

**Files:**
- Create: `backend/internal/appconfig/reader.go`
- Create: `backend/internal/appconfig/reader_test.go`

### Step 1 — Failing test

`backend/internal/appconfig/reader_test.go`:

```go
package appconfig

import (
	"context"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func openTestDB(t *testing.T) *Reader {
	t.Helper()
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return New(db)
}

func TestGetInt_ReadsSeededRate(t *testing.T) {
	r := openTestDB(t)
	got, err := r.GetInt(context.Background(), "carbon_tax.rate_usd_per_tco2")
	if err != nil {
		t.Fatalf("GetInt: %v", err)
	}
	if got != 40 {
		t.Fatalf("rate = %d, want 40", got)
	}
}

func TestGetBool_False(t *testing.T) {
	r := openTestDB(t)
	got, err := r.GetBool(context.Background(), "feature.ais_global_enabled")
	if err != nil {
		t.Fatalf("GetBool: %v", err)
	}
	if got {
		t.Fatalf("feature.ais_global_enabled = true, want false")
	}
}

func TestGetStringSlice_Languages(t *testing.T) {
	r := openTestDB(t)
	got, err := r.GetStringSlice(context.Background(), "proforma.languages_default")
	if err != nil {
		t.Fatalf("GetStringSlice: %v", err)
	}
	want := []string{"en", "fr", "ar"}
	if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("languages = %v, want %v", got, want)
	}
}
```

Expected: FAIL with `undefined: New` etc.

### Step 2 — Implement

`backend/internal/appconfig/reader.go`:

```go
// Package appconfig is a thin cache layer over the app_config table.
// All config keys are stored as JSONB; this package hides the type coercion
// and adds a 60s TTL so hot paths (tax calc, corridor detection) do not
// hammer the DB.
package appconfig

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

const defaultTTL = 60 * time.Second

type entry struct {
	raw        json.RawMessage
	fetchedAt  time.Time
}

type Reader struct {
	db    *sql.DB
	mu    sync.RWMutex
	cache map[string]entry
	ttl   time.Duration
}

func New(db *sql.DB) *Reader {
	return &Reader{db: db, cache: make(map[string]entry), ttl: defaultTTL}
}

func (r *Reader) getRaw(ctx context.Context, key string) (json.RawMessage, error) {
	r.mu.RLock()
	if e, ok := r.cache[key]; ok && time.Since(e.fetchedAt) < r.ttl {
		r.mu.RUnlock()
		return e.raw, nil
	}
	r.mu.RUnlock()

	var raw []byte
	err := r.db.QueryRowContext(ctx,
		"SELECT value FROM public.app_config WHERE key = $1", key).Scan(&raw)
	if err != nil {
		return nil, fmt.Errorf("appconfig %q: %w", key, err)
	}

	r.mu.Lock()
	r.cache[key] = entry{raw: raw, fetchedAt: time.Now()}
	r.mu.Unlock()
	return raw, nil
}

func (r *Reader) GetInt(ctx context.Context, key string) (int, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return 0, err
	}
	var v int
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, fmt.Errorf("appconfig %q as int: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetFloat(ctx context.Context, key string) (float64, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return 0, err
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return 0, fmt.Errorf("appconfig %q as float: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetBool(ctx context.Context, key string) (bool, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return false, err
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, fmt.Errorf("appconfig %q as bool: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetString(ctx context.Context, key string) (string, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return "", err
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", fmt.Errorf("appconfig %q as string: %w", key, err)
	}
	return v, nil
}

func (r *Reader) GetStringSlice(ctx context.Context, key string) ([]string, error) {
	raw, err := r.getRaw(ctx, key)
	if err != nil {
		return nil, err
	}
	var v []string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("appconfig %q as []string: %w", key, err)
	}
	return v, nil
}
```

### Step 3 — Verify

```bash
go test ./internal/appconfig/ -v
```

Expected: 3 tests PASS.

### Step 4 — Commit

```bash
git add backend/internal/appconfig/
git commit -m "feat(backend): appconfig reader with 60s TTL cache"
```

---

## Task 3: haversine helper

Shared geo math for both corridor and reconcile.

**Files:**
- Create: `backend/internal/geo/haversine.go`
- Create: `backend/internal/geo/haversine_test.go`

### Step 1 — Failing test

`backend/internal/geo/haversine_test.go`:

```go
package geo

import (
	"math"
	"testing"
)

func TestHaversineNM_Known(t *testing.T) {
	// Berbera (10.43, 45.02) to Aden (12.78, 45.04) ≈ 141 NM
	got := HaversineNM(10.43, 45.02, 12.78, 45.04)
	if math.Abs(got-141) > 3 {
		t.Fatalf("got %.2f NM, want ~141", got)
	}
}

func TestHaversineNM_Zero(t *testing.T) {
	got := HaversineNM(10, 45, 10, 45)
	if got != 0 {
		t.Fatalf("want 0, got %v", got)
	}
}
```

Expected: FAIL `undefined: HaversineNM`.

### Step 2 — Implement

`backend/internal/geo/haversine.go`:

```go
// Package geo provides stateless geographic math.
// Unit of distance: nautical miles (NM), using mean earth radius 3440.065 NM.
package geo

import "math"

const earthRadiusNM = 3440.065

// HaversineNM returns the great-circle distance between two lat/lng pairs.
func HaversineNM(lat1, lng1, lat2, lng2 float64) float64 {
	rlat1 := lat1 * math.Pi / 180
	rlat2 := lat2 * math.Pi / 180
	dlat := (lat2 - lat1) * math.Pi / 180
	dlng := (lng2 - lng1) * math.Pi / 180

	a := math.Sin(dlat/2)*math.Sin(dlat/2) +
		math.Cos(rlat1)*math.Cos(rlat2)*math.Sin(dlng/2)*math.Sin(dlng/2)
	return earthRadiusNM * 2 * math.Asin(math.Sqrt(a))
}
```

### Step 3 — Verify

```bash
go test ./internal/geo/ -v
```

### Step 4 — Commit

```bash
git add backend/internal/geo/
git commit -m "feat(backend): geo.HaversineNM"
```

---

## Task 4: emissions factor cascade

Look up the best emissions factor for (imo, category, gross_tonnage) in the cascade order EU_MRV → IMO_CATEGORY → FALLBACK.

**Files:**
- Create: `backend/internal/emissions/factors.go`
- Create: `backend/internal/emissions/factors_test.go`

### Step 1 — Failing test

`backend/internal/emissions/factors_test.go`:

```go
package emissions

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestLookup_IMOCategoryCARGO(t *testing.T) {
	db := openTestDB(t)
	f, err := Lookup(context.Background(), db, "nonexistent-imo", "CARGO", 30000)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if f.Source != "IMO_CATEGORY" {
		t.Fatalf("source = %q, want IMO_CATEGORY", f.Source)
	}
	if f.GramsCO2PerNM != 95000 {
		t.Fatalf("factor = %v, want 95000 (GHG4 medium cargo seed)", f.GramsCO2PerNM)
	}
}

func TestLookup_EUMRVHasPriority(t *testing.T) {
	db := openTestDB(t)
	// Seed an EU_MRV factor for a specific IMO, then verify cascade picks it
	_, err := db.ExecContext(context.Background(),
		`INSERT INTO public.emission_factors (source, imo_number, grams_co2_per_nm)
		 VALUES ('EU_MRV', 'TEST-IMO-9111', 72000)
		 ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.emission_factors WHERE imo_number='TEST-IMO-9111'`)

	f, err := Lookup(context.Background(), db, "TEST-IMO-9111", "CARGO", 30000)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if f.Source != "EU_MRV" {
		t.Fatalf("source = %q, want EU_MRV (priority 1)", f.Source)
	}
	if f.GramsCO2PerNM != 72000 {
		t.Fatalf("factor = %v, want 72000", f.GramsCO2PerNM)
	}
}

func TestLookup_Fallback(t *testing.T) {
	db := openTestDB(t)
	// Use a category string outside the enum to force fallback; since vessel_category
	// is an enum, we instead use a GT outside every IMO_CATEGORY range for that category.
	// The seed has CARGO 0-200000 covered by 3 rows, so pick GT > 200000.
	f, err := Lookup(context.Background(), db, "none", "CARGO", 250000)
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if f.Source != "FALLBACK" {
		t.Fatalf("source = %q, want FALLBACK", f.Source)
	}
	if f.GramsCO2PerNM != 50000 {
		t.Fatalf("factor = %v, want 50000 (FALLBACK seed)", f.GramsCO2PerNM)
	}
}
```

Expected: FAIL `undefined: Lookup`.

### Step 2 — Implement

`backend/internal/emissions/factors.go`:

```go
// Package emissions implements the cascade lookup over emission_factors.
// Priority: EU_MRV (per-IMO) > IMO_CATEGORY (per category + GT range) > FALLBACK.
package emissions

import (
	"context"
	"database/sql"
	"fmt"
)

type Factor struct {
	ID             string  // UUID, for storage in transactions.emission_factor_used_id
	Source         string  // EU_MRV | IMO_CATEGORY | FALLBACK
	GramsCO2PerNM  float64
}

// Lookup runs the three-tier cascade in a single SQL query ordered by source priority.
func Lookup(ctx context.Context, db *sql.DB, imo, category string, grossTonnage int) (Factor, error) {
	const q = `
		SELECT id, source::text, grams_co2_per_nm
		  FROM public.emission_factors
		 WHERE active = TRUE
		   AND (
		     (source = 'EU_MRV' AND imo_number = $1)
		     OR (source = 'IMO_CATEGORY' AND vessel_category = $2::public.vessel_category
		         AND $3 BETWEEN COALESCE(gt_min, 0) AND COALESCE(gt_max, 2147483647))
		     OR (source = 'FALLBACK')
		   )
		 ORDER BY CASE source
		            WHEN 'EU_MRV' THEN 1
		            WHEN 'IMO_CATEGORY' THEN 2
		            ELSE 3
		          END
		 LIMIT 1
	`
	var f Factor
	if err := db.QueryRowContext(ctx, q, imo, category, grossTonnage).
		Scan(&f.ID, &f.Source, &f.GramsCO2PerNM); err != nil {
		return Factor{}, fmt.Errorf("emissions lookup imo=%s cat=%s gt=%d: %w",
			imo, category, grossTonnage, err)
	}
	return f, nil
}
```

### Step 3 — Verify

```bash
go test ./internal/emissions/ -v
```

Expected: 3 tests PASS.

### Step 4 — Commit

```bash
git add backend/internal/emissions/
git commit -m "feat(backend): emissions cascade lookup (EU_MRV>IMO_CATEGORY>FALLBACK)"
```

---

## Task 5: tax calculator refactor

The existing `internal/tax/handler.go` computes tax from hardcoded values. Refactor the calculator to consume the cascade + app_config rate and return a richer breakdown.

**Files:**
- Modify: `backend/internal/tax/handler.go`
- Create/Modify: `backend/internal/tax/calculator.go`
- Create: `backend/internal/tax/calculator_test.go`

### Step 1 — Inspect existing code

```bash
cat backend/internal/tax/handler.go
```

Read the current signature — we keep the HTTP surface backward-compatible where possible and add a `breakdown` object to the response.

### Step 2 — Failing test

`backend/internal/tax/calculator_test.go`:

```go
package tax

import (
	"context"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestCalculate_UsesCascadeAndRate(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	defer db.Close()

	cfg := appconfig.New(db)
	calc := NewCalculator(db, cfg)

	// CARGO, GT 30000, distance 140 NM → IMO_CATEGORY medium cargo 95000 g/NM
	// tCO2 = 140 * 95000 / 1e6 = 13.3
	// USD = 13.3 * 40 = 532
	res, err := calc.Calculate(context.Background(), Input{
		IMO:           "none",
		Category:      "CARGO",
		GrossTonnage:  30000,
		DistanceNM:    140,
	})
	if err != nil {
		t.Fatalf("Calculate: %v", err)
	}
	if res.USDAmount < 531 || res.USDAmount > 533 {
		t.Fatalf("USD = %v, want ~532", res.USDAmount)
	}
	if res.Breakdown.Source != "IMO_CATEGORY" {
		t.Fatalf("source = %q, want IMO_CATEGORY", res.Breakdown.Source)
	}
	if res.Breakdown.RateUSDPerTCO2 != 40 {
		t.Fatalf("rate = %v, want 40", res.Breakdown.RateUSDPerTCO2)
	}
}
```

Expected: FAIL (new types/functions).

### Step 3 — Implement calculator

`backend/internal/tax/calculator.go`:

```go
// Package tax computes carbon tax for a given vessel + transit distance.
// Formula: tax_USD = distance_NM × factor_g_CO2_per_NM × 1e-6 × rate_USD_per_tCO2
package tax

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/emissions"
)

type Input struct {
	IMO          string
	Category     string  // public.vessel_category enum literal
	GrossTonnage int
	DistanceNM   float64
	RateOverride *float64 // optional: if nil, read app_config
}

type Breakdown struct {
	DistanceNM                float64
	EmissionsFactorGCO2PerNM  float64
	EmissionsFactorSource     string
	EmissionsFactorID         string
	RateUSDPerTCO2            float64
}

type Result struct {
	TCO2      float64
	USDAmount float64
	Breakdown Breakdown
}

type Calculator struct {
	db  *sql.DB
	cfg *appconfig.Reader
}

func NewCalculator(db *sql.DB, cfg *appconfig.Reader) *Calculator {
	return &Calculator{db: db, cfg: cfg}
}

func (c *Calculator) Calculate(ctx context.Context, in Input) (Result, error) {
	if in.DistanceNM < 0 {
		return Result{}, fmt.Errorf("distance must be non-negative")
	}

	f, err := emissions.Lookup(ctx, c.db, in.IMO, in.Category, in.GrossTonnage)
	if err != nil {
		return Result{}, fmt.Errorf("tax: factor lookup: %w", err)
	}

	rate := 0.0
	if in.RateOverride != nil {
		rate = *in.RateOverride
	} else {
		v, err := c.cfg.GetFloat(ctx, "carbon_tax.rate_usd_per_tco2")
		if err != nil {
			return Result{}, fmt.Errorf("tax: rate: %w", err)
		}
		rate = v
	}

	tco2 := in.DistanceNM * f.GramsCO2PerNM / 1e6
	usd := tco2 * rate

	return Result{
		TCO2:      tco2,
		USDAmount: usd,
		Breakdown: Breakdown{
			DistanceNM:               in.DistanceNM,
			EmissionsFactorGCO2PerNM: f.GramsCO2PerNM,
			EmissionsFactorSource:    f.Source,
			EmissionsFactorID:        f.ID,
			RateUSDPerTCO2:           rate,
		},
	}, nil
}
```

### Step 4 — Update HTTP handler

Read `backend/internal/tax/handler.go` to see current shape, then update to use the new `Calculator`. The request body expands to include `imo`, `category`, `gross_tonnage`, `distance_nm`, and the response includes the `Breakdown` struct as `breakdown`. Keep the existing `POST /api/v1/tax/calculate` and `POST /api/v1/tax/batch` routes.

Replace the handler's current internal calculation with a call to `Calculator.Calculate` and serialize the richer response. Preserve input backward compatibility by keeping any legacy fields that existing callers rely on — if in doubt, accept both legacy and new fields and have the handler translate.

### Step 5 — Verify

```bash
go test ./internal/tax/ -v
```

Expected: PASS.

### Step 6 — Commit

```bash
git add backend/internal/tax/
git commit -m "feat(backend): tax calculator uses cascade + app_config rate, returns breakdown"
```

---

## Task 6: corridor watcher

Given a new AIS position, decide whether it enters the 500 NM approach corridor and create an `arrival_alerts` row if so.

**Files:**
- Create: `backend/internal/corridor/watcher.go`
- Create: `backend/internal/corridor/watcher_test.go`

### Step 1 — Failing test

`backend/internal/corridor/watcher_test.go`:

```go
package corridor

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestEvaluate_WithinCorridor_CreatesAlert(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Fixture: insert a vessel close to Berbera (10.43, 45.02) — within 500 NM
	var vesselID string
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999222001','TEST-CORR','MV CORRIDOR','TC01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vesselID)

	cfg := appconfig.New(db)
	w := New(db, cfg)

	_, err = w.Evaluate(context.Background(), Position{
		VesselID:    vesselID,
		IMO:         "TEST-CORR",
		Lat:         11.0, // ~70 NM from Berbera
		Lng:         45.0,
		SpeedKnots:  12,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}

	// Alert should exist with status DETECTED
	var status string
	err = db.QueryRowContext(context.Background(),
		`SELECT status::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&status)
	if err != nil {
		t.Fatalf("alert not found: %v", err)
	}
	if status != "DETECTED" {
		t.Fatalf("status = %q, want DETECTED", status)
	}
}

func TestEvaluate_Duplicate_NoSecondAlert(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	var vesselID string
	_ = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999222002','TEST-CORR-2','MV DUP','TC02','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vesselID)

	cfg := appconfig.New(db)
	w := New(db, cfg)
	pos := Position{VesselID: vesselID, IMO: "TEST-CORR-2", Lat: 11.0, Lng: 45.0, SpeedKnots: 12, RecordedAt: time.Now()}
	_, _ = w.Evaluate(context.Background(), pos)
	_, _ = w.Evaluate(context.Background(), pos) // second call

	var n int
	db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&n)
	if n != 1 {
		t.Fatalf("active alert count = %d, want 1 (unique partial index)", n)
	}
}
```

Expected: FAIL (undefined `New`, `Position`, `Evaluate`).

### Step 2 — Implement

`backend/internal/corridor/watcher.go`:

```go
// Package corridor detects AIS positions inside the approach corridor
// (configurable radius around destination ports) and records
// arrival_alerts rows so the pro-forma pipeline can pick them up.
package corridor

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/geo"
)

// Destination ports (lat, lng) to check proximity against.
// Kept in code for now; migration to GeoJSON/DB happens in a later plan.
var destinations = []struct {
	Name string
	Lat  float64
	Lng  float64
}{
	{"Berbera", 10.43, 45.02},
	{"Zeila", 11.35, 43.48},
}

type Position struct {
	VesselID   string
	IMO        string
	Lat        float64
	Lng        float64
	SpeedKnots float64
	RecordedAt time.Time
}

type Watcher struct {
	db  *sql.DB
	cfg *appconfig.Reader
}

func New(db *sql.DB, cfg *appconfig.Reader) *Watcher {
	return &Watcher{db: db, cfg: cfg}
}

// Evaluate reports whether the position triggered a new alert. If the vessel
// is inside the corridor and has no active alert, a DETECTED row is created.
// Returns the alert id (empty if no alert was created) and any error.
func (w *Watcher) Evaluate(ctx context.Context, p Position) (string, error) {
	if p.IMO == "" {
		return "", nil // no-op: corridor detection requires an IMO
	}

	radiusNM, err := w.cfg.GetFloat(ctx, "arrival.corridor_radius_nm")
	if err != nil {
		return "", fmt.Errorf("corridor: read radius: %w", err)
	}

	bestDist := math.MaxFloat64
	for _, d := range destinations {
		if dist := geo.HaversineNM(p.Lat, p.Lng, d.Lat, d.Lng); dist < bestDist {
			bestDist = dist
		}
	}
	if bestDist > radiusNM {
		return "", nil // outside corridor
	}

	// Simple ETA: straight-line time at current speed, min 6 knots to avoid /0.
	speed := p.SpeedKnots
	if speed < 6 {
		speed = 6
	}
	eta := p.RecordedAt.Add(time.Duration(bestDist/speed*float64(time.Hour)) * 1)
	// Conservative estimated EEZ transit: 1.5× straight-line to port.
	estRoute := bestDist * 1.5

	var alertID string
	err = w.db.QueryRowContext(ctx, `
		INSERT INTO public.arrival_alerts
		  (vessel_id, imo_number, detected_lat, detected_lng,
		   distance_to_port_nm, estimated_eta, estimated_route_nm, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'DETECTED')
		RETURNING id
	`, p.VesselID, p.IMO, p.Lat, p.Lng, bestDist, eta, estRoute).Scan(&alertID)
	if err != nil {
		// Unique partial index on (vessel_id) WHERE status NOT IN (RECONCILED, CANCELLED)
		// will reject a second active alert. That is the intended deduplication path.
		if isUniqueViolation(err) {
			return "", nil
		}
		return "", fmt.Errorf("corridor: insert alert: %w", err)
	}
	return alertID, nil
}

func isUniqueViolation(err error) bool {
	// pgx surfaces pg errors as a *pgconn.PgError. Using a string match keeps the
	// import surface small; if more callers need to distinguish, we can switch
	// to errors.As on *pgconn.PgError.
	return err != nil && containsAny(err.Error(), "unique", "duplicate key", "23505")
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if sub != "" && (len(s) >= len(sub)) {
			for i := 0; i+len(sub) <= len(s); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}

var _ = errors.New // keep import tidy if later changes touch this
```

Note on `isUniqueViolation`: a cleaner implementation is to use `errors.As` with `*pgconn.PgError`, but pulling that dependency here adds noise. Left as a follow-up if the pattern repeats.

### Step 3 — Verify

```bash
go test ./internal/corridor/ -v
```

Expected: 2 tests PASS.

### Step 4 — Commit

```bash
git add backend/internal/corridor/
git commit -m "feat(backend): corridor.Watcher — detect 500 NM approach, insert arrival_alerts"
```

---

## Task 7: EEZ tracker (entry / exit edge detection)

Tracks the last-known zone per vessel and fires edge events (entered EEZ → transition alert to ARRIVED; left EEZ → DEPARTED_EEZ).

**Files:**
- Create: `backend/internal/eez/tracker.go`
- Create: `backend/internal/eez/tracker_test.go`

### Step 1 — Failing test

`backend/internal/eez/tracker_test.go`:

```go
package eez

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestOnPosition_EntryMovesAlertToArrived(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Fixture vessel
	var vID string
	_ = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots,
		    compliance_status, last_zone)
		 VALUES ('999333001','TEST-EEZ-E','MV EEZ','TEZ01','SO','CARGO',
		         50000,20000,14.0,'APPROACHING','INTERNATIONAL')
		 ON CONFLICT (imo_number) DO UPDATE SET last_zone='INTERNATIONAL'
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vID)

	// Existing alert in PROFORMA_SENT state
	_, _ = db.ExecContext(context.Background(),
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status)
		 VALUES ($1, 'TEST-EEZ-E', 11.5, 46, 300, 'PROFORMA_SENT')`, vID)

	tr := NewTracker(db)
	// Position inside EEZ (matches mig 003 polygon around 10.5, 45)
	_, err := tr.OnPosition(context.Background(), Position{
		VesselID: vID, Lat: 10.5, Lng: 45.0, RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("OnPosition: %v", err)
	}

	var status string
	_ = db.QueryRowContext(context.Background(),
		`SELECT status::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 ORDER BY detected_at DESC LIMIT 1`, vID).Scan(&status)
	if status != "ARRIVED" {
		t.Fatalf("status = %q, want ARRIVED", status)
	}
}
```

Expected: FAIL (`undefined: NewTracker` etc.).

### Step 2 — Implement

`backend/internal/eez/tracker.go`:

```go
// Package eez (extension) tracks zone edges per vessel so the pipeline can
// react to EEZ entry and exit. The underlying point-in-polygon logic lives
// in detector.go (existing).
package eez

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Position struct {
	VesselID   string
	Lat        float64
	Lng        float64
	RecordedAt time.Time
}

type Event struct {
	VesselID string
	From     Zone
	To       Zone
}

type Tracker struct {
	db *sql.DB
}

func NewTracker(db *sql.DB) *Tracker {
	return &Tracker{db: db}
}

// OnPosition evaluates the zone and updates arrival_alerts if an edge crossed.
// Returns the event (with From/To zones) so callers can log/observe.
func (t *Tracker) OnPosition(ctx context.Context, p Position) (Event, error) {
	now := Detect(p.Lat, p.Lng)

	// Read previous zone from vessels.last_zone
	var prev sql.NullString
	if err := t.db.QueryRowContext(ctx,
		`SELECT last_zone FROM public.vessels WHERE id=$1`, p.VesselID,
	).Scan(&prev); err != nil {
		return Event{}, fmt.Errorf("eez tracker: read last_zone: %w", err)
	}
	prevZone := Zone(prev.String)

	evt := Event{VesselID: p.VesselID, From: prevZone, To: now}

	// Update vessels.last_zone
	if _, err := t.db.ExecContext(ctx,
		`UPDATE public.vessels SET last_zone=$1 WHERE id=$2`,
		string(now), p.VesselID,
	); err != nil {
		return evt, fmt.Errorf("eez tracker: write last_zone: %w", err)
	}

	entered := (prevZone != ZoneEEZ && prevZone != ZonePortVicinity) &&
		(now == ZoneEEZ || now == ZonePortVicinity)
	exited := (prevZone == ZoneEEZ || prevZone == ZonePortVicinity) &&
		(now != ZoneEEZ && now != ZonePortVicinity)

	if entered {
		// Flip the active alert (if any) to ARRIVED with arrived_at timestamp.
		// If no active alert exists, create one retroactively.
		res, err := t.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='ARRIVED', arrived_at=$1
			  WHERE vessel_id=$2
			    AND status IN ('PROFORMA_SENT','MATCHED_AUTO','CLAIMED','UNCLAIMED','ESCALATED','DETECTED')`,
			p.RecordedAt, p.VesselID)
		if err != nil {
			return evt, fmt.Errorf("eez tracker: update to ARRIVED: %w", err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			// Retroactive alert: we have to read vessel.imo_number first
			var imo string
			_ = t.db.QueryRowContext(ctx,
				`SELECT imo_number FROM public.vessels WHERE id=$1`, p.VesselID).Scan(&imo)
			if imo != "" {
				_, _ = t.db.ExecContext(ctx,
					`INSERT INTO public.arrival_alerts
					   (vessel_id, imo_number, detected_lat, detected_lng,
					    distance_to_port_nm, status, arrived_at)
					 VALUES ($1, $2, $3, $4, 0, 'ARRIVED', $5)`,
					p.VesselID, imo, p.Lat, p.Lng, p.RecordedAt)
			}
		}
	}

	if exited {
		_, err := t.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='DEPARTED_EEZ', departed_eez_at=$1
			  WHERE vessel_id=$2 AND status='ARRIVED'`,
			p.RecordedAt, p.VesselID)
		if err != nil {
			return evt, fmt.Errorf("eez tracker: update to DEPARTED_EEZ: %w", err)
		}
	}

	return evt, nil
}
```

### Step 3 — Verify

```bash
go test ./internal/eez/ -v
```

Expected: PASS.

### Step 4 — Commit

```bash
git add backend/internal/eez/tracker.go backend/internal/eez/tracker_test.go
git commit -m "feat(backend): eez.Tracker — ARRIVED/DEPARTED_EEZ edge detection"
```

---

## Task 8: reconcile sweeper

Periodic background sweep that catches EEZ-exit events that the per-position tracker may have missed (e.g., after a crash).

**Files:**
- Create: `backend/internal/reconcile/sweeper.go`
- Create: `backend/internal/reconcile/sweeper_test.go`

### Step 1 — Failing test

`backend/internal/reconcile/sweeper_test.go`:

```go
package reconcile

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestRunOnce_DetectsEEZExit(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Fixture vessel with latest position in INTERNATIONAL waters + alert ARRIVED
	var vID string
	_ = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999444001','TEST-SWEEP','MV SWEEP','TSW01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name=EXCLUDED.name
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessel_positions WHERE vessel_id=$1`, vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vID)

	// Alert is ARRIVED but vessel's latest position is clearly outside EEZ
	_, _ = db.ExecContext(context.Background(),
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status, arrived_at)
		 VALUES ($1, 'TEST-SWEEP', 10.5, 45, 0, 'ARRIVED', NOW() - INTERVAL '2 hour')`, vID)
	_, _ = db.ExecContext(context.Background(),
		`INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, recorded_at)
		 VALUES ($1, 2.0, 55.0, 90, 12, NOW())`, vID)

	s := NewSweeper(db)
	n, err := s.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if n < 1 {
		t.Fatalf("swept %d, want >= 1", n)
	}

	var status string
	_ = db.QueryRowContext(context.Background(),
		`SELECT status::text FROM public.arrival_alerts WHERE vessel_id=$1`, vID).Scan(&status)
	if status != "DEPARTED_EEZ" {
		t.Fatalf("status = %q, want DEPARTED_EEZ", status)
	}
}

func TestStart_RunsTicksUntilContextCancel(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	s := NewSweeper(db)
	done := make(chan error, 1)
	go func() { done <- s.Start(ctx, 50*time.Millisecond) }()
	time.Sleep(200 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Start returned: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Sweeper did not stop on context cancel")
	}
}
```

Expected: FAIL.

### Step 2 — Implement

`backend/internal/reconcile/sweeper.go`:

```go
// Package reconcile periodically scans ARRIVED alerts and transitions them to
// DEPARTED_EEZ when the vessel's most recent position has left the EEZ. The
// per-position eez.Tracker handles the hot path; this sweeper is the safety
// net for dropped AIS messages.
package reconcile

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/eez"
)

type Sweeper struct {
	db *sql.DB
}

func NewSweeper(db *sql.DB) *Sweeper {
	return &Sweeper{db: db}
}

// RunOnce scans and returns the number of alerts transitioned to DEPARTED_EEZ.
func (s *Sweeper) RunOnce(ctx context.Context) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.vessel_id,
		       (SELECT vp.lat FROM public.vessel_positions vp
		         WHERE vp.vessel_id=a.vessel_id ORDER BY vp.recorded_at DESC LIMIT 1),
		       (SELECT vp.lng FROM public.vessel_positions vp
		         WHERE vp.vessel_id=a.vessel_id ORDER BY vp.recorded_at DESC LIMIT 1),
		       (SELECT vp.recorded_at FROM public.vessel_positions vp
		         WHERE vp.vessel_id=a.vessel_id ORDER BY vp.recorded_at DESC LIMIT 1)
		  FROM public.arrival_alerts a
		 WHERE a.status='ARRIVED' AND a.departed_eez_at IS NULL
	`)
	if err != nil {
		return 0, fmt.Errorf("sweeper: query: %w", err)
	}
	defer rows.Close()

	type pending struct {
		alertID    string
		vesselID   string
		lat        float64
		lng        float64
		recordedAt time.Time
	}
	var all []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.alertID, &p.vesselID, &p.lat, &p.lng, &p.recordedAt); err != nil {
			return 0, fmt.Errorf("sweeper: scan: %w", err)
		}
		all = append(all, p)
	}

	n := 0
	for _, p := range all {
		zone := eez.Detect(p.lat, p.lng)
		if zone == eez.ZoneEEZ || zone == eez.ZonePortVicinity {
			continue
		}
		_, err := s.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='DEPARTED_EEZ', departed_eez_at=$1
			  WHERE id=$2 AND status='ARRIVED'`,
			p.recordedAt, p.alertID)
		if err != nil {
			return n, fmt.Errorf("sweeper: update %s: %w", p.alertID, err)
		}
		n++
	}
	return n, nil
}

// Start runs RunOnce on `interval` until ctx is cancelled.
func (s *Sweeper) Start(ctx context.Context, interval time.Duration) error {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if _, err := s.RunOnce(ctx); err != nil {
				// log and keep going; sweeper should not take down the process
				fmt.Printf("[reconcile] sweep error: %v\n", err)
			}
		}
	}
}
```

### Step 3 — Verify

```bash
go test ./internal/reconcile/ -v
```

Expected: 2 tests PASS.

### Step 4 — Commit

```bash
git add backend/internal/reconcile/
git commit -m "feat(backend): reconcile.Sweeper — safety-net EEZ exit detector"
```

---

## Task 9: alert distance-final HTTP handler

Expose the RPC from Task 0 as a JSON endpoint.

**Files:**
- Create: `backend/internal/alerts/handler.go`
- Create: `backend/internal/alerts/handler_test.go`

### Step 1 — Failing test

`backend/internal/alerts/handler_test.go`:

```go
package alerts

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestHandler_ReturnsDistance(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Seed an alert with positions
	var vID, aID string
	_ = db.QueryRow(`INSERT INTO public.vessels
		(mmsi, imo_number, name, call_sign, flag_code, category,
		 gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999555001','TEST-HNDL','MV H','THD01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name=EXCLUDED.name RETURNING id`).Scan(&vID)
	defer db.Exec(`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.Exec(`DELETE FROM public.vessel_positions WHERE vessel_id=$1`, vID)
	defer db.Exec(`DELETE FROM public.vessels WHERE id=$1`, vID)

	_ = db.QueryRow(`INSERT INTO public.arrival_alerts
		(vessel_id, imo_number, detected_lat, detected_lng,
		 distance_to_port_nm, status, arrived_at, departed_eez_at)
		 VALUES ($1, 'TEST-HNDL', 11, 46, 0, 'DEPARTED_EEZ',
		         NOW() - INTERVAL '1 hour', NOW())
		 RETURNING id`, vID).Scan(&aID)
	_, _ = db.Exec(`INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, recorded_at) VALUES
		($1, 11, 45, 90, 12, NOW() - INTERVAL '50 minutes'),
		($1, 11, 46, 90, 12, NOW() - INTERVAL '10 minutes')`, vID)

	h := NewHandler(db)
	req := httptest.NewRequest("GET", "/api/v1/alerts/"+aID+"/distance-final", nil)
	req.SetPathValue("id", aID)
	w := httptest.NewRecorder()
	h.DistanceFinal(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var body struct {
		AlertID      string  `json:"alert_id"`
		DistanceNM   float64 `json:"total_distance_eez_nm"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DistanceNM < 55 || body.DistanceNM > 65 {
		t.Fatalf("distance = %v, want ~59 NM", body.DistanceNM)
	}
}
```

Expected: FAIL.

### Step 2 — Implement

`backend/internal/alerts/handler.go`:

```go
// Package alerts exposes HTTP endpoints over arrival_alerts.
package alerts

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

type Handler struct {
	db *sql.DB
}

func NewHandler(db *sql.DB) *Handler {
	return &Handler{db: db}
}

type distanceResponse struct {
	AlertID    string  `json:"alert_id"`
	DistanceNM float64 `json:"total_distance_eez_nm"`
}

func (h *Handler) DistanceFinal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing alert id"}`, http.StatusBadRequest)
		return
	}

	var nm float64
	err := h.db.QueryRowContext(r.Context(),
		`SELECT public.alert_distance_final_nm($1)`, id).Scan(&nm)
	if err != nil {
		http.Error(w, `{"error":"db error: `+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(distanceResponse{
		AlertID:    id,
		DistanceNM: nm,
	})
}
```

### Step 3 — Verify

```bash
go test ./internal/alerts/ -v
```

Expected: PASS.

### Step 4 — Commit

```bash
git add backend/internal/alerts/
git commit -m "feat(backend): GET /api/v1/alerts/:id/distance-final"
```

---

## Task 10: Wire watcher + tracker into ingester, register handler, launch sweeper

Final integration in `cmd/api/main.go` and `internal/ais/ingester.go`.

**Files:**
- Modify: `backend/internal/ais/ingester.go`
- Modify: `backend/cmd/api/main.go`

### Step 1 — Audit existing ingester shape

```bash
sed -n '1,250p' backend/internal/ais/ingester.go
```

Look for where a position message is written to Supabase. After that insert, call:
- `corridor.Watcher.Evaluate(ctx, pos)` if position within corridor radius
- `eez.Tracker.OnPosition(ctx, pos)` for edge detection

Both need a `*sql.DB`. Add a `db *sql.DB` field to the `Ingester` struct and a constructor that accepts it.

### Step 2 — Modify ingester

Inside `ais/ingester.go`, at the position-ingestion point (after the PostgREST `POST /rest/v1/vessel_positions`), add:

```go
// Fire corridor + eez hooks. Errors are logged but do not break ingestion;
// the pipeline is eventually consistent via the reconcile sweeper.
if ing.watcher != nil {
    _, err := ing.watcher.Evaluate(context.Background(), corridor.Position{
        VesselID:   vessels[0].ID,
        IMO:        msg.Message.PositionReport != nil ? /* static data*/ "" : "", // see note
        Lat:        msg.MetaData.Latitude,
        Lng:        msg.MetaData.Longitude,
        SpeedKnots: sog,
        RecordedAt: time.Now(),
    })
    if err != nil {
        log.Printf("[AIS] corridor.Evaluate: %v", err)
    }
}
if ing.tracker != nil {
    _, err := ing.tracker.OnPosition(context.Background(), eez.Position{
        VesselID: vessels[0].ID, Lat: msg.MetaData.Latitude,
        Lng: msg.MetaData.Longitude, RecordedAt: time.Now(),
    })
    if err != nil {
        log.Printf("[AIS] eez.OnPosition: %v", err)
    }
}
```

Note: the AIS position report from aisstream.io does not always include IMO — in that case, look up `vessels.imo_number` via the existing lookup path and pass that string.

Update `NewIngester` / `NewHandler` to accept `db *sql.DB`, `watcher *corridor.Watcher`, `tracker *eez.Tracker`. If nil, skip the call (allows existing code to compile while the main wiring catches up).

### Step 3 — Wire main.go

In `backend/cmd/api/main.go`:

```go
db, err := supadb.Open(cfg.SupabaseDBURL)
if err != nil { log.Fatalf("db: %v", err) }

appcfg := appconfig.New(db)
watcher := corridor.New(db, appcfg)
tracker := eez.NewTracker(db)
sweeper := reconcile.NewSweeper(db)

// Extend ais handler with db, watcher, tracker
aisHandler := ais.NewHandler(cfg, db, watcher, tracker)

alertsHandler := alerts.NewHandler(db)

taxHandler := tax.NewHandler(cfg, db, appcfg) // takes a Calculator inside

mux.HandleFunc("GET /api/v1/alerts/{id}/distance-final", alertsHandler.DistanceFinal)

// Start sweeper in a goroutine
ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
defer stop()

intervalMin, _ := appcfg.GetInt(context.Background(), "reconciliation.check_interval_min")
if intervalMin <= 0 { intervalMin = 5 }
go func() {
    if err := sweeper.Start(ctx, time.Duration(intervalMin)*time.Minute); err != nil {
        log.Printf("[reconcile] sweeper stopped: %v", err)
    }
}()
```

Add `cfg.SupabaseDBURL` to `internal/config/config.go` (new env var `SUPABASE_DB_URL`, falling back to assembling from `SUPABASE_URL`).

### Step 4 — Build + verify

```bash
cd backend
go build ./...
go test ./... -count=1
```

Expected: build passes, all tests pass.

### Step 5 — Smoke test

```bash
# Ensure env vars are set; then:
go run ./cmd/api &
API_PID=$!
sleep 2

# Create a dummy alert manually, then hit the endpoint
curl -s http://127.0.0.1:8080/api/v1/alerts/<some-uuid>/distance-final | jq .

kill $API_PID
```

### Step 6 — Commit

```bash
git add backend/
git commit -m "feat(backend): wire corridor + eez + sweeper into ingester + main"
```

---

## Task 11: Plan 2 closure

**Files:**
- Modify: `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` (append Plan 2 status)

```markdown
**Plan 2 status**: Go backend applied — corridor watcher, EEZ tracker, emissions cascade, tax calculator with breakdown, reconcile sweeper, alert distance-final endpoint. Migrations 032–033 added (alert_distance_final_nm RPC + SHIPOWNER read policies). All Go and migration tests green.
```

Run full verification:

```bash
cd backend && go test ./... -count=1 && cd ..
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done
echo "Plan 2 complete"
```

Commit:

```bash
git add docs/superpowers/specs/
git commit -m "docs(spec): mark Plan 2 Go backend as applied"
```

---

## Done criteria

Plan 2 is complete when:

1. Migrations 032–033 exist and all migration tests pass.
2. `cd backend && go test ./... -count=1` runs green.
3. `go build ./...` has no errors.
4. The API starts, the new `/api/v1/alerts/:id/distance-final` endpoint responds, and position ingestion fires the corridor watcher + EEZ tracker without crashing.
5. Spec is annotated with Plan 2 status.
6. Git history shows focused commits per task.

Plan 3 (Pro-forma pipeline, Next.js side) can now proceed — it will consume `arrival_alerts` transitions and the emissions/tax endpoints.

---

## Spec coverage map

| Spec section | Covered by task |
|---|---|
| §4 Go backend split | Task 10 |
| §6.1 Corridor detection | Task 6 |
| §6.5 EEZ entry / exit | Task 7 + Task 8 |
| §6.1 Agent-match depends on `arrival_alerts.DETECTED` | Task 6 (inserts DETECTED) |
| Tax formula `distance × factor × 40 $/tCO2` | Task 4 + Task 5 |
| Emissions cascade (EU_MRV > IMO_CATEGORY > FALLBACK) | Task 4 |
| Alert distance-final HTTP endpoint | Task 9 + Task 0 (RPC) |
| Plan 1 follow-up: SHIPOWNER read policies | Task 0 (mig 033) |

Out of scope for Plan 2 (handled by later plans):
- pgmq consumer in Next.js (Plan 3)
- PDF / Resend (Plan 3)
- pg_cron job definitions that invoke the Go endpoints (Plan 3 or 4)
- Admin UIs and owner escalation dashboards (Plan 5)
