package tariff

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

// openTestDB opens the test database. Uses SUPABASE_DB_URL if set, otherwise
// falls back to the local Supabase CLI default (port 54322).
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

// setupTariffSchema creates the minimal schema needed to run tariff tests:
// transport_mode enum, jurisdictions stub, and the tariffs table.
// It is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING).
func setupTariffSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`DO $$ BEGIN
		   CREATE TYPE public.transport_mode AS ENUM ('MARITIME','AIR');
		 EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
		`CREATE TABLE IF NOT EXISTS public.jurisdictions (
		   id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		   name TEXT NOT NULL
		 )`,
		`CREATE TABLE IF NOT EXISTS public.tariffs (
		   id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		   jurisdiction_id UUID NOT NULL REFERENCES public.jurisdictions(id),
		   mode            public.transport_mode NOT NULL,
		   asset_category  TEXT,
		   zone            TEXT,
		   rate_per_tco2   NUMERIC(10,2) NOT NULL CHECK (rate_per_tco2 > 0),
		   currency        CHAR(3) NOT NULL DEFAULT 'USD',
		   effective_from  DATE NOT NULL,
		   effective_to    DATE,
		   status          TEXT NOT NULL DEFAULT 'ACTIVE'
		                   CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
		   CHECK (effective_to IS NULL OR effective_to > effective_from),
		   CONSTRAINT tariffs_zone_reserved CHECK (zone IS NULL)
		 )`,
	}
	for _, s := range stmts {
		if _, err := db.ExecContext(ctx, s); err != nil {
			t.Fatalf("schema setup: %v\nSQL: %s", err, s)
		}
	}
}

// seedJurisdiction inserts a test jurisdiction and returns its UUID string.
func seedJurisdiction(t *testing.T, db *sql.DB, name string) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO public.jurisdictions (name) VALUES ($1) RETURNING id::text`, name,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedJurisdiction %q: %v", name, err)
	}
	t.Cleanup(func() {
		db.ExecContext(context.Background(), `DELETE FROM public.tariffs WHERE jurisdiction_id = $1::uuid`, id)
		db.ExecContext(context.Background(), `DELETE FROM public.jurisdictions WHERE id = $1::uuid`, id)
	})
	return id
}

// insertTariff inserts a tariff row and returns its id. effectiveTo="" means NULL (open).
func insertTariff(t *testing.T, db *sql.DB, jid, mode, category string, rate float64, effectiveFrom, effectiveTo string, status string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	var err error
	if effectiveTo == "" {
		err = db.QueryRowContext(ctx, `
			INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, currency, effective_from, effective_to, status)
			VALUES ($1::uuid, $2::public.transport_mode, NULLIF($3,''), $4, 'USD', $5::date, NULL, $6)
			RETURNING id::text`,
			jid, mode, category, fmt.Sprintf("%.2f", rate), effectiveFrom, status,
		).Scan(&id)
	} else {
		err = db.QueryRowContext(ctx, `
			INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, currency, effective_from, effective_to, status)
			VALUES ($1::uuid, $2::public.transport_mode, NULLIF($3,''), $4, 'USD', $5::date, $6::date, $7)
			RETURNING id::text`,
			jid, mode, category, fmt.Sprintf("%.2f", rate), effectiveFrom, effectiveTo, status,
		).Scan(&id)
	}
	if err != nil {
		t.Fatalf("insertTariff: %v", err)
	}
	return id
}

// ─── Test 1: specific category beats NULL (all-categories) ───────────────────

func TestLookup_SpecificCategoryBeatsNull(t *testing.T) {
	db := openTestDB(t)
	setupTariffSchema(t, db)
	jid := seedJurisdiction(t, db, "TEST-JID-SPECIFC")

	// NULL row (all categories): rate 40
	insertTariff(t, db, jid, "MARITIME", "", 40, "2026-01-01", "", "ACTIVE")
	// Specific TANKER row: rate 60
	insertTariff(t, db, jid, "MARITIME", "TANKER", 60, "2026-01-01", "", "ACTIVE")

	store := NewStore(db)
	r, err := store.Lookup(context.Background(), jid, "MARITIME", "TANKER", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if r.RatePerTCO2 != 60 {
		t.Fatalf("rate = %.2f, want 60 (specific TANKER should beat NULL row at 40)", r.RatePerTCO2)
	}
	if r.Currency != "USD" {
		t.Fatalf("currency = %q, want USD", r.Currency)
	}
}

// ─── Test 2: NULL-category fallback when no specific row exists ───────────────

func TestLookup_NullCategoryFallback(t *testing.T) {
	db := openTestDB(t)
	setupTariffSchema(t, db)
	jid := seedJurisdiction(t, db, "TEST-JID-FALLBACK")

	// Only a NULL-category row (no CARGO-specific row)
	insertTariff(t, db, jid, "MARITIME", "", 40, "2026-01-01", "", "ACTIVE")

	store := NewStore(db)
	// Request for CARGO — no specific row, should fall back to NULL row
	r, err := store.Lookup(context.Background(), jid, "MARITIME", "CARGO", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if r.RatePerTCO2 != 40 {
		t.Fatalf("rate = %.2f, want 40 (NULL fallback)", r.RatePerTCO2)
	}
}

// ─── Test 3: date-window selection ───────────────────────────────────────────

func TestLookup_DateWindowSelection(t *testing.T) {
	db := openTestDB(t)
	setupTariffSchema(t, db)
	jid := seedJurisdiction(t, db, "TEST-JID-DATE")

	// Old version [2025-01-01, 2026-01-01) — closed; should NOT be returned for at >= 2026-01-01
	insertTariff(t, db, jid, "MARITIME", "", 30, "2025-01-01", "2026-01-01", "ACTIVE")
	// Current version [2026-01-01, open)
	insertTariff(t, db, jid, "MARITIME", "", 45, "2026-01-01", "", "ACTIVE")

	store := NewStore(db)

	// at = 2026-01-01 (boundary, old version's effective_to — should use new)
	r, err := store.Lookup(context.Background(), jid, "MARITIME", "", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Lookup at boundary: %v", err)
	}
	if r.RatePerTCO2 != 45 {
		t.Fatalf("rate at 2026-01-01 = %.2f, want 45 (closed version must not be returned)", r.RatePerTCO2)
	}

	// at = 2025-06-01 (within old version's window) — a fresh store (no cache)
	store2 := NewStore(db)
	r2, err := store2.Lookup(context.Background(), jid, "MARITIME", "", time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("Lookup in old window: %v", err)
	}
	if r2.RatePerTCO2 != 30 {
		t.Fatalf("rate at 2025-06-01 = %.2f, want 30 (old version in window)", r2.RatePerTCO2)
	}
}

// ─── Test 4: fail-closed — no ACTIVE row ─────────────────────────────────────

func TestLookup_FailClosedNoActiveRow(t *testing.T) {
	db := openTestDB(t)
	setupTariffSchema(t, db)
	jid := seedJurisdiction(t, db, "TEST-JID-FAILCLOSED")

	store := NewStore(db)
	_, err := store.Lookup(context.Background(), jid, "MARITIME", "", time.Now())
	if err == nil {
		t.Fatal("expected error for missing ACTIVE tariff, got nil")
	}
	const want = "no active tariff"
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %q, want it to contain %q", err.Error(), want)
	}
}

// ─── Test 5: cache — second call within TTL does not re-query ─────────────────

func TestLookup_CacheHitWithinTTL(t *testing.T) {
	db := openTestDB(t)
	setupTariffSchema(t, db)
	jid := seedJurisdiction(t, db, "TEST-JID-CACHE")

	id := insertTariff(t, db, jid, "MARITIME", "", 55, "2026-01-01", "", "ACTIVE")

	store := NewStore(db)
	at := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)

	// First call — populates cache
	r1, err := store.Lookup(context.Background(), jid, "MARITIME", "", at)
	if err != nil {
		t.Fatalf("first Lookup: %v", err)
	}
	if r1.RatePerTCO2 != 55 {
		t.Fatalf("first call rate = %.2f, want 55", r1.RatePerTCO2)
	}

	// Delete the row from DB — if cache is working the second call must still succeed
	if _, err := db.ExecContext(context.Background(),
		`DELETE FROM public.tariffs WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("delete tariff: %v", err)
	}

	// Second call — should hit cache and return the same rate
	r2, err := store.Lookup(context.Background(), jid, "MARITIME", "", at)
	if err != nil {
		t.Fatalf("second Lookup (should hit cache): %v", err)
	}
	if r2.RatePerTCO2 != 55 {
		t.Fatalf("cached rate = %.2f, want 55", r2.RatePerTCO2)
	}
	if r2.ID != r1.ID {
		t.Fatalf("cached ID = %q, want %q", r2.ID, r1.ID)
	}
}

// ─── Test 6: DRAFT rows are never returned ────────────────────────────────────

func TestLookup_DraftRowNotReturned(t *testing.T) {
	db := openTestDB(t)
	setupTariffSchema(t, db)
	jid := seedJurisdiction(t, db, "TEST-JID-DRAFT")

	// Only a DRAFT row — must not be returned
	insertTariff(t, db, jid, "MARITIME", "", 99, "2026-01-01", "", "DRAFT")

	store := NewStore(db)
	_, err := store.Lookup(context.Background(), jid, "MARITIME", "", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if err == nil {
		t.Fatal("expected fail-closed error for DRAFT-only tariff, got nil")
	}
	const want = "no active tariff"
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %q, want it to contain %q", err.Error(), want)
	}
}

