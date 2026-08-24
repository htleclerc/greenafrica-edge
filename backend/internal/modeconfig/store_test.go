package modeconfig

import (
	"context"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

const soJID = "00000000-0000-4000-8000-00000000534f"

func openDB(t *testing.T) (*Store, func()) {
	t.Helper()
	db := testdb.Open(t)
	s := NewStore(db)
	return s, func() { db.Close() }
}

// TestEnabled_ExplicitTrue: an enabled=true row returns true.
func TestEnabled_ExplicitTrue(t *testing.T) {
	s, done := openDB(t)
	defer done()

	// Somaliland MARITIME must be enabled (seeded by mig 071 / wedge fixtures).
	ok, err := s.Enabled(context.Background(), soJID, "MARITIME")
	if err != nil {
		t.Fatalf("Enabled: %v", err)
	}
	if !ok {
		t.Fatal("expected MARITIME enabled=true for Somaliland")
	}
}

// TestEnabled_ExplicitFalse: an enabled=false row returns false.
func TestEnabled_ExplicitFalse(t *testing.T) {
	s, done := openDB(t)
	defer done()

	// Temporarily set Somaliland MARITIME to disabled.
	_, err := s.db.ExecContext(context.Background(),
		`UPDATE public.jurisdiction_mode_config
		    SET enabled = FALSE
		  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)
	if err != nil {
		t.Fatalf("setup disable: %v", err)
	}
	defer func() {
		_, _ = s.db.ExecContext(context.Background(),
			`UPDATE public.jurisdiction_mode_config
			    SET enabled = TRUE
			  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)
	}()

	// Force fresh load.
	s.mu.Lock()
	s.loaded = false
	s.mu.Unlock()

	ok, err := s.Enabled(context.Background(), soJID, "MARITIME")
	if err != nil {
		t.Fatalf("Enabled: %v", err)
	}
	if ok {
		t.Fatal("expected MARITIME enabled=false after update")
	}
}

// TestEnabled_MissingRow_FailClosed: no row → false (fail-closed).
func TestEnabled_MissingRow_FailClosed(t *testing.T) {
	s, done := openDB(t)
	defer done()

	// A jurisdiction that does not exist in the config table.
	const phantomJID = "00000000-0000-4000-8000-000000009999"
	ok, err := s.Enabled(context.Background(), phantomJID, "MARITIME")
	if err != nil {
		t.Fatalf("Enabled: %v", err)
	}
	if ok {
		t.Fatal("expected false (fail-closed) for missing row")
	}
}

// TestEnabled_Cache_StaleRowNotVisible: after a DB UPDATE the cached value
// remains until the TTL expires (white-box rewind of fetchedAt).
func TestEnabled_Cache_StaleRowNotVisible(t *testing.T) {
	s, done := openDB(t)
	defer done()

	ctx := context.Background()

	// Force a fresh load — Somaliland MARITIME should be enabled.
	s.mu.Lock()
	s.loaded = false
	s.mu.Unlock()

	ok, err := s.Enabled(ctx, soJID, "MARITIME")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if !ok {
		t.Fatal("first call: expected enabled=true")
	}

	// Disable in DB while cache is still warm.
	_, err = s.db.ExecContext(ctx,
		`UPDATE public.jurisdiction_mode_config
		    SET enabled = FALSE
		  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)
	if err != nil {
		t.Fatalf("disable in db: %v", err)
	}
	defer func() {
		_, _ = s.db.ExecContext(ctx,
			`UPDATE public.jurisdiction_mode_config
			    SET enabled = TRUE
			  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)
	}()

	// Second call within TTL — must still return old (true) value from cache.
	ok2, err := s.Enabled(ctx, soJID, "MARITIME")
	if err != nil {
		t.Fatalf("second call (cached): %v", err)
	}
	if !ok2 {
		t.Fatal("second call: expected cached true, not the DB-updated false")
	}

	// Rewind fetchedAt beyond TTL to force a re-read.
	s.mu.Lock()
	s.fetchedAt = time.Now().Add(-2 * time.Minute)
	s.mu.Unlock()

	// Third call — cache is stale, re-reads DB — must see the disabled value.
	ok3, err := s.Enabled(ctx, soJID, "MARITIME")
	if err != nil {
		t.Fatalf("third call (stale): %v", err)
	}
	if ok3 {
		t.Fatal("third call: expected false after cache invalidation (DB row disabled)")
	}
}
