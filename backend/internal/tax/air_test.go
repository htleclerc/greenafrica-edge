package tax

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/tariff"
	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

// somalilandJurisdictionID aliases the package constant for test readability.
const somalilandJurisdictionID = defaultJurisdictionSomaliland

func ptrInt(i int) *int { return &i }

func openAirTestDB(t *testing.T) (*sql.DB, *tariff.Store) {
	t.Helper()
	db := testdb.Open(t)
	return db, tariff.NewStore(db)
}

func TestAir_EDBHit(t *testing.T) {
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, tariffs)
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", JurisdictionID: somalilandJurisdictionID, ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(1),
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
	if bd.TariffID == "" {
		t.Fatal("tariff_id must be set on breakdown (tariff lookup populated it)")
	}
	if bd.JurisdictionID != somalilandJurisdictionID {
		t.Fatalf("jurisdiction_id = %q, want Somaliland", bd.JurisdictionID)
	}
	if bd.Currency != "USD" {
		t.Fatalf("currency = %q, want USD", bd.Currency)
	}
}

func TestAir_MTOWFallback(t *testing.T) {
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, tariffs)
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", JurisdictionID: somalilandJurisdictionID, ICAOType: "ZZZZ", MTOWKg: 80000, LTOCycles: ptrInt(1),
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
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, tariffs)
	_, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", JurisdictionID: somalilandJurisdictionID, ICAOType: "ZZZZ", MTOWKg: 0, LTOCycles: ptrInt(1),
	})
	if err == nil {
		t.Fatal("expected error when type unseeded and mtow_kg<=0")
	}
}

func TestAir_MissingTariff_FailsClosed(t *testing.T) {
	db, _ := openAirTestDB(t)
	defer db.Close()
	// Use an unknown jurisdiction UUID — no tariff row will match.
	unknownJurisdiction := "00000000-0000-4000-8000-000000000000"
	calc := newAirCalculator(db, tariff.NewStore(db))
	_, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", JurisdictionID: unknownJurisdiction, ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(1),
	})
	if err == nil {
		t.Fatal("expected fail-closed error on unknown jurisdiction, got nil")
	}
	if !errors.Is(err, tariff.ErrNoActiveTariff) {
		t.Fatalf("error = %q, want errors.Is(err, ErrNoActiveTariff)", err)
	}
}

func TestAir_ZeroCycles_Errors(t *testing.T) {
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, tariffs)
	_, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", JurisdictionID: somalilandJurisdictionID, ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(0),
	})
	if err == nil {
		t.Fatal("expected error for explicit lto_cycles=0 (must be positive)")
	}
}

func TestAir_AbsentCycles_DefaultsToOne(t *testing.T) {
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, tariffs)
	// LTOCycles omitted (nil) → defaults to 1 cycle → A320 2600/1000*40 = 104.
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", JurisdictionID: somalilandJurisdictionID, ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000,
	})
	if err != nil {
		t.Fatalf("Calculate: %v", err)
	}
	bd, ok := res.Breakdown.(AirBreakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want AirBreakdown", res.Breakdown)
	}
	if bd.LTOCycles != 1 {
		t.Fatalf("lto_cycles = %d, want 1 (default)", bd.LTOCycles)
	}
	if res.USDAmount < 103.9 || res.USDAmount > 104.1 {
		t.Fatalf("USD = %v, want ~104", res.USDAmount)
	}
}
