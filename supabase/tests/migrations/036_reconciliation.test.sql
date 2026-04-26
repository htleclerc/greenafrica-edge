BEGIN;

-- Trigger exists
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'enqueue_reconciliation_on_departed'
  ), 'trigger enqueue_reconciliation_on_departed missing';
END $$;

-- Function exists
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='fn_enqueue_reconciliation'
  ), 'fn_enqueue_reconciliation missing';
END $$;

-- Cron job scheduled
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'reconciliation-worker'
  ), 'cron job reconciliation-worker missing';
END $$;

-- Functional: update an alert to DEPARTED_EEZ and see a pgmq message land
DO $$
DECLARE
  v_vessel UUID;
  v_alert  UUID;
  v_queued INT;
BEGIN
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999800001','TEST-RECON','MV RECON','TR01','SO','CARGO',
            50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts (
    vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
    status, arrived_at
  ) VALUES (v_vessel, 'TEST-RECON', 11, 46, 0, 'ARRIVED', NOW() - INTERVAL '3 hours')
  RETURNING id INTO v_alert;

  -- Transition to DEPARTED_EEZ — trigger fires
  UPDATE public.arrival_alerts
     SET status = 'DEPARTED_EEZ', departed_eez_at = NOW()
   WHERE id = v_alert;

  SELECT COUNT(*) INTO v_queued
    FROM pgmq.q_reconciliation_queue
   WHERE message->>'arrival_alert_id' = v_alert::text;
  ASSERT v_queued = 1,
    format('reconciliation_queue has %s msgs for this alert, want 1', v_queued);

  -- Idempotency: a second UPDATE that keeps status=DEPARTED_EEZ must NOT
  -- enqueue again.
  UPDATE public.arrival_alerts
     SET departed_eez_at = NOW() + INTERVAL '1 minute'
   WHERE id = v_alert;

  SELECT COUNT(*) INTO v_queued
    FROM pgmq.q_reconciliation_queue
   WHERE message->>'arrival_alert_id' = v_alert::text;
  ASSERT v_queued = 1,
    format('non-status change should not re-enqueue, got %s msgs', v_queued);
END $$;

ROLLBACK;
