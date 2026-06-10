// Package tax computes carbon tax for a given asset + parameters.
// as_of pins tariff-version resolution to a fiscal date (e.g. reconciliation
// re-pricing at the proforma's issuance date); default = today.
package tax

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/tariff"
)

// defaultJurisdictionSomaliland is the fixed UUID for Somaliland in the
// jurisdictions table (seeded in mig 071).
const defaultJurisdictionSomaliland = "00000000-0000-4000-8000-00000000534f"

// Handler exposes tax calculation endpoints.
type Handler struct {
	registry map[string]ModeCalculator
}

// NewHandler builds a tax HTTP handler. db may be nil during early wiring;
// the handler returns 503 in that case rather than panicking.
func NewHandler(db *sql.DB, tariffs *tariff.Store) *Handler {
	h := &Handler{}
	if db != nil && tariffs != nil {
		h.registry = NewModeRegistry(db, tariffs)
	}
	return h
}

type CalculateRequest struct {
	Mode           string  `json:"mode,omitempty"` // "MARITIME" (default) | "AIR"
	JurisdictionID string  `json:"jurisdiction_id,omitempty"`
	IMO            string  `json:"imo,omitempty"`
	Category       string  `json:"category,omitempty"`
	GrossTonnage   int     `json:"gross_tonnage,omitempty"`
	DistanceNM     float64 `json:"distance_nm,omitempty"`
	ICAOType       string  `json:"icao_type,omitempty"`
	EngineType     string  `json:"engine_type,omitempty"`
	MTOWKg         int     `json:"mtow_kg,omitempty"`
	LTOCycles      *int    `json:"lto_cycles,omitempty"`
	// AsOf is an optional fiscal date (YYYY-MM-DD) for tariff-version resolution.
	// Use this when re-pricing historical proformas at their original issuance date.
	// Defaults to today when absent.
	AsOf string `json:"as_of,omitempty"`
}

// Calculate handles single-asset tax calculation, dispatched by mode.
// POST /api/v1/tax/calculate
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	if h.registry == nil {
		http.Error(w, `{"error":"tax calculator not wired (db missing)"}`, http.StatusServiceUnavailable)
		return
	}
	var req CalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	mode := req.Mode
	if mode == "" {
		mode = "MARITIME"
	}

	if req.JurisdictionID == "" {
		// Expand-window default: pre-W2 callers don't send a jurisdiction yet.
		req.JurisdictionID = defaultJurisdictionSomaliland
	}

	// Validate and resolve as_of early so we can return a clean 400.
	if _, err := resolveAsOf(req.AsOf); err != nil {
		http.Error(w, `{"error":"invalid as_of (expected YYYY-MM-DD)"}`, http.StatusBadRequest)
		return
	}

	calc, ok := h.registry[mode]
	if !ok {
		http.Error(w, `{"error":"unknown mode"}`, http.StatusBadRequest)
		return
	}

	switch mode {
	case "MARITIME":
		if req.Category == "" || req.DistanceNM < 0 {
			http.Error(w, `{"error":"category and distance_nm are required"}`, http.StatusBadRequest)
			return
		}
	case "AIR":
		if req.ICAOType == "" {
			http.Error(w, `{"error":"icao_type is required"}`, http.StatusBadRequest)
			return
		}
		if req.LTOCycles != nil && *req.LTOCycles <= 0 {
			http.Error(w, `{"error":"lto_cycles must be positive"}`, http.StatusBadRequest)
			return
		}
	}

	res, err := calc.Calculate(r.Context(), req)
	if err != nil {
		if errors.Is(err, tariff.ErrNoActiveTariff) {
			log.Printf("[tax] no active tariff mode=%s jurisdiction=%s: %v", mode, req.JurisdictionID, err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "no_active_tariff"})
			return
		}
		log.Printf("[tax] calculate mode=%s imo=%s icao=%s: %v", mode, req.IMO, req.ICAOType, err)
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}

// BatchCalculate is a stub; Plan 2 implements single-vessel calculation only.
// POST /api/v1/tax/batch
func (h *Handler) BatchCalculate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":  "not_implemented",
		"message": "Plan 2 implements single-vessel calculation only; batch is out of scope for MVP.",
	})
}

// resolveAsOf parses an optional YYYY-MM-DD string.
// Returns time.Now() (UTC, truncated to day) when asOf is empty.
// Returns an error when asOf is non-empty but not a valid YYYY-MM-DD date.
func resolveAsOf(asOf string) (time.Time, error) {
	if asOf == "" {
		return time.Now().UTC().Truncate(24 * time.Hour), nil
	}
	t, err := time.Parse("2006-01-02", asOf)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
}
