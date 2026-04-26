BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net'),
    'pg_net extension not enabled';
END $$;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='agent-match'
  ), 'pg_cron job agent-match not scheduled';
END $$;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='match_pending_alerts'
  ), 'function match_pending_alerts missing';
END $$;

-- Functional check: seed a DETECTED alert with a known shipowner → agent mapping,
-- call the function, verify the alert transitioned to MATCHED_AUTO and a message
-- landed on pgmq.q_proforma_queue.
DO $$
DECLARE
  v_vessel UUID;
  v_owner  UUID;
  v_agent  UUID;
  v_alert  UUID;
  v_queued INT;
BEGIN
  -- Vessel + owner + mapping
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999500001','TEST-MATCH','MV MATCH','TM01','SO','CARGO',
            50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.shipowners (name, account_state)
  VALUES ('Match Test Owner','GHOST') RETURNING id INTO v_owner;

  UPDATE public.vessels SET shipowner_id=v_owner WHERE id=v_vessel;

  SELECT id INTO v_agent FROM public.profiles WHERE role='SHIPPING_AGENT' LIMIT 1;
  ASSERT v_agent IS NOT NULL, 'need seeded SHIPPING_AGENT profile';

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id)
  VALUES (v_owner, v_agent);

  -- DETECTED alert
  INSERT INTO public.arrival_alerts (vessel_id, imo_number, detected_lat, detected_lng,
                                      distance_to_port_nm, status)
  VALUES (v_vessel, 'TEST-MATCH', 11.0, 46.0, 480, 'DETECTED')
  RETURNING id INTO v_alert;

  -- Run the matcher (in-proc, without waiting for cron)
  PERFORM public.match_pending_alerts();

  -- Alert should be MATCHED_AUTO with the right agent
  DECLARE
    v_status TEXT; v_matched UUID; v_via TEXT;
  BEGIN
    SELECT status::text, matched_agent_id, matched_via
      INTO v_status, v_matched, v_via
      FROM public.arrival_alerts WHERE id=v_alert;
    ASSERT v_status = 'MATCHED_AUTO', format('status=%s, want MATCHED_AUTO', v_status);
    ASSERT v_matched = v_agent, 'matched_agent_id wrong';
    ASSERT v_via = 'AUTO_MAPPING', format('matched_via=%s', v_via);
  END;

  -- Exactly one pgmq row enqueued for this alert
  SELECT COUNT(*) INTO v_queued
    FROM pgmq.q_proforma_queue
   WHERE message->>'arrival_alert_id' = v_alert::text;
  ASSERT v_queued = 1, format('proforma_queue has %s msgs for alert, want 1', v_queued);
END $$;

ROLLBACK;
