BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='alert_distance_final_nm'
  ), 'function alert_distance_final_nm missing';
END $$;

-- Round trip
DO $$
DECLARE
  v_vessel UUID;
  v_alert  UUID;
  v_dist   NUMERIC;
BEGIN
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999111001','9999111','TEST 032','T032','SO','CARGO',50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts
    (vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm, status,
     arrived_at, departed_eez_at)
  VALUES
    (v_vessel,'9999111',11.0,46.0,0,'DEPARTED_EEZ',
     NOW() - INTERVAL '1 hour', NOW())
  RETURNING id INTO v_alert;

  -- Two synthetic positions 60 NM apart inside the EEZ window
  INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, zone, recorded_at) VALUES
    (v_vessel, 11.00, 45.00, 90, 12, 'EEZ', NOW() - INTERVAL '50 minutes'),
    (v_vessel, 11.00, 46.00, 90, 12, 'EEZ', NOW() - INTERVAL '10 minutes');

  SELECT public.alert_distance_final_nm(v_alert) INTO v_dist;

  -- 1 degree of longitude at 11 deg latitude ≈ 59 NM; allow ±3 NM tolerance
  ASSERT v_dist BETWEEN 55 AND 65,
    format('alert_distance_final_nm returned %s, expected ~59 NM', v_dist);
END $$;

ROLLBACK;
