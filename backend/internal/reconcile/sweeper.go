// Package reconcile periodically scans ARRIVED alerts and transitions them to
// DEPARTED_EEZ when the vessel's most recent position has left the EEZ. The
// per-position eez.Tracker handles the hot path; this sweeper is the safety
// net for dropped AIS messages.
package reconcile

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/eez"
)

type Sweeper struct {
	db *sql.DB
}

func NewSweeper(db *sql.DB) *Sweeper {
	return &Sweeper{db: db}
}

// RunOnce scans and returns the number of alerts transitioned to DEPARTED_EEZ.
func (s *Sweeper) RunOnce(ctx context.Context) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.vessel_id,
		       (SELECT vp.lat FROM public.vessel_positions vp
		         WHERE vp.vessel_id=a.vessel_id ORDER BY vp.recorded_at DESC LIMIT 1),
		       (SELECT vp.lng FROM public.vessel_positions vp
		         WHERE vp.vessel_id=a.vessel_id ORDER BY vp.recorded_at DESC LIMIT 1),
		       (SELECT vp.recorded_at FROM public.vessel_positions vp
		         WHERE vp.vessel_id=a.vessel_id ORDER BY vp.recorded_at DESC LIMIT 1)
		  FROM public.arrival_alerts a
		 WHERE a.status='ARRIVED' AND a.departed_eez_at IS NULL
	`)
	if err != nil {
		return 0, fmt.Errorf("sweeper: query: %w", err)
	}
	defer rows.Close()

	type pending struct {
		alertID    string
		vesselID   string
		lat        float64
		lng        float64
		recordedAt time.Time
	}
	var all []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.alertID, &p.vesselID, &p.lat, &p.lng, &p.recordedAt); err != nil {
			return 0, fmt.Errorf("sweeper: scan: %w", err)
		}
		all = append(all, p)
	}

	n := 0
	for _, p := range all {
		zone := eez.Detect(p.lat, p.lng)
		if zone == eez.ZoneEEZ || zone == eez.ZonePortVicinity {
			continue
		}
		_, err := s.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='DEPARTED_EEZ', departed_eez_at=$1
			  WHERE id=$2 AND status='ARRIVED'`,
			p.recordedAt, p.alertID)
		if err != nil {
			return n, fmt.Errorf("sweeper: update %s: %w", p.alertID, err)
		}
		n++
	}
	return n, nil
}

// Start runs RunOnce on `interval` until ctx is cancelled.
func (s *Sweeper) Start(ctx context.Context, interval time.Duration) error {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if _, err := s.RunOnce(ctx); err != nil {
				// log and keep going; sweeper should not take down the process
				fmt.Printf("[reconcile] sweep error: %v\n", err)
			}
		}
	}
}
