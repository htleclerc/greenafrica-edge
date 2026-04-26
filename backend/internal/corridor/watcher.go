// Package corridor detects AIS positions inside the approach corridor
// (configurable radius around destination ports) and records
// arrival_alerts rows so the pro-forma pipeline can pick them up.
package corridor

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/geo"
)

// Destination ports (lat, lng) to check proximity against.
// Kept in code for now; migration to GeoJSON/DB happens in a later plan.
var destinations = []struct {
	Name string
	Lat  float64
	Lng  float64
}{
	{"Berbera", 10.43, 45.02},
	{"Zeila", 11.35, 43.48},
}

type Position struct {
	VesselID   string
	IMO        string
	Lat        float64
	Lng        float64
	SpeedKnots float64
	RecordedAt time.Time
}

type Watcher struct {
	db  *sql.DB
	cfg *appconfig.Reader
}

func New(db *sql.DB, cfg *appconfig.Reader) *Watcher {
	return &Watcher{db: db, cfg: cfg}
}

// Evaluate reports whether the position triggered a new alert. If the vessel
// is inside the corridor and has no active alert, a DETECTED row is created.
// Returns the alert id (empty if no alert was created) and any error.
func (w *Watcher) Evaluate(ctx context.Context, p Position) (string, error) {
	if p.IMO == "" {
		return "", nil // no-op: corridor detection requires an IMO
	}

	radiusNM, err := w.cfg.GetFloat(ctx, "arrival.corridor_radius_nm")
	if err != nil {
		return "", fmt.Errorf("corridor: read radius: %w", err)
	}

	bestDist := math.MaxFloat64
	for _, d := range destinations {
		if dist := geo.HaversineNM(p.Lat, p.Lng, d.Lat, d.Lng); dist < bestDist {
			bestDist = dist
		}
	}
	if bestDist > radiusNM {
		return "", nil // outside corridor
	}

	// Simple ETA: straight-line time at current speed, min 6 knots to avoid /0.
	speed := p.SpeedKnots
	if speed < 6 {
		speed = 6
	}
	etaHours := bestDist / speed
	eta := p.RecordedAt.Add(time.Duration(etaHours * float64(time.Hour)))
	// Conservative estimated EEZ transit: 1.5× straight-line to port.
	estRoute := bestDist * 1.5

	var alertID string
	err = w.db.QueryRowContext(ctx, `
		INSERT INTO public.arrival_alerts
		  (vessel_id, imo_number, detected_lat, detected_lng,
		   distance_to_port_nm, estimated_eta, estimated_route_nm, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'DETECTED')
		RETURNING id
	`, p.VesselID, p.IMO, p.Lat, p.Lng, bestDist, eta, estRoute).Scan(&alertID)
	if err != nil {
		// Unique partial index on (vessel_id) WHERE status NOT IN (RECONCILED, CANCELLED)
		// will reject a second active alert. That is the intended deduplication path.
		if isUniqueViolation(err) {
			return "", nil
		}
		return "", fmt.Errorf("corridor: insert alert: %w", err)
	}
	return alertID, nil
}

// isUniqueViolation detects pg's unique_violation via substring match to avoid
// pulling the pgconn dep here. If this helper grows, switch to errors.As on
// *pgconn.PgError.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint")
}
