// Package tariff resolves the versioned carbon-tax rate for a jurisdiction + mode.
//
// PRIX = méthodologie[mode](émissions) × tarif[juridiction, mode, catégorie, date].
// Lookup is FAIL-CLOSED: a missing ACTIVE tariff is an error — never a silent $0
// (eng review fiscal rule). Most-specific match wins: a row with asset_category set
// beats the NULL (all-categories) row; latest effective_from wins within a window.
//
// Cache resolution is DAY-GRANULAR: two calls on the same calendar day (UTC) with the
// same (jurisdiction, mode, category) return the same cached rate regardless of the
// sub-second wall-clock time.  Misses are intentionally NOT negative-cached so a
// freshly-seeded tariff row is visible within the TTL (instant recovery after an admin
// fixes a missing tariff).
package tariff

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ErrNoActiveTariff is returned (wrapped) when no ACTIVE tariff row matches the
// requested (jurisdiction, mode, category, date) tuple.  Use errors.Is to detect it.
var ErrNoActiveTariff = errors.New("no active tariff (fail-closed)")

// Rate is the resolved tariff version.
type Rate struct {
	ID          string
	RatePerTCO2 float64
	Currency    string
}

// cacheKey is the composite key used for the in-memory cache.  day is "2006-01-02"
// (UTC), making cache hits strictly day-granular and timezone-independent.
type cacheKey struct{ jurisdiction, mode, category, day string }

// Store caches tariff lookups for ttl (mirrors appconfig.Reader's 60s cache).
type Store struct {
	db  *sql.DB
	ttl time.Duration

	mu    sync.Mutex
	cache map[cacheKey]cached
}

type cached struct {
	rate      Rate
	fetchedAt time.Time
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db, ttl: 60 * time.Second, cache: map[cacheKey]cached{}}
}

// Lookup resolves the ACTIVE tariff for (jurisdictionID, mode, category) at time `at`.
// category may be "" (matches only the NULL all-categories row).
// Resolution is DAY-GRANULAR: `at` is truncated to its UTC calendar date for both the
// cache key and the SQL comparison ($4::date), so the result is identical for any
// instant within the same UTC day.
func (s *Store) Lookup(ctx context.Context, jurisdictionID, mode, category string, at time.Time) (Rate, error) {
	day := at.UTC().Format("2006-01-02")
	key := cacheKey{jurisdiction: jurisdictionID, mode: mode, category: category, day: day}

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
		   AND effective_from <= $4::date
		   AND (effective_to IS NULL OR effective_to > $4::date)
		 ORDER BY (asset_category IS NOT NULL) DESC, effective_from DESC
		 LIMIT 1
	`, jurisdictionID, mode, category, day).Scan(&r.ID, &r.RatePerTCO2, &r.Currency)
	if errors.Is(err, sql.ErrNoRows) {
		return Rate{}, fmt.Errorf("tariff: %w: jurisdiction=%s mode=%s category=%q at=%s",
			ErrNoActiveTariff, jurisdictionID, mode, category, day)
	}
	if err != nil {
		return Rate{}, fmt.Errorf("tariff: lookup: %w", err)
	}

	// pgx does NOT trim bpchar automatically; TrimSpace is a cheap guard for
	// ISO-4217 3-char codes that may arrive with trailing spaces from CHAR(3) columns.
	r.Currency = strings.TrimSpace(r.Currency)

	s.mu.Lock()
	s.cache[key] = cached{rate: r, fetchedAt: time.Now()}
	s.mu.Unlock()
	return r, nil
}
