-- End-to-end: simulates a full pro-forma row round-trip.
-- Verifies that transactions + arrival_alerts + shipowners + emission_factors
-- can be written together with all FKs satisfied.

BEGIN;

-- Disable RLS via service_role context (psql as postgres is superuser, RLS does not apply).
DO $$
DECLARE
  v_vessel UUID;
  v_owner UUID;
  v_agent UUID;
  v_alert UUID;
  v_factor UUID;
  v_txn UUID;
BEGIN
  -- Vessel (all NOT NULL columns required; see mig 003)
  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status
  ) VALUES ('999000099', '9999099', 'MV INTEGRATION TEST', 'TEST1', 'SO', 'CARGO',
            50000, 20000, 14.0, 'APPROACHING')
  RETURNING id INTO v_vessel;

  -- Shipowner (ghost)
  INSERT INTO public.shipowners (name, account_state)
  VALUES ('Integration Test Owner', 'GHOST')
  RETURNING id INTO v_owner;

  UPDATE public.vessels SET shipowner_id = v_owner WHERE id = v_vessel;

  -- Agent profile (use seeded demo shipping agent; profiles.id FK → auth.users)
  SELECT id INTO v_agent FROM public.profiles WHERE role='SHIPPING_AGENT' LIMIT 1;
  IF v_agent IS NULL THEN
    SELECT id INTO v_agent FROM public.profiles LIMIT 1;
  END IF;
  ASSERT v_agent IS NOT NULL,
    'integration test needs seeded profiles; run supabase db reset first';

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id)
  VALUES (v_owner, v_agent);

  -- Alert
  INSERT INTO public.arrival_alerts
    (vessel_id, imo_number, detected_lat, detected_lng, distance_to_port_nm,
     estimated_route_nm, status, matched_agent_id, matched_via)
  VALUES
    (v_vessel, '9999099', 11.0, 46.0, 480, 140, 'MATCHED_AUTO', v_agent, 'AUTO_MAPPING')
  RETURNING id INTO v_alert;

  -- Emission factor (cascade pick)
  SELECT id INTO v_factor
    FROM public.emission_factors
   WHERE source='IMO_CATEGORY' AND vessel_category='CARGO'
     AND 10000 BETWEEN gt_min AND gt_max
   LIMIT 1;
  ASSERT v_factor IS NOT NULL, 'CARGO IMO_CATEGORY factor seed not found';

  -- Pro-forma transaction
  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, transaction_type, emissions_tco2, tax_amount_usd,
     status, document_type, arrival_alert_id, agent_profile_id, shipowner_id,
     distance_eez_nm, emission_factor_used_id, rate_usd_per_tco2, breakdown_json)
  VALUES
    (v_vessel, 'MV INTEGRATION TEST', '9999099', 'ENTRY_TAX', 13.3, 532.00,
     'PENDING', 'PROFORMA', v_alert, v_agent, v_owner,
     140, v_factor, 40.00,
     jsonb_build_object('distance_nm',140,'factor_g',95000,'factor_source','IMO_CATEGORY','rate',40))
  RETURNING id INTO v_txn;

  -- Link alert back
  UPDATE public.arrival_alerts
     SET status='PROFORMA_SENT', proforma_transaction_id = v_txn
   WHERE id = v_alert;

  -- Send a pgmq message
  PERFORM pgmq.send('proforma_queue', jsonb_build_object('arrival_alert_id', v_alert));

  -- Everything round-tripped cleanly
  ASSERT (SELECT status FROM public.arrival_alerts WHERE id=v_alert) = 'PROFORMA_SENT';
  ASSERT (SELECT document_type FROM public.transactions WHERE id=v_txn) = 'PROFORMA';
  ASSERT (SELECT COUNT(*) FROM pgmq.q_proforma_queue) >= 1;

  RAISE NOTICE 'Foundation integration test: all assertions passed';
END $$;

ROLLBACK;
