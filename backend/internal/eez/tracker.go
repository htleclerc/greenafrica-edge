// Package eez (extension) tracks zone edges per vessel so the pipeline can
// react to EEZ entry and exit. The underlying point-in-polygon logic lives
// in detector.go (existing).
package eez

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/geofence"
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
	db  *sql.DB
	gfs *geofence.Store
}

// NewTracker creates a Tracker that resolves zones from the DB-driven geofence store.
func NewTracker(db *sql.DB, gfs *geofence.Store) *Tracker {
	return &Tracker{db: db, gfs: gfs}
}

// isUniqueViolation detects pg's unique_violation via substring match to avoid
// pulling the pgconn dep here.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint")
}

// OnPosition evaluates the zone and updates arrival_alerts if an edge crossed.
// Returns the event (with From/To zones) so callers can log/observe.
func (t *Tracker) OnPosition(ctx context.Context, p Position) (Event, error) {
	zoneStr, jid, matched, derr := t.gfs.MaritimeMatch(ctx, p.Lat, p.Lng)
	if derr != nil {
		return Event{}, fmt.Errorf("eez tracker: geofence match: %w", derr)
	}
	now := ZoneInternational
	if matched {
		now = Zone(zoneStr)
	}

	// Read previous (zone, jurisdiction) pair.
	var prev sql.NullString
	var prevJid sql.NullString
	if err := t.db.QueryRowContext(ctx,
		`SELECT last_zone, last_zone_jurisdiction_id::text FROM public.vessels WHERE id=$1`, p.VesselID,
	).Scan(&prev, &prevJid); err != nil {
		return Event{}, fmt.Errorf("eez tracker: read last_zone: %w", err)
	}
	prevZone := Zone(prev.String)

	evt := Event{VesselID: p.VesselID, From: prevZone, To: now}

	inNow := now == ZoneEEZ || now == ZonePortVicinity
	inPrev := prevZone == ZoneEEZ || prevZone == ZonePortVicinity
	// A jurisdiction hop while staying in coastal waters (DJ EEZ → SO EEZ across the
	// abutting edge) is an exit from the old jurisdiction AND an entry into the new.
	crossed := inPrev && inNow && prevJid.Valid && prevJid.String != jid

	exited := inPrev && (!inNow || crossed)
	entered := inNow && (!inPrev || crossed)
	persistOK := true

	if exited {
		// Close only the alert belonging to the jurisdiction we just left.
		// The jurisdiction filter is lenient for legacy rows (prevJid empty = unknown):
		// when we know the previous jurisdiction, only close ITS alert; when unknown
		// (legacy), keep old behavior and close whatever ARRIVED alert exists.
		_, err := t.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='DEPARTED_EEZ', departed_eez_at=$1
			  WHERE vessel_id=$2
			    AND status='ARRIVED'
			    AND (jurisdiction_id::text = $3 OR $3 = '')`,
			p.RecordedAt, p.VesselID, prevJid.String)
		if err != nil {
			return evt, fmt.Errorf("eez tracker: update to DEPARTED_EEZ: %w", err)
		}
	}

	if entered {
		// The corridor stamp is PROVISIONAL; physical entry is authoritative.
		// Flip the active alert (if any, for this jurisdiction) to ARRIVED with
		// authoritative arrived_at timestamp.
		res, err := t.db.ExecContext(ctx,
			`UPDATE public.arrival_alerts
			    SET status='ARRIVED', arrived_at=$1, jurisdiction_id=$3::uuid
			  WHERE vessel_id=$2
			    AND status IN ('PROFORMA_SENT','MATCHED_AUTO','CLAIMED','UNCLAIMED','ESCALATED','DETECTED')`,
			p.RecordedAt, p.VesselID, jid)
		if err != nil {
			return evt, fmt.Errorf("eez tracker: update to ARRIVED: %w", err)
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			// Retroactive alert: the vessel entered EEZ without any prior
			// DETECTED/CLAIMED/… alert (AIS gap, spoofing, etc.). Create one
			// in ARRIVED state so the pipeline has something to reconcile.
			var imo string
			if lerr := t.db.QueryRowContext(ctx,
				`SELECT imo_number FROM public.vessels WHERE id=$1`, p.VesselID,
			).Scan(&imo); lerr != nil {
				log.Printf("[eez] retroactive alert: lookup imo for vessel=%s: %v", p.VesselID, lerr)
				return evt, nil
			}
			if imo == "" {
				log.Printf("[eez] retroactive alert skipped: vessel=%s has empty imo", p.VesselID)
				return evt, nil
			}
			if _, ierr := t.db.ExecContext(ctx,
				`INSERT INTO public.arrival_alerts
				   (vessel_id, imo_number, detected_lat, detected_lng,
				    distance_to_port_nm, status, arrived_at, jurisdiction_id)
				 VALUES ($1, $2, $3, $4, 0, 'ARRIVED', $5, $6::uuid)`,
				p.VesselID, imo, p.Lat, p.Lng, p.RecordedAt, jid,
			); ierr != nil {
				if isUniqueViolation(ierr) {
					// An active alert for a different jurisdiction is not yet reconciled.
					// Do NOT persist last_zone / last_zone_jurisdiction_id — this tick's
					// edge will re-fire on the next position (natural retry).
					log.Printf("[eez] retroactive alert blocked by unique index (cross-jid conflict): vessel=%s jid=%s — will retry next tick", p.VesselID, jid)
					persistOK = false
				} else {
					log.Printf("[eez] retroactive alert: insert vessel=%s imo=%s: %v", p.VesselID, imo, ierr)
				}
			}
		}
	}

	// Persist (zone, jurisdiction) only when we have a clean state.
	// If persistOK is false the edge re-fires on the next position.
	if persistOK {
		jidArg := jid
		if !matched {
			jidArg = ""
		}
		if _, err := t.db.ExecContext(ctx,
			`UPDATE public.vessels SET last_zone=$1, last_zone_jurisdiction_id=NULLIF($2,'')::uuid WHERE id=$3`,
			string(now), jidArg, p.VesselID,
		); err != nil {
			return evt, fmt.Errorf("eez tracker: write last_zone: %w", err)
		}
	}

	return evt, nil
}
