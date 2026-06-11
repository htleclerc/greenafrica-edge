package reconcile

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/geofence"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestRunOnce_DetectsEEZExit(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Fixture vessel with latest position in INTERNATIONAL waters + alert ARRIVED
	var vID string
	_ = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999444001','TEST-SWEEP','MV SWEEP','TSW01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name=EXCLUDED.name
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessel_positions WHERE vessel_id=$1`, vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vID)

	// Alert is ARRIVED but vessel's latest position is clearly outside EEZ
	_, _ = db.ExecContext(context.Background(),
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status, arrived_at)
		 VALUES ($1, 'TEST-SWEEP', 10.5, 45, 0, 'ARRIVED', NOW() - INTERVAL '2 hour')`, vID)
	_, _ = db.ExecContext(context.Background(),
		`INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, recorded_at)
		 VALUES ($1, 2.0, 55.0, 90, 12, NOW())`, vID)

	gfs := geofence.NewStore(db)
	s := NewSweeper(db, gfs)
	n, err := s.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if n < 1 {
		t.Fatalf("swept %d, want >= 1", n)
	}

	var status string
	_ = db.QueryRowContext(context.Background(),
		`SELECT status::text FROM public.arrival_alerts WHERE vessel_id=$1`, vID).Scan(&status)
	if status != "DEPARTED_EEZ" {
		t.Fatalf("status = %q, want DEPARTED_EEZ", status)
	}
}

func TestStart_RunsTicksUntilContextCancel(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	gfs := geofence.NewStore(db)
	s := NewSweeper(db, gfs)
	done := make(chan error, 1)
	go func() { done <- s.Start(ctx, 50*time.Millisecond) }()
	time.Sleep(200 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Start returned: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Sweeper did not stop on context cancel")
	}
}
