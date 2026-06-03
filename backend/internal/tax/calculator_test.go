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
		IMO:          "none",
		Category:     "CARGO",
		GrossTonnage: 30000,
		DistanceNM:   140,
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
}
