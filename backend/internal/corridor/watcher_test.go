package corridor

import (
	"context"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/appconfig"
	"github.com/htleclerc/africgreen/backend/internal/geofence"
	"github.com/htleclerc/africgreen/backend/internal/modeconfig"
	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

const soJID = "00000000-0000-4000-8000-00000000534f"

func TestEvaluate_WithinCorridor_CreatesAlert(t *testing.T) {
	db := testdb.Open(t)
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
	modes := modeconfig.NewStore(db)
	w := New(db, cfg, gfs, modes)

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
	db := testdb.Open(t)
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
	modes := modeconfig.NewStore(db)
	w := New(db, cfg, gfs, modes)
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

// TestEvaluate_ModeDisabled_NoAlert: Somaliland MARITIME disabled → Evaluate
// inside corridor creates no alert. Restore → alert created (regression check).
func TestEvaluate_ModeDisabled_NoAlert(t *testing.T) {
	db := testdb.Open(t)
	defer db.Close()

	ctx := context.Background()

	// Fixture vessel.
	var vesselID string
	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999222003','TEST-CORR-GATED','MV GATED','TC03','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name = EXCLUDED.name
		 RETURNING id`).Scan(&vesselID)
	defer db.ExecContext(ctx, `DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vesselID)
	defer db.ExecContext(ctx, `DELETE FROM public.vessels WHERE id=$1`, vesselID)

	// Disable Somaliland MARITIME.
	_, err := db.ExecContext(ctx,
		`UPDATE public.jurisdiction_mode_config
		    SET enabled = FALSE
		  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)
	if err != nil {
		t.Fatalf("disable mode: %v", err)
	}
	defer db.ExecContext(ctx,
		`UPDATE public.jurisdiction_mode_config
		    SET enabled = TRUE
		  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)

	cfg := appconfig.New(db)
	gfs := geofence.NewStore(db)
	modes := modeconfig.NewStore(db)
	w := New(db, cfg, gfs, modes)

	pos := Position{VesselID: vesselID, IMO: "TEST-CORR-GATED", Lat: 11.0, Lng: 45.0, SpeedKnots: 12, RecordedAt: time.Now()}

	alertID, err := w.Evaluate(ctx, pos)
	if err != nil {
		t.Fatalf("Evaluate (disabled): %v", err)
	}
	if alertID != "" {
		t.Fatalf("expected no alert when MARITIME disabled, got id=%s", alertID)
	}

	// Verify no row was created.
	var n int
	_ = db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status NOT IN ('RECONCILED','CANCELLED')`,
		vesselID).Scan(&n)
	if n != 0 {
		t.Fatalf("alert count = %d after disabled Evaluate, want 0", n)
	}

	// Re-enable in DB and use a fresh store (no cache to invalidate).
	_, _ = db.ExecContext(ctx,
		`UPDATE public.jurisdiction_mode_config
		    SET enabled = TRUE
		  WHERE jurisdiction_id = $1::uuid AND mode = 'MARITIME'`, soJID)
	w2 := New(db, cfg, gfs, modeconfig.NewStore(db))

	alertID2, err := w2.Evaluate(ctx, pos)
	if err != nil {
		t.Fatalf("Evaluate (re-enabled): %v", err)
	}
	if alertID2 == "" {
		t.Fatal("expected alert after re-enabling MARITIME")
	}
}
