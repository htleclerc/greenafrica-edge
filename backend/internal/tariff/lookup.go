// Package tariff resolves the versioned carbon-tax rate for a jurisdiction + mode.
//
// PRIX = méthodologie[mode](émissions) × tarif[juridiction, mode, catégorie, date].
// Lookup is FAIL-CLOSED: a missing ACTIVE tariff is an error — never a silent $0
// (eng review fiscal rule). Most-specific match wins: a row with asset_category set
// beats the NULL (all-categories) row; latest effective_from wins within a window.
package tariff

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Rate is the resolved tariff version.
type Rate struct {
	ID          string
	RatePerTCO2 float64
	Currency    string
}

// Store caches tariff lookups for ttl (mirrors appconfig.Reader's 60s cache).
type Store struct {
	db  *sql.DB
	ttl time.Duration

	mu    sync.Mutex
	cache map[string]cached
}

type cached struct {
	rate      Rate
	fetchedAt time.Time
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, ttl: 60 * time.Second, cache: map[string]cached{}}
}

// Lookup resolves the ACTIVE tariff for (jurisdictionID, mode, category) at time `at`.
// category may be "" (matches only the NULL all-categories row).
func (s *Store) Lookup(ctx context.Context, jurisdictionID, mode, category string, at time.Time) (Rate, error) {
	key := jurisdictionID + "|" + mode + "|" + category
	s.mu.Lock()
	if c, ok := s.cache[key]; ok && time.Since(c.fetchedAt) < s.ttl {
		s.mu.Unlock()
		return c.rate, nil
	}
	s.mu.Unlock()

	var r Rate
	err := s.db.QueryRowContext(ctx, `
		SELECT id, rate_per_tco2, currency
		  FROM public.tariffs
		 WHERE jurisdiction_id = $1
		   AND mode = $2::public.transport_mode
		   AND status = 'ACTIVE'
		   AND zone IS NULL
		   AND (asset_category IS NULL OR asset_category = $3)
		   AND effective_from <= $4
		   AND (effective_to IS NULL OR effective_to > $4)
		 ORDER BY (asset_category IS NOT NULL) DESC, effective_from DESC
		 LIMIT 1
	`, jurisdictionID, mode, category, at).Scan(&r.ID, &r.RatePerTCO2, &r.Currency)
	if err == sql.ErrNoRows {
		return Rate{}, fmt.Errorf("tariff: no active tariff for jurisdiction=%s mode=%s (fail-closed)", jurisdictionID, mode)
	}
	if err != nil {
		return Rate{}, fmt.Errorf("tariff: lookup: %w", err)
	}

	// pgx returns bpchar (CHAR(3)) trimmed, but TrimSpace is a cheap safety net.
	r.Currency = strings.TrimSpace(r.Currency)

	s.mu.Lock()
	s.cache[key] = cached{rate: r, fetchedAt: time.Now()}
	s.mu.Unlock()
	return r, nil
}
