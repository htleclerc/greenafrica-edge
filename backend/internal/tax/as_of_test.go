package tax

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/tariff"
)

// seedTestJurisdiction inserts a throwaway jurisdiction and returns its UUID.
// A cleanup is registered to delete tariffs (FK child) then the jurisdiction (parent).
// The tariff DELETE uses the mig 088 escape hatch (app.tariffs_allow_retro='on')
// inside an explicit transaction so SET LOCAL is scoped to that transaction only.
func seedTestJurisdiction(t *testing.T, db *sql.DB, code, name string) string {
	t.Helper()
	var id string
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO public.jurisdictions (code, name) VALUES ($1, $2) RETURNING id::text`,
		code, name,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedTestJurisdiction %q: %v", name, err)
	}
	t.Cleanup(func() {
		// Wrap tariff DELETE in an explicit transaction with the retro hatch so
		// the mig 088 DELETE guard allows the cleanup (SET LOCAL is tx-scoped).
		tx, err := db.Begin()
		if err != nil {
			t.Fatalf("seedTestJurisdiction cleanup begin tx %q: %v", code, err)
		}
		if _, err := tx.ExecContext(context.Background(), `SET LOCAL app.tariffs_allow_retro = 'on'`); err != nil {
			tx.Rollback()
			t.Fatalf("seedTestJurisdiction cleanup set hatch %q: %v", code, err)
		}
		if _, err := tx.ExecContext(context.Background(), `DELETE FROM public.tariffs WHERE jurisdiction_id = $1::uuid`, id); err != nil {
			tx.Rollback()
			t.Fatalf("seedTestJurisdiction cleanup delete tariffs %q: %v", code, err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatalf("seedTestJurisdiction cleanup commit %q: %v", code, err)
		}
		db.ExecContext(context.Background(), `DELETE FROM public.jurisdictions WHERE id = $1::uuid`, id)
	})
	return id
}

// insertTestTariff inserts a tariff version. effectiveTo="" means NULL (open-ended).
// Uses the mig 088 escape hatch (app.tariffs_allow_retro='on') inside an explicit
// transaction so the BEFORE INSERT guard allows retroactively-dated ACTIVE rows that
// test fixtures routinely insert (effective_from <= CURRENT_DATE).
func insertTestTariff(t *testing.T, db *sql.DB, jid, mode string, rate float64, effectiveFrom, effectiveTo string) {
	t.Helper()
	ctx := context.Background()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("insertTestTariff begin tx: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `SET LOCAL app.tariffs_allow_retro = 'on'`); err != nil {
		tx.Rollback()
		t.Fatalf("insertTestTariff set hatch: %v", err)
	}

	if effectiveTo == "" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO public.tariffs
			  (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, effective_to, status)
			VALUES ($1::uuid, $2::public.transport_mode, $3, 'USD', $4::date, NULL, 'ACTIVE')`,
			jid, mode, fmt.Sprintf("%.2f", rate), effectiveFrom,
		)
	} else {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO public.tariffs
			  (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, effective_to, status)
			VALUES ($1::uuid, $2::public.transport_mode, $3, 'USD', $4::date, $5::date, 'ACTIVE')`,
			jid, mode, fmt.Sprintf("%.2f", rate), effectiveFrom, effectiveTo,
		)
	}
	if err != nil {
		tx.Rollback()
		t.Fatalf("insertTestTariff: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("insertTestTariff commit: %v", err)
	}
}

// TestHandler_InvalidAsOf_Returns400 verifies that a malformed as_of string
// causes the handler to respond with HTTP 400 before dispatching to any calculator.
func TestHandler_InvalidAsOf_Returns400(t *testing.T) {
	db, tariffs := openAirTestDB(t)
	defer db.Close()
	h := NewHandler(db, tariffs)

	body, _ := json.Marshal(map[string]any{
		"mode":            "MARITIME",
		"jurisdiction_id": somalilandJurisdictionID,
		"category":        "CARGO",
		"distance_nm":     100,
		"as_of":           "not-a-date",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tax/calculate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.Calculate(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	var payload map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["error"] != "invalid as_of (expected YYYY-MM-DD)" {
		t.Fatalf("error = %q, want invalid as_of message", payload["error"])
	}
}

// TestMaritime_AsOf_SelectsHistoricalTariff verifies that passing as_of selects
// the tariff version active on the pinned date rather than today's version.
//
// Two versions (non-overlapping) in a throwaway jurisdiction:
//   [2025-01-01, 2026-01-01)  rate 30
//   [2026-01-01, ∞)           rate 45
//
// as_of=2025-06-01 → rate 30; no as_of (today ≥ 2026) → rate 45.
func TestMaritime_AsOf_SelectsHistoricalTariff(t *testing.T) {
	db, _ := openAirTestDB(t)
	// Register db.Close BEFORE seedTestJurisdiction so that t.Cleanup LIFO
	// order ensures tariff/jurisdiction cleanup runs BEFORE the db is closed.
	t.Cleanup(func() { db.Close() })
	jid := seedTestJurisdiction(t, db, "AO1", "AsOf Maritime Test Jurisdiction")
	insertTestTariff(t, db, jid, "MARITIME", 30, "2025-01-01", "2026-01-01")
	insertTestTariff(t, db, jid, "MARITIME", 45, "2026-01-01", "")

	store := tariff.NewStore(db)
	reg := NewModeRegistry(db, store)

	// as_of=2025-06-01 — should resolve the historical rate 30
	res30, err := reg["MARITIME"].Calculate(context.Background(), CalculateRequest{
		Mode:           "MARITIME",
		JurisdictionID: jid,
		IMO:            "none",
		Category:       "CARGO",
		GrossTonnage:   30000,
		DistanceNM:     140,
		AsOf:           "2025-06-01",
	})
	if err != nil {
		t.Fatalf("as_of historical: %v", err)
	}
	bd30, ok := res30.Breakdown.(Breakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want Breakdown", res30.Breakdown)
	}
	if bd30.RateUSDPerTCO2 != 30 {
		t.Fatalf("rate (as_of 2025-06-01) = %.2f, want 30", bd30.RateUSDPerTCO2)
	}

	// No as_of — today is 2026-06-10, should resolve current rate 45
	res45, err := reg["MARITIME"].Calculate(context.Background(), CalculateRequest{
		Mode:           "MARITIME",
		JurisdictionID: jid,
		IMO:            "none",
		Category:       "CARGO",
		GrossTonnage:   30000,
		DistanceNM:     140,
	})
	if err != nil {
		t.Fatalf("current rate: %v", err)
	}
	bd45, ok := res45.Breakdown.(Breakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want Breakdown", res45.Breakdown)
	}
	if bd45.RateUSDPerTCO2 != 45 {
		t.Fatalf("rate (no as_of) = %.2f, want 45", bd45.RateUSDPerTCO2)
	}
}

// TestAir_AsOf_SelectsHistoricalTariff mirrors TestMaritime_AsOf_SelectsHistoricalTariff
// for AIR mode. Same two-version setup; A320 EDB lookup (known factor).
func TestAir_AsOf_SelectsHistoricalTariff(t *testing.T) {
	db, _ := openAirTestDB(t)
	// Register db.Close BEFORE seedTestJurisdiction so that t.Cleanup LIFO
	// order ensures tariff/jurisdiction cleanup runs BEFORE the db is closed.
	t.Cleanup(func() { db.Close() })
	jid := seedTestJurisdiction(t, db, "AO2", "AsOf Air Test Jurisdiction")
	insertTestTariff(t, db, jid, "AIR", 30, "2025-01-01", "2026-01-01")
	insertTestTariff(t, db, jid, "AIR", 45, "2026-01-01", "")

	store := tariff.NewStore(db)
	reg := NewModeRegistry(db, store)

	// as_of=2025-06-01 — should resolve historical rate 30
	res30, err := reg["AIR"].Calculate(context.Background(), CalculateRequest{
		Mode:           "AIR",
		JurisdictionID: jid,
		ICAOType:       "A320",
		EngineType:     "CFM56-5B",
		MTOWKg:         78000,
		LTOCycles:      ptrInt(1),
		AsOf:           "2025-06-01",
	})
	if err != nil {
		t.Fatalf("as_of historical: %v", err)
	}
	bd30, ok := res30.Breakdown.(AirBreakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want AirBreakdown", res30.Breakdown)
	}
	if bd30.RateUSDPerTCO2 != 30 {
		t.Fatalf("rate (as_of 2025-06-01) = %.2f, want 30", bd30.RateUSDPerTCO2)
	}

	// No as_of — today is 2026-06-10, should resolve current rate 45
	res45, err := reg["AIR"].Calculate(context.Background(), CalculateRequest{
		Mode:           "AIR",
		JurisdictionID: jid,
		ICAOType:       "A320",
		EngineType:     "CFM56-5B",
		MTOWKg:         78000,
		LTOCycles:      ptrInt(1),
	})
	if err != nil {
		t.Fatalf("current rate: %v", err)
	}
	bd45, ok := res45.Breakdown.(AirBreakdown)
	if !ok {
		t.Fatalf("breakdown type = %T, want AirBreakdown", res45.Breakdown)
	}
	if bd45.RateUSDPerTCO2 != 45 {
		t.Fatalf("rate (no as_of) = %.2f, want 45", bd45.RateUSDPerTCO2)
	}
}
