package tax

import (
	"context"
	"testing"
)

func TestModeRegistry_DispatchesAndDefaults(t *testing.T) {
	db, cfg := openAirTestDB(t)
	defer db.Close()
	reg := NewModeRegistry(db, cfg)

	if _, ok := reg["MARITIME"]; !ok {
		t.Fatal("registry missing MARITIME")
	}
	if _, ok := reg["AIR"]; !ok {
		t.Fatal("registry missing AIR")
	}

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
