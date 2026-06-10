package tax

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/tariff"
)

func TestModeRegistry_DispatchesAndDefaults(t *testing.T) {
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	reg := NewModeRegistry(db, tariffs)

	if _, ok := reg["MARITIME"]; !ok {
		t.Fatal("registry missing MARITIME")
	}
	if _, ok := reg["AIR"]; !ok {
		t.Fatal("registry missing AIR")
	}

	mres, err := reg["MARITIME"].Calculate(context.Background(), CalculateRequest{
		Mode: "MARITIME", JurisdictionID: somaliaJurisdictionID, IMO: "none", Category: "CARGO", GrossTonnage: 30000, DistanceNM: 140,
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
		Mode: "AIR", JurisdictionID: somaliaJurisdictionID, ICAOType: "A320", EngineType: "CFM56-5B", MTOWKg: 78000, LTOCycles: ptrInt(1),
	})
	if err != nil {
		t.Fatalf("air dispatch: %v", err)
	}
	if _, ok := ares.Breakdown.(AirBreakdown); !ok {
		t.Fatalf("air breakdown type = %T, want AirBreakdown", ares.Breakdown)
	}
}

// TestHandler_NoActiveTariff_Returns422 tests that the HTTP handler returns
// HTTP 422 with {"error":"no_active_tariff"} when the tariff store returns
// ErrNoActiveTariff (unknown jurisdiction).
func TestHandler_NoActiveTariff_Returns422(t *testing.T) {
	db, _ := openAirTestDB(t)
	defer db.Close()

	// Use a fresh store — the unknown jurisdiction will produce ErrNoActiveTariff.
	tariffs := tariff.NewStore(db)
	h := NewHandler(nil, db, tariffs)

	body, _ := json.Marshal(CalculateRequest{
		Mode:           "MARITIME",
		JurisdictionID: "00000000-0000-4000-8000-000000000000", // unknown
		Category:       "CARGO",
		GrossTonnage:   30000,
		DistanceNM:     140,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tax/calculate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.Calculate(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", resp.StatusCode)
	}
	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["error"] != "no_active_tariff" {
		t.Fatalf("error = %q, want no_active_tariff", payload["error"])
	}
}

// TestHandler_NoActiveTariff_ErrorsIs ensures errors.Is works up the call chain
// from the calculator level (unit-level sanity check without httptest).
func TestHandler_NoActiveTariff_ErrorsIs(t *testing.T) {
	db, _ := openAirTestDB(t)
	defer db.Close()

	tariffs := tariff.NewStore(db)
	reg := NewModeRegistry(db, tariffs)

	_, err := reg["MARITIME"].Calculate(context.Background(), CalculateRequest{
		Mode:           "MARITIME",
		JurisdictionID: "00000000-0000-4000-8000-000000000000",
		Category:       "CARGO",
		GrossTonnage:   30000,
		DistanceNM:     140,
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, tariff.ErrNoActiveTariff) {
		t.Fatalf("error = %q — errors.Is(err, ErrNoActiveTariff) should be true", err)
	}
}
