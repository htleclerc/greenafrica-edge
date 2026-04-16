package tax

import (
	"encoding/json"
	"net/http"

	"github.com/htleclerc/africgreen/backend/internal/config"
)

// Handler exposes tax calculation endpoints.
type Handler struct {
	cfg *config.Config
}

func NewHandler(cfg *config.Config) *Handler {
	return &Handler{cfg: cfg}
}

type CalculateRequest struct {
	VesselID string `json:"vesselId"`
	Since    string `json:"since,omitempty"`
}

type BatchCalculateRequest struct {
	VesselIDs []string `json:"vesselIds"`
	Since     string   `json:"since,omitempty"`
}

type TaxBreakdown struct {
	VesselID       string  `json:"vesselId"`
	VesselName     string  `json:"vesselName"`
	EmissionsTco2  float64 `json:"emissionsTco2"`
	TotalTaxUSD    float64 `json:"totalTaxUsd"`
	Zone           string  `json:"zone"`
	DaysInZone     int     `json:"daysInZone"`
	RatePerTco2    float64 `json:"ratePerTco2"`
}

// Calculate handles single vessel tax calculation.
// POST /api/v1/tax/calculate
func (h *Handler) Calculate(w http.ResponseWriter, r *http.Request) {
	var req CalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if req.VesselID == "" {
		http.Error(w, `{"error":"vesselId is required"}`, http.StatusBadRequest)
		return
	}

	// TODO: Implement when Supabase REST client is wired up
	// 1. Fetch vessel from Supabase
	// 2. Fetch position history
	// 3. Run EEZ detection on each position
	// 4. Apply tax rates per zone
	// 5. Return breakdown

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":   "not_implemented",
		"vesselId": req.VesselID,
		"message":  "Tax calculation will be implemented when Go backend is activated. Use Next.js /api/tax/calculate for now.",
	})
}

// BatchCalculate handles bulk vessel tax calculation.
// POST /api/v1/tax/batch
func (h *Handler) BatchCalculate(w http.ResponseWriter, r *http.Request) {
	var req BatchCalculateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(req.VesselIDs) == 0 {
		http.Error(w, `{"error":"vesselIds is required"}`, http.StatusBadRequest)
		return
	}

	// TODO: Implement batch calculation
	// This is the main reason for the Go backend:
	// calculate tax for 100+ vessels in parallel without serverless timeouts

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "not_implemented",
		"vesselCount": len(req.VesselIDs),
		"message":    "Batch tax calculation will be implemented when Go backend is activated.",
	})
}
