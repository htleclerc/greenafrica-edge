package eez

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/geofence"
	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestOnPosition_EntryMovesAlertToArrived(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()

	// Fixture vessel
	var vID string
	_ = db.QueryRowContext(context.Background(),
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots,
		    compliance_status, last_zone)
		 VALUES ('999333001','TEST-EEZ-E','MV EEZ','TEZ01','SO','CARGO',
		         50000,20000,14.0,'APPROACHING','INTERNATIONAL')
		 ON CONFLICT (imo_number) DO UPDATE SET last_zone='INTERNATIONAL'
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(context.Background(),
		`DELETE FROM public.vessels WHERE id=$1`, vID)

	// Existing alert in PROFORMA_SENT state
	_, _ = db.ExecContext(context.Background(),
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status)
		 VALUES ($1, 'TEST-EEZ-E', 11.5, 46, 300, 'PROFORMA_SENT')`, vID)

	gfs := geofence.NewStore(db)
	tr := NewTracker(db, gfs)
	// Position inside EEZ (matches mig 003 polygon around 10.5, 45)
	_, err := tr.OnPosition(context.Background(), Position{
		VesselID: vID, Lat: 10.5, Lng: 45.0, RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("OnPosition: %v", err)
	}

	var status string
	_ = db.QueryRowContext(context.Background(),
		`SELECT status::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 ORDER BY detected_at DESC LIMIT 1`, vID).Scan(&status)
	if status != "ARRIVED" {
		t.Fatalf("status = %q, want ARRIVED", status)
	}
}
