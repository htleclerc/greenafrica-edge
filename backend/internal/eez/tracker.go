// Package eez (extension) tracks zone edges per vessel so the pipeline can
// react to EEZ entry and exit. The underlying point-in-polygon logic lives
// in detector.go (existing).
package eez

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Position struct {
	VesselID   string
	Lat        float64
	Lng        float64
	RecordedAt time.Time
}

type Event struct {
	VesselID string
	From     Zone
	To       Zone
}

type Tracker struct {
	db *sql.DB
}

func NewTracker(db *sql.DB) *Tracker {
	return &Tracker{db: db}
}

// OnPosition evaluates the zone and updates arrival_alerts if an edge crossed.
// Returns the event (with From/To zones) so callers can log/observe.
func (t *Tracker) OnPosition(ctx context.Context, p Position) (Event, error) {
	now := Detect(p.Lat, p.Lng)

	// Read previous zone from vessels.last_zone
	var prev sql.NullString
	if err := t.db.QueryRowContext(ctx,
		`SELECT last_zone FROM public.vessels WHERE id=$1`, p.VesselID,
	).Scan(&prev); err != nil {
		return Event{}, fmt.Errorf("eez tracker: read last_zone: %w", err)
	}
	prevZone := Zone(prev.String)

	evt := Event{VesselID: p.VesselID, From: prevZone, To: now}

	// Update vessels.last_zone
	if _, err := t.db.ExecContext(ctx,
		`UPDATE public.vessels SET last_zone=$1 WHERE id=$2`,
		string(now), p.VesselID,
	); err != nil {
		return evt, fmt.Errorf("eez tracker: write last_zone: %w", err)
	}

	entered := (prevZone != ZoneEEZ && prevZone != ZonePortVicinity) &&
		(now == ZoneEEZ || now == ZonePortVicinity)
	exited := (prevZone == ZoneEEZ || prevZone == ZonePortVicinity) &&
		(now != ZoneEEZ && now != ZonePortVicinity)

	if entered {
		// Flip the active alert (if any) to ARRIVED with arrived_at timestamp.
		// If no active alert exists, create one retroactively.
		res, err := t.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='ARRIVED', arrived_at=$1
			  WHERE vessel_id=$2
			    AND status IN ('PROFORMA_SENT','MATCHED_AUTO','CLAIMED','UNCLAIMED','ESCALATED','DETECTED')`,
			p.RecordedAt, p.VesselID)
		if err != nil {
			return evt, fmt.Errorf("eez tracker: update to ARRIVED: %w", err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			// Retroactive alert: we have to read vessel.imo_number first
			var imo string
			_ = t.db.QueryRowContext(ctx,
				`SELECT imo_number FROM public.vessels WHERE id=$1`, p.VesselID).Scan(&imo)
			if imo != "" {
				_, _ = t.db.ExecContext(ctx,
					`INSERT INTO public.arrival_alerts
					   (vessel_id, imo_number, detected_lat, detected_lng,
					    distance_to_port_nm, status, arrived_at)
					 VALUES ($1, $2, $3, $4, 0, 'ARRIVED', $5)`,
					p.VesselID, imo, p.Lat, p.Lng, p.RecordedAt)
			}
		}
	}

	if exited {
		_, err := t.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='DEPARTED_EEZ', departed_eez_at=$1
			  WHERE vessel_id=$2 AND status='ARRIVED'`,
			p.RecordedAt, p.VesselID)
		if err != nil {
			return evt, fmt.Errorf("eez tracker: update to DEPARTED_EEZ: %w", err)
		}
	}

	return evt, nil
}
