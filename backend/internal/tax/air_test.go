package tax

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func ptrInt(i int) *int { return &i }

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
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(1),
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
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "ZZZZ", MTOWKg: 80000, LTOCycles: ptrInt(1),
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
		Mode: "AIR", ICAOType: "ZZZZ", MTOWKg: 0, LTOCycles: ptrInt(1),
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

	calc := newAirCalculator(db, appconfig.New(db))
	_, err := calc.Calculate(ctx, CalculateRequest{Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(1)})
	if err == nil {
		t.Fatal("expected fail-closed error on missing air rate, got nil (silent $0 is forbidden)")
	}
}

func TestAir_ZeroCycles_Errors(t *testing.T) {
	db, cfg := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, cfg)
	_, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(0),
	})
	if err == nil {
		t.Fatal("expected error for explicit lto_cycles=0 (must be positive)")
	}
}

func TestAir_AbsentCycles_DefaultsToOne(t *testing.T) {
	db, cfg := openAirTestDB(t)
	defer db.Close()
	calc := newAirCalculator(db, cfg)
	// LTOCycles omitted (nil) → defaults to 1 cycle → A320 2600/1000*40 = 104.
	res, err := calc.Calculate(context.Background(), CalculateRequest{
		Mode: "AIR", ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000,
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
