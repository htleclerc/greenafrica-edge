package corridor

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/geofence"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestEvaluate_WithinCorridor_CreatesAlert(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Fixture: insert a vessel close to Berbera (10.43, 45.02) — within 500 NM
	var vesselID string
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999222001','TEST-CORR','MV CORRIDOR','TC01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vesselID)

	cfg := appconfig.New(db)
	gfs := geofence.NewStore(db)
	w := New(db, cfg, gfs)

	_, err = w.Evaluate(context.Background(), Position{
		VesselID:   vesselID,
		IMO:        "TEST-CORR",
		Lat:        11.0, // ~70 NM from Berbera
		Lng:        45.0,
		SpeedKnots: 12,
		RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}

	// Alert should exist with status DETECTED
	var status string
	err = db.QueryRowContext(context.Background(),
		`SELECT status::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&status)
	if err != nil {
		t.Fatalf("alert not found: %v", err)
	}
	if status != "DETECTED" {
		t.Fatalf("status = %q, want DETECTED", status)
	}
}

func TestEvaluate_Duplicate_NoSecondAlert(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	var vesselID string
	_ = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999222002','TEST-CORR-2','MV DUP','TC02','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vesselID)

	cfg := appconfig.New(db)
	gfs := geofence.NewStore(db)
	w := New(db, cfg, gfs)
	pos := Position{VesselID: vesselID, IMO: "TEST-CORR-2", Lat: 11.0, Lng: 45.0, SpeedKnots: 12, RecordedAt: time.Now()}
	_, _ = w.Evaluate(context.Background(), pos)
	_, _ = w.Evaluate(context.Background(), pos) // second call

	var n int
	db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&n)
	if n != 1 {
		t.Fatalf("active alert count = %d, want 1 (unique partial index)", n)
	}
}
