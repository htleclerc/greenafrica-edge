BEGIN;

-- Cron jobs present
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname='unclaimed-escalation'),
    'cron job unclaimed-escalation missing';
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname='unpaid-escalation'),
    'cron job unpaid-escalation missing';
END $$;

-- fn_escalate_unclaimed and fn_stage_unpaid_owner_escalation exist
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='fn_escalate_unclaimed'),
    'fn_escalate_unclaimed missing';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='fn_stage_unpaid_owner_escalation'),
    'fn_stage_unpaid_owner_escalation missing';
END $$;

-- Functional: unclaimed alert older than claim_sla_hours + within ETA buffer
-- must transition to ESCALATED.
DO $$
DECLARE v_vessel UUID; v_alert UUID;
BEGIN
  INSERT INTO public.vessels (mmsi, imo_number, name, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    compliance_status)
  VALUES ('999820001','TEST-ESC','MV ESC','TE01','SO','CARGO',
          50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts (
    vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
    estimated_eta, status, detected_at
  ) VALUES (v_vessel, 'TEST-ESC', 11, 46, 400,
            NOW() + INTERVAL '12 hours', -- within buffer
            'UNCLAIMED',
            NOW() - INTERVAL '48 hours' -- older than default claim_sla_hours=24
  ) RETURNING id INTO v_alert;

  PERFORM public.fn_escalate_unclaimed();

  DECLARE v_status TEXT;
  BEGIN
    SELECT status::text INTO v_status FROM public.arrival_alerts WHERE id=v_alert;
    ASSERT v_status='ESCALATED', format('status=%s, want ESCALATED', v_status);
  END;
END $$;

-- Functional: PROFORMA transaction arrived 8 days ago should get
-- owner_escalation_due_at staged.
DO $$
DECLARE v_vessel UUID; v_alert UUID; v_txn UUID; v_due TIMESTAMPTZ;
BEGIN
  INSERT INTO public.vessels (mmsi, imo_number, name, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    compliance_status)
  VALUES ('999830001','TEST-UNPAID','MV UNPAID','TU01','SO','CARGO',
          50000,20000,14.0,'APPROACHING')
  RETURNING id INTO v_vessel;

  INSERT INTO public.arrival_alerts (
    vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
    status, arrived_at
  ) VALUES (v_vessel, 'TEST-UNPAID', 11, 46, 0, 'ARRIVED',
            NOW() - INTERVAL '8 days')
  RETURNING id INTO v_alert;

  INSERT INTO public.transactions (
    vessel_id, vessel_name, vessel_imo, transaction_type,
    emissions_tco2, tax_amount_usd, status, collections_status,
    document_type, arrival_alert_id
  ) VALUES (v_vessel, 'MV UNPAID', 'TEST-UNPAID', 'ENTRY_TAX',
            10, 400, 'PENDING', 'CURRENT', 'PROFORMA', v_alert)
  RETURNING id INTO v_txn;

  PERFORM public.fn_stage_unpaid_owner_escalation();

  SELECT owner_escalation_due_at INTO v_due
    FROM public.transactions WHERE id=v_txn;
  ASSERT v_due IS NOT NULL,
    'transactions.owner_escalation_due_at should be staged when >= delay_days old and unpaid';
END $$;

ROLLBACK;
