package geofence

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

const (
	soJID = "00000000-0000-4000-8000-00000000534f"
	djJID = "00000000-0000-4000-8000-00000000444a"
)

func openDB(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return NewStore(db)
}

// ── Maritime match boundary tests ─────────────────────────────────────────────

var maritimeTests = []struct {
	name    string
	lat     float64
	lng     float64
	wantOK  bool
	wantKind string
	wantJID string
}{
	// Berbera PORT_VICINITY — Somaliland
	{"berbera port vicinity", 10.45, 45.04, true, KindPortVicinity, soJID},
	// Djibouti PORT_VICINITY
	{"djibouti port vicinity", 11.60, 43.14, true, KindPortVicinity, djJID},
	// Obock coast — Djibouti EEZ (C1 review fix)
	{"djibouti eez obock", 11.96, 43.29, true, KindEEZ, djJID},
	// Sept Frères — Djibouti EEZ
	{"djibouti eez sept freres", 12.47, 43.43, true, KindEEZ, djJID},
	// South of 11.5, east of 43.20 — Somaliland EEZ
	{"somaliland eez south", 11.30, 43.30, true, KindEEZ, soJID},
	// Gulf of Aden transit — Somaliland transit lane
	{"somaliland transit aden", 12.00, 44.00, true, KindTransitLane, soJID},
	// International waters
	{"international waters", 5.00, 50.00, false, "", ""},
	// Maritime abutting edge: SO EEZ west edge at lng 43.20, lat 11.30.
	// DJ EEZ ring has a vertex at (11.55, 43.20) and extends east only above lat 11.55;
	// at lat 11.30 the SO EEZ polygon includes that column (west edge segment runs
	// (11.50,43.20)→(10.00,43.20) closing the ring). Ray-cast analysis shows exactly
	// one crossing inside SO EEZ and zero inside DJ EEZ → deterministic winner = SO.
	{"maritime abutting edge SO/DJ at lng 43.20 lat 11.30 → SO", 11.30, 43.20, true, KindEEZ, soJID},
}

func TestMaritimeMatch_BoundaryPoints(t *testing.T) {
	s := openDB(t)
	ctx := context.Background()

	for _, tc := range maritimeTests {
		t.Run(tc.name, func(t *testing.T) {
			kind, jid, ok, err := s.MaritimeMatch(ctx, tc.lat, tc.lng)
			if err != nil {
				t.Fatalf("MaritimeMatch: %v", err)
			}
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want %v (lat=%.2f lng=%.2f)", ok, tc.wantOK, tc.lat, tc.lng)
			}
			if !tc.wantOK {
				return
			}
			if kind != tc.wantKind {
				t.Fatalf("kind=%q want %q", kind, tc.wantKind)
			}
			if jid != tc.wantJID {
				t.Fatalf("jid=%q want %q", jid, tc.wantJID)
			}
		})
	}
}

// ── FIR match tests ───────────────────────────────────────────────────────────

var firTests = []struct {
	name    string
	lat     float64
	lng     float64
	wantOK  bool
	wantJID string
}{
	// Hargeisa — Somaliland FIR
	{"hargeisa so fir", 9.56, 44.08, true, soJID},
	// Djibouti-Ambouli — Djibouti FIR
	{"djibouti ambouli dj fir", 11.55, 43.16, true, djJID},
	// Exactly on SO/DJ shared edge: lat 10.0 is below DJ FIR south edge (10.90) → Somaliland
	{"shared edge so side", 10.00, 43.45, true, soJID},
	// FIR shared-edge point at lat 11.00, lng 43.45 (within both FIRs' lat range).
	// DJ FIR south edge = lat 10.90 (11.00 is inside DJ lat range).
	// Ray-cast from lng 43.45 east: SO FIR west edge is xi=43.45 → strict (xi>lng)
	// = (43.45>43.45) = false, so SO FIR's west-edge segments are never triggered for
	// the SO ring. DJ FIR east edge xi=43.45 similarly fires 0 crossings on its east-edge
	// segments. Empirically SO FIR fires one interior crossing (the (11.80,49.5)→(11.80,43.45)
	// segment); DJ FIR fires 0 → point resolves to EXACTLY Somaliland.
	{"fir shared-edge lat 11.00 lng 43.45 → SO", 11.00, 43.45, true, soJID},
}

func TestFIRMatch_BoundaryPoints(t *testing.T) {
	s := openDB(t)
	ctx := context.Background()

	for _, tc := range firTests {
		t.Run(tc.name, func(t *testing.T) {
			jid, ok, err := s.FIRMatch(ctx, tc.lat, tc.lng)
			if err != nil {
				t.Fatalf("FIRMatch: %v", err)
			}
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want %v (lat=%.2f lng=%.2f)", ok, tc.wantOK, tc.lat, tc.lng)
			}
			if !tc.wantOK {
				return
			}
			if jid != tc.wantJID {
				t.Fatalf("jid=%q want %q", jid, tc.wantJID)
			}
		})
	}
}

// ── Ports tests ───────────────────────────────────────────────────────────────

func TestPorts_ExactlyThree(t *testing.T) {
	s := openDB(t)
	ctx := context.Background()

	ports, err := s.Ports(ctx)
	if err != nil {
		t.Fatalf("Ports: %v", err)
	}
	if len(ports) != 3 {
		t.Fatalf("ports count=%d want 3", len(ports))
	}

	wantRefs := []string{"somaliland-dest-berbera", "somaliland-dest-zeila", "djibouti-dest-djibouti"}
	for _, want := range wantRefs {
		found := false
		for _, p := range ports {
			if p.Ref == want {
				found = true
				if p.JurisdictionID == "" {
					t.Errorf("port %q has empty jurisdiction_id", want)
				}
				break
			}
		}
		if !found {
			t.Errorf("port ref %q not found in results", want)
		}
	}
}

// ── Cache test — second call within TTL does not re-query ─────────────────────

func TestCache_SecondCallHitsCache(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()

	s := NewStore(db)
	ctx := context.Background()

	// Insert a test-only PORT_VICINITY geofence centred at lat=5.0, lng=47.0 —
	// well outside all real zones (SO EEZ starts at lat 10.0, DJ at lat 11.2).
	// This makes the third-call assertion unambiguous: after the row is deleted and
	// the cache is invalidated, the point must return no match (ok=false).
	const testRef = "test-cache-intl-waters"
	const testLat, testLng = 5.0, 47.0
	_, err = db.ExecContext(ctx, `
		INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry, active)
		VALUES ($1, '00000000-0000-4000-8000-00000000534f',
		        'MARITIME', 'PORT_VICINITY', 'Cache test geofence (international waters)',
		        '[{"lat":4.99,"lng":46.99},{"lat":4.99,"lng":47.01},{"lat":5.01,"lng":47.01},{"lat":5.01,"lng":46.99},{"lat":4.99,"lng":46.99}]',
		        TRUE)
		ON CONFLICT (ref) DO NOTHING`, testRef)
	if err != nil {
		t.Fatalf("insert test geofence: %v", err)
	}
	defer func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM public.geofences WHERE ref = $1`, testRef)
		// Invalidate cache so subsequent tests see a clean state.
		s.mu.Lock()
		s.cached = nil
		s.mu.Unlock()
	}()

	// Force a fresh load, then first call populates cache.
	s.mu.Lock()
	s.cached = nil
	s.mu.Unlock()

	kind1, _, ok1, err := s.MaritimeMatch(ctx, testLat, testLng)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if !ok1 || kind1 != KindPortVicinity {
		t.Fatalf("first call: expected PORT_VICINITY match, ok=%v kind=%q", ok1, kind1)
	}

	// Delete the test row from the DB — cache should still serve the old list.
	_, _ = db.ExecContext(ctx, `DELETE FROM public.geofences WHERE ref = $1`, testRef)

	// Second call within TTL — must still match (served from cache).
	kind2, _, ok2, err := s.MaritimeMatch(ctx, testLat, testLng)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if !ok2 || kind2 != KindPortVicinity {
		t.Fatalf("second call: expected cache hit (PORT_VICINITY), ok=%v kind=%q", ok2, kind2)
	}

	// Advance fetchedAt beyond TTL to force a DB re-read on next call.
	// The test row is gone, and lat=5.0 lng=47.0 is in international waters → no match.
	s.mu.Lock()
	s.fetchedAt = time.Now().Add(-2 * time.Minute)
	s.mu.Unlock()

	_, _, ok3, err := s.MaritimeMatch(ctx, testLat, testLng)
	if err != nil {
		t.Fatalf("third call (stale cache): %v", err)
	}
	if ok3 {
		t.Fatal("third call: expected no match after cache invalidation (test row deleted, international waters)")
	}
}

// ── Djibouti port vicinity centre-point check ─────────────────────────────────

func TestDjiboutiPortVicinity_CentrePoint(t *testing.T) {
	s := openDB(t)
	ctx := context.Background()

	// Centre of djibouti-port-djibouti ring: lat∈[11.57,11.63], lng∈[43.10,43.18]
	kind, jid, ok, err := s.MaritimeMatch(ctx, 11.60, 43.14)
	if err != nil {
		t.Fatalf("MaritimeMatch: %v", err)
	}
	if !ok {
		t.Fatal("expected PORT_VICINITY match for Djibouti port centre")
	}
	if kind != KindPortVicinity {
		t.Fatalf("kind=%q want PORT_VICINITY", kind)
	}
	if !strings.HasSuffix(jid, "444a") {
		t.Fatalf("jid=%q want Djibouti (ends 444a)", jid)
	}
}
