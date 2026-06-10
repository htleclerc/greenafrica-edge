package tax

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
	"github.com/htleclerc/africgreen/backend/internal/tariff"
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

	tariffs := tariff.NewStore(db)
	calc := NewCalculator(db, tariffs)

	// CARGO, GT 30000, distance 140 NM → IMO_CATEGORY medium cargo 95000 g/NM
	// tCO2 = 140 * 95000 / 1e6 = 13.3
	// USD = 13.3 * 40 = 532
	res, err := calc.Calculate(context.Background(), Input{
		IMO:            "none",
		Category:       "CARGO",
		GrossTonnage:   30000,
		DistanceNM:     140,
		JurisdictionID: somalilandJurisdictionID,
	})
	if err != nil {
		t.Fatalf("Calculate: %v", err)
	}
	if res.USDAmount < 531 || res.USDAmount > 533 {
		t.Fatalf("USD = %v, want ~532", res.USDAmount)
	}
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
	if bd.TariffID == "" {
		t.Fatal("tariff_id must be set on breakdown")
	}
	if bd.JurisdictionID != somalilandJurisdictionID {
		t.Fatalf("jurisdiction_id = %q, want Somaliland", bd.JurisdictionID)
	}
	if bd.Currency != "USD" {
		t.Fatalf("currency = %q, want USD", bd.Currency)
	}
}

func TestCalculate_UnknownJurisdiction_FailsClosed(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("db: %v", err)
	}
	defer db.Close()

	tariffs := tariff.NewStore(db)
	calc := NewCalculator(db, tariffs)

	_, err = calc.Calculate(context.Background(), Input{
		IMO:            "none",
		Category:       "CARGO",
		GrossTonnage:   30000,
		DistanceNM:     140,
		JurisdictionID: "00000000-0000-4000-8000-000000000000", // unknown
	})
	if err == nil {
		t.Fatal("expected fail-closed error for unknown jurisdiction, got nil")
	}
	if !errors.Is(err, tariff.ErrNoActiveTariff) {
		t.Fatalf("error = %q, want errors.Is(err, ErrNoActiveTariff)", err)
	}
}
