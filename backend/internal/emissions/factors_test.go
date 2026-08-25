package emissions

import (
	"context"
	"database/sql"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db := testdb.Open(t)
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
