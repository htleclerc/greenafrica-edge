package eez

import (
	"context"
	"testing"
	"time"

	"github.com/htleclerc/africgreen/backend/internal/geofence"
	"github.com/htleclerc/africgreen/backend/internal/modeconfig"
	"github.com/htleclerc/africgreen/backend/internal/testdb"
)

const (
	soJID = "00000000-0000-4000-8000-00000000534f"
	djJID = "00000000-0000-4000-8000-00000000444a"
)

func TestOnPosition_EntryMovesAlertToArrived(t *testing.T) {
	db := testdb.Open(t)

	ctx := context.Background()

	// Fixture vessel starting in INTERNATIONAL zone
	var vID string
	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots,
		    compliance_status, last_zone)
		 VALUES ('999333001','TEST-EEZ-E','MV EEZ','TEZ01','SO','CARGO',
		         50000,20000,14.0,'APPROACHING','INTERNATIONAL')
		 ON CONFLICT (imo_number) DO UPDATE SET last_zone='INTERNATIONAL', last_zone_jurisdiction_id=NULL
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(ctx, `DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(ctx, `DELETE FROM public.vessels WHERE id=$1`, vID)

	// Existing alert in PROFORMA_SENT state
	_, _ = db.ExecContext(ctx,
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status)
		 VALUES ($1, 'TEST-EEZ-E', 11.5, 46, 300, 'PROFORMA_SENT')`, vID)

	gfs := geofence.NewStore(db)
	modes := modeconfig.NewStore(db)
	tr := NewTracker(db, gfs, modes)
	// Position inside EEZ (matches mig 082 Somaliland EEZ polygon around 10.5, 45)
	_, err := tr.OnPosition(ctx, Position{
		VesselID: vID, Lat: 10.5, Lng: 45.0, RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("OnPosition: %v", err)
	}

	var status string
	_ = db.QueryRowContext(ctx,
		`SELECT status::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 ORDER BY detected_at DESC LIMIT 1`, vID).Scan(&status)
	if status != "ARRIVED" {
		t.Fatalf("status = %q, want ARRIVED", status)
	}
}

// TestOnPosition_CrossJurisdictionHop_BlockedThenRetry exercises the two-step
// retry mechanism for a DJ-EEZ → SO-EEZ jurisdiction hop:
//
//   Step 1 (this tick): exited closes the DJ ARRIVED alert → DEPARTED_EEZ.
//     The entered path tries a retroactive INSERT for SO ARRIVED but the unique
//     partial index still covers DEPARTED_EEZ rows → unique violation →
//     persistOK=false → last_zone stays at DJ/EEZ.
//
//   Step 2 (next tick, after DJ alert is RECONCILED): the unique index no longer
//     blocks; SO ARRIVED alert is created and last_zone advances to SO/EEZ.
func TestOnPosition_CrossJurisdictionHop_BlockedThenRetry(t *testing.T) {
	db := testdb.Open(t)

	ctx := context.Background()

	// ── Fixture vessel in DJ EEZ ──────────────────────────────────────────────
	var vID string
	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots,
		    compliance_status, last_zone, last_zone_jurisdiction_id)
		 VALUES ('999334001','TEST-XJID-HOP','MV XJID HOP','TXJID','SO','CARGO',
		         50000,20000,14.0,'APPROACHING','EEZ','`+djJID+`')
		 ON CONFLICT (imo_number) DO UPDATE
		   SET last_zone='EEZ',
		       last_zone_jurisdiction_id='`+djJID+`'
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(ctx, `DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(ctx, `DELETE FROM public.vessels WHERE id=$1`, vID)

	// DJ ARRIVED alert (simulates the vessel having been in DJ EEZ)
	var djAlertID string
	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status, arrived_at, jurisdiction_id)
		 VALUES ($1, 'TEST-XJID-HOP', 11.60, 43.14, 10, 'ARRIVED', NOW()-INTERVAL '1 hour', $2::uuid)
		 RETURNING id`, vID, djJID).Scan(&djAlertID)
	if djAlertID == "" {
		t.Fatal("failed to create DJ ARRIVED alert fixture")
	}

	gfs := geofence.NewStore(db)
	modes := modeconfig.NewStore(db)
	tr := NewTracker(db, gfs, modes)

	// ── Step 1: vessel moves into SO EEZ (e.g. Somaliland EEZ at 11.30, 43.30) ─
	// The geofence store resolves this to SO EEZ (see store_test.go boundary cases).
	tick1 := time.Now()
	_, err := tr.OnPosition(ctx, Position{
		VesselID: vID, Lat: 11.30, Lng: 43.30, RecordedAt: tick1,
	})
	if err != nil {
		t.Fatalf("step1 OnPosition: %v", err)
	}

	// DJ alert must be DEPARTED_EEZ (exited fired)
	var djStatus string
	_ = db.QueryRowContext(ctx,
		`SELECT status::text FROM public.arrival_alerts WHERE id=$1`, djAlertID).Scan(&djStatus)
	if djStatus != "DEPARTED_EEZ" {
		t.Fatalf("step1: DJ alert status = %q, want DEPARTED_EEZ", djStatus)
	}

	// No SO ARRIVED alert yet — retroactive INSERT was blocked
	var soCount int
	_ = db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status='ARRIVED' AND jurisdiction_id=$2::uuid`,
		vID, soJID).Scan(&soCount)
	if soCount != 0 {
		t.Fatalf("step1: expected no SO ARRIVED alert yet (blocked by unique index), got %d", soCount)
	}

	// last_zone must NOT have advanced (persistOK=false)
	var lz, lzJID string
	_ = db.QueryRowContext(ctx,
		`SELECT COALESCE(last_zone,''), COALESCE(last_zone_jurisdiction_id::text,'')
		   FROM public.vessels WHERE id=$1`, vID).Scan(&lz, &lzJID)
	if lz != "EEZ" || lzJID != djJID {
		t.Fatalf("step1: last_zone=%q jid=%q, want EEZ/%s (retry pending)", lz, lzJID, djJID)
	}

	// ── Reconcile the DJ alert (simulates normal pipeline progress) ──────────
	_, _ = db.ExecContext(ctx,
		`UPDATE public.arrival_alerts SET status='RECONCILED' WHERE id=$1`, djAlertID)

	// ── Step 2: same position tick — now the unique index is clear ─────────────
	tick2 := tick1.Add(30 * time.Second)
	_, err = tr.OnPosition(ctx, Position{
		VesselID: vID, Lat: 11.30, Lng: 43.30, RecordedAt: tick2,
	})
	if err != nil {
		t.Fatalf("step2 OnPosition: %v", err)
	}

	// SO ARRIVED alert must now exist
	var soAlertID string
	_ = db.QueryRowContext(ctx,
		`SELECT id::text FROM public.arrival_alerts
		  WHERE vessel_id=$1 AND status='ARRIVED' AND jurisdiction_id=$2::uuid
		  ORDER BY detected_at DESC LIMIT 1`,
		vID, soJID).Scan(&soAlertID)
	if soAlertID == "" {
		t.Fatal("step2: SO ARRIVED alert not created after DJ alert reconciled")
	}

	// last_zone must now reflect SO EEZ
	_ = db.QueryRowContext(ctx,
		`SELECT COALESCE(last_zone,''), COALESCE(last_zone_jurisdiction_id::text,'')
		   FROM public.vessels WHERE id=$1`, vID).Scan(&lz, &lzJID)
	if lz != "EEZ" || lzJID != soJID {
		t.Fatalf("step2: last_zone=%q jid=%q, want EEZ/%s", lz, lzJID, soJID)
	}
}

// TestOnPosition_ModeDisabled_NoRetroactiveAlert: Somaliland MARITIME disabled →
// a vessel entering the EEZ with no prior alert does NOT get a retroactive ARRIVED
// alert, but last_zone IS updated (intentional silence, not a retry).
func TestOnPosition_ModeDisabled_NoRetroactiveAlert(t *testing.T) {
	db := testdb.Open(t)

	ctx := context.Background()

	// Fixture vessel starting in INTERNATIONAL zone.
	var vID string
	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots,
		    compliance_status, last_zone)
		 VALUES ('999333002','TEST-EEZ-GATED','MV GATED EEZ','TEZG','SO','CARGO',
		         50000,20000,14.0,'APPROACHING','INTERNATIONAL')
		 ON CONFLICT (imo_number) DO UPDATE SET last_zone='INTERNATIONAL', last_zone_jurisdiction_id=NULL
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(ctx, `DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(ctx, `DELETE FROM public.vessels WHERE id=$1`, vID)

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

	gfs := geofence.NewStore(db)
	modes := modeconfig.NewStore(db)
	tr := NewTracker(db, gfs, modes)

	// Position inside Somaliland EEZ.
	_, err = tr.OnPosition(ctx, Position{
		VesselID: vID, Lat: 10.5, Lng: 45.0, RecordedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("OnPosition (disabled): %v", err)
	}

	// No retroactive ARRIVED alert should have been created.
	var n int
	_ = db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM public.arrival_alerts WHERE vessel_id=$1`, vID).Scan(&n)
	if n != 0 {
		t.Fatalf("expected no alert when MARITIME disabled, got %d", n)
	}

	// last_zone must have been updated (intentional silence: we advanced zone).
	var lz string
	_ = db.QueryRowContext(ctx,
		`SELECT COALESCE(last_zone,'') FROM public.vessels WHERE id=$1`, vID).Scan(&lz)
	if lz == "INTERNATIONAL" {
		t.Fatal("expected last_zone to advance even when MARITIME disabled")
	}
}
