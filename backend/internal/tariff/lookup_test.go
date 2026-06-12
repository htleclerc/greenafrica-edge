package tariff

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
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

// seedJurisdiction inserts a test jurisdiction using a unique throwaway code and
// returns its UUID string.  The caller gets a t.Cleanup that removes tariffs rows
// (FK child) then the jurisdiction row (parent).
// The tariff DELETE uses the mig 088 escape hatch (app.tariffs_allow_retro='on')
// inside an explicit transaction so SET LOCAL is scoped to that transaction only.
func seedJurisdiction(t *testing.T, db *sql.DB, code, name string) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO public.jurisdictions (code, name) VALUES ($1, $2) RETURNING id::text`,
		code, name,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedJurisdiction %q: %v", name, err)
	}
	t.Cleanup(func() {
		// Wrap tariff DELETE in an explicit transaction with the retro hatch so
		// the mig 088 DELETE guard allows the cleanup (SET LOCAL is tx-scoped).
		tx, err := db.Begin()
		if err != nil {
			t.Fatalf("seedJurisdiction cleanup begin tx %q: %v", code, err)
		}
		if _, err := tx.ExecContext(context.Background(), `SET LOCAL app.tariffs_allow_retro = 'on'`); err != nil {
			tx.Rollback()
			t.Fatalf("seedJurisdiction cleanup set hatch %q: %v", code, err)
		}
		if _, err := tx.ExecContext(context.Background(), `DELETE FROM public.tariffs WHERE jurisdiction_id = $1::uuid`, id); err != nil {
			tx.Rollback()
			t.Fatalf("seedJurisdiction cleanup delete tariffs %q: %v", code, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("seedJurisdiction cleanup commit %q: %v", code, err)
		}
		db.ExecContext(context.Background(), `DELETE FROM public.jurisdictions WHERE id = $1::uuid`, id)
	})
	return id
}

// insertTariff inserts a tariff row and returns its id. effectiveTo="" means NULL (open).
// Uses the mig 088 escape hatch (app.tariffs_allow_retro='on') inside an explicit
// transaction so the BEFORE INSERT guard allows retroactively-dated ACTIVE rows that
// test fixtures routinely insert (effective_from <= CURRENT_DATE).
func insertTariff(t *testing.T, db *sql.DB, jid, mode, category string, rate float64, effectiveFrom, effectiveTo string, status string) string {
	t.Helper()
	ctx := context.Background()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("insertTariff begin tx: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL app.tariffs_allow_retro = 'on'`); err != nil {
		tx.Rollback()
		t.Fatalf("insertTariff set hatch: %v", err)
	}

	var id string
	if effectiveTo == "" {
		err = tx.QueryRowContext(ctx, `
			INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, currency, effective_from, effective_to, status)
			VALUES ($1::uuid, $2::public.transport_mode, NULLIF($3,''), $4, 'USD', $5::date, NULL, $6)
			RETURNING id::text`,
			jid, mode, category, fmt.Sprintf("%.2f", rate), effectiveFrom, status,
		).Scan(&id)
	} else {
		err = tx.QueryRowContext(ctx, `
			INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, currency, effective_from, effective_to, status)
			VALUES ($1::uuid, $2::public.transport_mode, NULLIF($3,''), $4, 'USD', $5::date, $6::date, $7)
			RETURNING id::text`,
			jid, mode, category, fmt.Sprintf("%.2f", rate), effectiveFrom, effectiveTo, status,
		).Scan(&id)
	}
	if err != nil {
		tx.Rollback()
		t.Fatalf("insertTariff: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("insertTariff commit: %v", err)
	}
	return id
}

// ─── Test 1: specific category beats NULL (all-categories) ───────────────────

func TestLookup_SpecificCategoryBeatsNull(t *testing.T) {
	db := openTestDB(t)
	jid := seedJurisdiction(t, db, "Z1", "Test Jurisdiction Specific")

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
	jid := seedJurisdiction(t, db, "Z2", "Test Jurisdiction Fallback")

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

// ─── Test 3: date-window selection + regression for day-granular cache key ────
//
// Uses the SAME store for both date queries.  With the old string key (no day
// component) the second call would have returned the cached rate from the first
// call (45) instead of the correct historical rate (30) — proving the cache bug
// is fixed by the cacheKey struct.

func TestLookup_DateWindowSelection(t *testing.T) {
	db := openTestDB(t)
	jid := seedJurisdiction(t, db, "Z3", "Test Jurisdiction Date")

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

	// at = 2025-06-01 (within old version's window) — same store, different day key.
	// This is the regression test: if the cache key did not include the day, the store
	// would return 45 (cached above) instead of 30.
	r2, err := store.Lookup(context.Background(), jid, "MARITIME", "", time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC))
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
	jid := seedJurisdiction(t, db, "Z4", "Test Jurisdiction FailClosed")

	store := NewStore(db)
	_, err := store.Lookup(context.Background(), jid, "MARITIME", "", time.Now())
	if err == nil {
		t.Fatal("expected error for missing ACTIVE tariff, got nil")
	}
	if !errors.Is(err, ErrNoActiveTariff) {
		t.Fatalf("error = %q, want errors.Is(err, ErrNoActiveTariff) to be true", err)
	}
}

// ─── Test 5: cache — second call within TTL does not re-query ─────────────────

func TestLookup_CacheHitWithinTTL(t *testing.T) {
	db := openTestDB(t)
	jid := seedJurisdiction(t, db, "Z5", "Test Jurisdiction Cache")

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

	// Delete the row from DB — if cache is working the second call must still succeed.
	// Use the mig 088 retro hatch (tx-scoped) so the DELETE guard allows the removal.
	{
		ctx := context.Background()
		delTx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("delete tariff begin tx: %v", err)
		}
		if _, err := delTx.ExecContext(ctx, `SET LOCAL app.tariffs_allow_retro = 'on'`); err != nil {
			delTx.Rollback()
			t.Fatalf("delete tariff set hatch: %v", err)
		}
		if _, err := delTx.ExecContext(ctx, `DELETE FROM public.tariffs WHERE id = $1::uuid`, id); err != nil {
			delTx.Rollback()
			t.Fatalf("delete tariff: %v", err)
		}
		if err := delTx.Commit(); err != nil {
			t.Fatalf("delete tariff commit: %v", err)
		}
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
	jid := seedJurisdiction(t, db, "Z6", "Test Jurisdiction Draft")

	// Only a DRAFT row — must not be returned
	insertTariff(t, db, jid, "MARITIME", "", 99, "2026-01-01", "", "DRAFT")

	store := NewStore(db)
	_, err := store.Lookup(context.Background(), jid, "MARITIME", "", time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	if err == nil {
		t.Fatal("expected fail-closed error for DRAFT-only tariff, got nil")
	}
	if !errors.Is(err, ErrNoActiveTariff) {
		t.Fatalf("error = %q, want errors.Is(err, ErrNoActiveTariff) to be true", err)
	}
}
