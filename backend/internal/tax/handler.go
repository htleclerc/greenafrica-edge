package tax

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/config"
)

// Handler exposes tax calculation endpoints.
type Handler struct {
	cfg  *config.Config
	calc *Calculator
}

// NewHandler builds a tax HTTP handler. db + appcfg may be nil during a
// transition period (pre-Task-10 wiring); the handler will return 503 in
// that case rather than panicking.
func NewHandler(cfg *config.Config, db *sql.DB, appcfg *appconfig.Reader) *Handler {
	h := &Handler{cfg: cfg}
	if db != nil && appcfg != nil {
		h.calc = NewCalculator(db, appcfg)
	}
	return h
}

type CalculateRequest struct {
	IMO          string   `json:"imo"`
	Category     string   `json:"category"`
	GrossTonnage int      `json:"gross_tonnage"`
	DistanceNM   float64  `json:"distance_nm"`
	RateOverride *float64 `json:"rate_override,omitempty"`
}

// Calculate handles single vessel tax calculation.
// POST /api/v1/tax/calculate
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	if h.calc == nil {
		http.Error(w, `{"error":"tax calculator not wired (db/appcfg missing)"}`, http.StatusServiceUnavailable)
		return
	}
	var req CalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if req.Category == "" || req.DistanceNM < 0 {
		http.Error(w, `{"error":"category and distance_nm are required"}`, http.StatusBadRequest)
		return
	}
	res, err := h.calc.Calculate(r.Context(), Input{
		IMO:          req.IMO,
		Category:     req.Category,
		GrossTonnage: req.GrossTonnage,
		DistanceNM:   req.DistanceNM,
		RateOverride: req.RateOverride,
	})
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
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
