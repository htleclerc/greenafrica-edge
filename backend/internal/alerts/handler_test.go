package alerts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/htleclerc/africgreen/backend/internal/supadb"
)

func TestHandler_ReturnsDistance(t *testing.T) {
	url := os.Getenv("SUPABASE_DB_URL")
	if url == "" {
		url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
	}
	db, _ := supadb.Open(url)
	defer db.Close()
	ctx := context.Background()

	// Seed an alert with positions
	var vID, aID string
	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.vessels
		   (mmsi, imo_number, name, call_sign, flag_code, category,
		    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status)
		 VALUES ('999555001','TEST-HNDL','MV H','THD01','SO','CARGO',50000,20000,14.0,'APPROACHING')
		 ON CONFLICT (imo_number) DO UPDATE SET name=EXCLUDED.name
		 RETURNING id`).Scan(&vID)
	defer db.ExecContext(ctx, `DELETE FROM public.arrival_alerts WHERE vessel_id=$1`, vID)
	defer db.ExecContext(ctx, `DELETE FROM public.vessel_positions WHERE vessel_id=$1`, vID)
	defer db.ExecContext(ctx, `DELETE FROM public.vessels WHERE id=$1`, vID)

	_ = db.QueryRowContext(ctx,
		`INSERT INTO public.arrival_alerts
		   (vessel_id, imo_number, detected_lat, detected_lng,
		    distance_to_port_nm, status, arrived_at, departed_eez_at)
		 VALUES ($1, 'TEST-HNDL', 11, 46, 0, 'DEPARTED_EEZ',
		         NOW() - INTERVAL '1 hour', NOW())
		 RETURNING id`, vID).Scan(&aID)
	_, _ = db.ExecContext(ctx,
		`INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, recorded_at) VALUES
		 ($1, 11, 45, 90, 12, NOW() - INTERVAL '50 minutes'),
		 ($1, 11, 46, 90, 12, NOW() - INTERVAL '10 minutes')`, vID)

	h := NewHandler(db)
	req := httptest.NewRequest("GET", "/api/v1/alerts/"+aID+"/distance-final", nil)
	req.SetPathValue("id", aID)
	w := httptest.NewRecorder()
	h.DistanceFinal(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var body struct {
		AlertID    string  `json:"alert_id"`
		DistanceNM float64 `json:"total_distance_eez_nm"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DistanceNM < 55 || body.DistanceNM > 65 {
		t.Fatalf("distance = %v, want ~59 NM", body.DistanceNM)
	}
}
