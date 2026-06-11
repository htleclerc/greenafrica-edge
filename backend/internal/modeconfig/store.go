// Package modeconfig answers "is (jurisdiction, mode) enabled?" from
// public.jurisdiction_mode_config. Detection entry points consult it so a
// DISABLED mode creates no new alerts/proformas — in-flight voyages complete
// (exit/reconcile paths never consult the matrix) and the calc API stays open.
// FAIL-CLOSED: a missing row counts as DISABLED. Cached 60s (one query loads
// the whole matrix — it is tiny).
package modeconfig

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

type key struct{ jurisdiction, mode string }

// Store caches the full jurisdiction_mode_config matrix for ttl.
// The cache-miss-equals-DISABLED contract means an empty result set is valid
// and is cached explicitly (loaded=true, empty map).
type Store struct {
	db  *sql.DB
	ttl time.Duration

	mu        sync.Mutex
	cache     map[key]bool
	loaded    bool
	fetchedAt time.Time
}

// NewStore returns a Store with a 60 s TTL (mirrors geofence.Store).
func NewStore(db *sql.DB) *Store {
	return &Store{db: db, ttl: 60 * time.Second}
}

// all loads (or returns the cached) full matrix.
// Pattern mirrors geofence.Store.all: check under lock, release before the
// DB round-trip, relock to store. A rare concurrent duplicate fetch is harmless.
func (s *Store) all(ctx context.Context) (map[key]bool, error) {
	s.mu.Lock()
	if s.loaded && time.Since(s.fetchedAt) < s.ttl {
		m := s.cache
		s.mu.Unlock()
		return m, nil
	}
	s.mu.Unlock()

	rows, err := s.db.QueryContext(ctx,
		`SELECT jurisdiction_id::text, mode::text, enabled
		   FROM public.jurisdiction_mode_config`)
	if err != nil {
		return nil, fmt.Errorf("modeconfig: load: %w", err)
	}
	defer rows.Close()

	m := make(map[key]bool) // always non-nil so an empty table is cached correctly
	for rows.Next() {
		var jid, mode string
		var enabled bool
		if err := rows.Scan(&jid, &mode, &enabled); err != nil {
			return nil, fmt.Errorf("modeconfig: scan: %w", err)
		}
		m[key{jurisdiction: jid, mode: mode}] = enabled
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("modeconfig: rows: %w", err)
	}

	s.mu.Lock()
	s.cache, s.fetchedAt, s.loaded = m, time.Now(), true
	s.mu.Unlock()

	return m, nil
}

// Enabled reports whether (jurisdictionID, mode) is enabled.
// A missing row returns false (fail-closed).
func (s *Store) Enabled(ctx context.Context, jurisdictionID, mode string) (bool, error) {
	m, err := s.all(ctx)
	if err != nil {
		return false, err
	}
	return m[key{jurisdiction: jurisdictionID, mode: mode}], nil
}
