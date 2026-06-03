package emissions

import (
	"context"
	"testing"
)

func TestLookupAir_ExactAndIcaoOnlyAndMiss(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()
	ctx := context.Background()

	f, found, err := LookupAir(ctx, db, "A320", "CFM56-5B")
	if err != nil {
		t.Fatalf("LookupAir A320: %v", err)
	}
	if !found || f.CO2KgPerLTOCycle != 2600 {
		t.Fatalf("A320/CFM56-5B: found=%v co2=%v, want true/2600", found, f.CO2KgPerLTOCycle)
	}

	f2, found2, err := LookupAir(ctx, db, "A320", "UNKNOWN-ENGINE")
	if err != nil {
		t.Fatalf("LookupAir A320 unknown engine: %v", err)
	}
	if !found2 || f2.CO2KgPerLTOCycle != 2600 {
		t.Fatalf("A320 icao-only: found=%v co2=%v, want true/2600", found2, f2.CO2KgPerLTOCycle)
	}

	_, found3, err := LookupAir(ctx, db, "ZZZZ", "")
	if err != nil {
		t.Fatalf("LookupAir miss returned error: %v", err)
	}
	if found3 {
		t.Fatalf("ZZZZ: found=true, want false")
	}
}
