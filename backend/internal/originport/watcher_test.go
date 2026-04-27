package originport

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func openTestDB(t *testing.T) (*sql.DB, func()) {
	t.Helper()
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, err := supadb.Open(url)
	if err != nil {
		t.Skipf("supadb.Open: %v (skipping; bring up local Supabase)", err)
	}
	return db, func() { db.Close() }
}

func TestWatcher_AllowMatch_CreatesUnclaimedAlert(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	// Ensure the flag is ON for this test
	_, err := db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='true'::jsonb
		  WHERE key='feature.ais_global_enabled'`)
	if err != nil {
		t.Fatalf("flag setup: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='false'::jsonb
		  WHERE key='feature.ais_global_enabled'`)

	// Fixture vessel
	var vesselID string
	err = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('888777001','TEST-OP-1','MV ORIGINPORT','TO01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name=EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vesselID)

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())

	_, err = w.OnStaticData(context.Background(), StaticReport{
		MMSI:        "888777001",
		IMO:         "TEST-OP-1",
		VesselName:  "MV ORIGINPORT",
		Destination: "BERBERA",
		ETA:         time.Now().Add(7 * 24 * time.Hour),
		Lat:         1.5,
		Lng:         100.0,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		t.Fatalf("OnStaticData: %v", err)
	}

	var status, source string
	err = db.QueryRowContext(context.Background(),
		`SELECT status::text, detection_source::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&status, &source)
	if err != nil {
		t.Fatalf("alert lookup: %v", err)
	}
	if status != "UNCLAIMED" {
		t.Errorf("status = %s, want UNCLAIMED", status)
	}
	if source != "ORIGINPORT" {
		t.Errorf("detection_source = %s, want ORIGINPORT", source)
	}
}

func TestWatcher_FuzzyMatch_CreatesProposal(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	_, err := db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='true'::jsonb
		  WHERE key='feature.ais_global_enabled'`)
	if err != nil {
		t.Fatalf("flag setup: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='false'::jsonb
		  WHERE key='feature.ais_global_enabled'`)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.destination_match_proposals WHERE mmsi='888777002'`)

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())

	_, err = w.OnStaticData(context.Background(), StaticReport{
		MMSI:        "888777002",
		IMO:         "TEST-OP-2",
		VesselName:  "MV FUZZY",
		Destination: "BERBERR", // Levenshtein 1 from BERBERA, NOT in allow-list
		Lat:         1.5,
		Lng:         100.0,
		RecordedAt:  time.Now(),
	})
	if err != nil {
		t.Fatalf("OnStaticData: %v", err)
	}

	var status, port string
	var score int
	err = db.QueryRowContext(context.Background(),
		`SELECT status::text, matched_port_guess, fuzzy_score
		   FROM public.destination_match_proposals
		  WHERE mmsi='888777002' ORDER BY created_at DESC LIMIT 1`).
		Scan(&status, &port, &score)
	if err != nil {
		t.Fatalf("proposal lookup: %v", err)
	}
	if status != "PENDING" {
		t.Errorf("status = %s, want PENDING", status)
	}
	if port != "BERBERA" {
		t.Errorf("port = %s, want BERBERA", port)
	}
	if score < 1 || score > 2 {
		t.Errorf("score = %d, want 1 or 2", score)
	}
}

func TestWatcher_FlagOff_NoOp(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	_, err := db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='false'::jsonb
		  WHERE key='feature.ais_global_enabled'`)
	if err != nil {
		t.Fatalf("flag setup: %v", err)
	}

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())
	_, err = w.OnStaticData(context.Background(), StaticReport{
		MMSI: "x", IMO: "y", Destination: "BERBERA", RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("OnStaticData with flag off should be no-op, got error: %v", err)
	}
}

func TestWatcher_EmptyIMO_Drop(t *testing.T) {
	db, cleanup := openTestDB(t)
	defer cleanup()

	_, err := db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='true'::jsonb
		  WHERE key='feature.ais_global_enabled'`)
	if err != nil {
		t.Fatalf("flag setup: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`UPDATE public.app_config SET value='false'::jsonb
		  WHERE key='feature.ais_global_enabled'`)

	cfg := appconfig.New(db)
	w := NewWatcher(db, cfg, NewCache())
	id, err := w.OnStaticData(context.Background(), StaticReport{
		MMSI: "x", IMO: "", Destination: "BERBERA", RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "" {
		t.Errorf("expected empty id (drop), got %q", id)
	}
}
