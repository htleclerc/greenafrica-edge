package tax

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/config"
)

// Handler exposes tax calculation endpoints.
type Handler struct {
	cfg      *config.Config
	registry map[string]ModeCalculator
}

// NewHandler builds a tax HTTP handler. db + appcfg may be nil during early wiring;
// the handler returns 503 in that case rather than panicking.
func NewHandler(cfg *config.Config, db *sql.DB, appcfg *appconfig.Reader) *Handler {
	h := &Handler{cfg: cfg}
	if db != nil && appcfg != nil {
		h.registry = NewModeRegistry(db, appcfg)
	}
	return h
}

type CalculateRequest struct {
	Mode         string   `json:"mode,omitempty"` // "MARITIME" (default) | "AIR"
	IMO          string   `json:"imo,omitempty"`
	Category     string   `json:"category,omitempty"`
	GrossTonnage int      `json:"gross_tonnage,omitempty"`
	DistanceNM   float64  `json:"distance_nm,omitempty"`
	ICAOType     string   `json:"icao_type,omitempty"`
	EngineType   string   `json:"engine_type,omitempty"`
	MTOWKg       int      `json:"mtow_kg,omitempty"`
	LTOCycles    int      `json:"lto_cycles,omitempty"`
	RateOverride *float64 `json:"rate_override,omitempty"`
}

// Calculate handles single-asset tax calculation, dispatched by mode.
// POST /api/v1/tax/calculate
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	if h.registry == nil {
		http.Error(w, `{"error":"tax calculator not wired (db/appcfg missing)"}`, http.StatusServiceUnavailable)
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
		if req.LTOCycles < 0 {
			http.Error(w, `{"error":"lto_cycles must be non-negative"}`, http.StatusBadRequest)
			return
		}
	}

	res, err := calc.Calculate(r.Context(), req)
	if err != nil {
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
