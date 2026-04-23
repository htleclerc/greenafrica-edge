-- 023: extensions & arrival_alerts schema
BEGIN;

-- Extensions
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgmq'),
    'pgmq extension not enabled';
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron'),
    'pg_cron extension not enabled';
END $$;

-- Enum
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname='arrival_alert_status'),
    'arrival_alert_status enum missing';
  ASSERT (
    SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
      FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='arrival_alert_status'
  ) = ARRAY[
    'DETECTED','MATCHED_AUTO','UNCLAIMED','CLAIMED','ESCALATED',
    'PROFORMA_SENT','ARRIVED','DEPARTED_EEZ','RECONCILED','CANCELLED'
  ], 'arrival_alert_status enum has wrong values';
END $$;

-- Table
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='arrival_alerts'),
    'arrival_alerts table missing';
  -- Required columns
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='arrival_alerts' AND column_name='vessel_id'),
    'arrival_alerts.vessel_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='arrival_alerts' AND column_name='proforma_transaction_id'),
    'arrival_alerts.proforma_transaction_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='arrival_alerts' AND column_name='distance_to_port_nm'),
    'arrival_alerts.distance_to_port_nm missing';
END $$;

-- Unique active alert per vessel
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_alert_active_per_vessel'
  ), 'idx_alert_active_per_vessel missing';
END $$;

-- Constraint: matched_via whitelist
DO $$
DECLARE v_vessel UUID;
BEGIN
  -- Insert a vessel fixture if none exists (all NOT NULL columns per mig 003)
  SELECT id INTO v_vessel FROM public.vessels LIMIT 1;
  IF v_vessel IS NULL THEN
    INSERT INTO public.vessels (
      mmsi, imo_number, name, call_sign, flag_code, category,
      gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
    ) VALUES ('999000001','9999001','TEST','ABC','SO','CARGO',
              50000, 20000, 14.0, 'APPROACHING')
    RETURNING id INTO v_vessel;
  END IF;

  BEGIN
    INSERT INTO public.arrival_alerts (vessel_id, imo_number, detected_lat, detected_lng,
                                       distance_to_port_nm, matched_via)
    VALUES (v_vessel, '9999001', 10.5, 45.0, 400, 'NOT_A_VALID_VIA');
    RAISE EXCEPTION 'check constraint should have rejected invalid matched_via';
  EXCEPTION WHEN check_violation THEN
    -- expected
    NULL;
  END;
END $$;

ROLLBACK;
