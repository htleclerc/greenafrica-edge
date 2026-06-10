// Package geofence loads jurisdiction geofences (EEZ zones, FIR rings, corridor
// ports) from public.geofences and resolves (zone, jurisdiction) for a position.
// Replaces the hardcoded Somaliland constants in internal/eez, internal/fir and
// internal/corridor — detection now works for every ACTIVE jurisdiction and the
// matched ring determines the jurisdiction_id stamped on alerts (no more
// column-DEFAULT stamping on detection paths).
//
// Determinism: same-kind rings are seeded DISJOINT (abutting edges resolve to
// exactly one ring under the strict ray-cast). Iteration is sorted kind-priority
// then ref, so even a future accidental overlap resolves deterministically.
package geofence

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Kind values mirror the geofences.kind CHECK constraint.
const (
	KindPortVicinity = "PORT_VICINITY"
	KindEEZ          = "EEZ"
	KindTransitLane  = "TRANSIT_LANE"
	KindFIR          = "FIR"
	KindPort         = "PORT"
)

type Point struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Geofence struct {
	ID             string
	Ref            string
	JurisdictionID string
	Mode           string
	Kind           string
	Name           string
	Ring           []Point // polygon kinds
	Point          Point   // KindPort
}

type Store struct {
	db  *sql.DB
	ttl time.Duration

	mu        sync.Mutex
	cached    []Geofence
	fetchedAt time.Time
}

func NewStore(db *sql.DB) *Store { return &Store{db: db, ttl: 60 * time.Second} }

func (s *Store) all(ctx context.Context) ([]Geofence, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cached != nil && time.Since(s.fetchedAt) < s.ttl {
		return s.cached, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, ref, jurisdiction_id, mode::text, kind, name, geometry
		  FROM public.geofences WHERE active = TRUE`)
	if err != nil {
		return nil, fmt.Errorf("geofence: load: %w", err)
	}
	defer rows.Close()
	var out []Geofence
	for rows.Next() {
		var g Geofence
		var geom []byte
		if err := rows.Scan(&g.ID, &g.Ref, &g.JurisdictionID, &g.Mode, &g.Kind, &g.Name, &geom); err != nil {
			return nil, fmt.Errorf("geofence: scan: %w", err)
		}
		if g.Kind == KindPort {
			if err := json.Unmarshal(geom, &g.Point); err != nil {
				return nil, fmt.Errorf("geofence: %s point geometry: %w", g.Ref, err)
			}
		} else {
			if err := json.Unmarshal(geom, &g.Ring); err != nil {
				return nil, fmt.Errorf("geofence: %s ring geometry: %w", g.Ref, err)
			}
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence: rows: %w", err)
	}
	sort.Slice(out, func(i, j int) bool { // deterministic iteration
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Ref < out[j].Ref
	})
	s.cached, s.fetchedAt = out, time.Now()
	return out, nil
}

// MaritimeMatch resolves the highest-priority maritime zone containing the point,
// across ALL active jurisdictions. ok=false when international waters.
func (s *Store) MaritimeMatch(ctx context.Context, lat, lng float64) (zone string, jurisdictionID string, ok bool, err error) {
	gfs, err := s.all(ctx)
	if err != nil {
		return "", "", false, err
	}
	for _, kind := range []string{KindPortVicinity, KindEEZ, KindTransitLane} {
		for _, g := range gfs {
			if g.Mode == "MARITIME" && g.Kind == kind && pointInRing(lat, lng, g.Ring) {
				return kind, g.JurisdictionID, true, nil
			}
		}
	}
	return "", "", false, nil
}

// FIRMatch resolves the jurisdiction whose FIR ring contains the point.
func (s *Store) FIRMatch(ctx context.Context, lat, lng float64) (jurisdictionID string, ok bool, err error) {
	gfs, err := s.all(ctx)
	if err != nil {
		return "", false, err
	}
	for _, g := range gfs {
		if g.Kind == KindFIR && pointInRing(lat, lng, g.Ring) {
			return g.JurisdictionID, true, nil
		}
	}
	return "", false, nil
}

// Ports returns the corridor destination ports of every active jurisdiction.
func (s *Store) Ports(ctx context.Context) ([]Geofence, error) {
	gfs, err := s.all(ctx)
	if err != nil {
		return nil, err
	}
	var out []Geofence
	for _, g := range gfs {
		if g.Kind == KindPort {
			out = append(out, g)
		}
	}
	return out, nil
}

// pointInRing implements the ray-casting algorithm (identical semantics to the
// legacy internal/eez detector — strict comparisons make shared edges half-open,
// so abutting rings tile without double-matching).
func pointInRing(lat, lng float64, ring []Point) bool {
	inside := false
	n := len(ring)
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		yi, xi := ring[i].Lat, ring[i].Lng
		yj, xj := ring[j].Lat, ring[j].Lng
		if (xi > lng) != (xj > lng) &&
			lat < (yj-yi)*(lng-xi)/(xj-xi)+yi {
			inside = !inside
		}
	}
	return inside
}
