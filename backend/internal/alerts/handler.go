// Package alerts exposes HTTP endpoints over arrival_alerts.
package alerts

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
)

type Handler struct {
	db *sql.DB
}

func NewHandler(db *sql.DB) *Handler {
	return &Handler{db: db}
}

type distanceResponse struct {
	AlertID    string  `json:"alert_id"`
	DistanceNM float64 `json:"total_distance_eez_nm"`
}

func (h *Handler) DistanceFinal(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing alert id"}`, http.StatusBadRequest)
		return
	}

	var nm float64
	err := h.db.QueryRowContext(r.Context(),
		`SELECT public.alert_distance_final_nm($1)`, id).Scan(&nm)
	if err != nil {
		log.Printf("[alerts] distance-final alert=%s: %v", id, err)
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(distanceResponse{
		AlertID:    id,
		DistanceNM: nm,
	})
}
