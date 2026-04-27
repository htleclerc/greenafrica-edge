BEGIN;

-- 1. The match_pending_alerts function source contains the ORIGINPORT skip clause
DO $$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc WHERE proname='match_pending_alerts';
  ASSERT src IS NOT NULL, 'match_pending_alerts function missing';
  ASSERT src LIKE '%ORIGINPORT%',
    'match_pending_alerts should reference ORIGINPORT to skip it';
  ASSERT src LIKE '%detection_source%',
    'match_pending_alerts should reference detection_source';
END $$;

-- 2. Behaviour: a DETECTED ORIGINPORT alert is NOT promoted to MATCHED_AUTO
--    even when an owner_agent_mappings row would match — it stays DETECTED
--    because the cursor WHERE clause skips it entirely.
DO $$
DECLARE
  vid uuid; oid uuid; aid uuid; alert_id uuid; new_status text;
BEGIN
  -- minimal fixture — reuse a seeded SHIPPING_AGENT profile (avoids auth.users FK)
  SELECT id INTO aid FROM public.profiles WHERE role = 'SHIPPING_AGENT' LIMIT 1;
  ASSERT aid IS NOT NULL,
    'test needs a seeded SHIPPING_AGENT profile; run supabase db reset first';

  INSERT INTO public.shipowners (id, name, country_code)
       VALUES (gen_random_uuid(), 'Test Owner 046', 'SO')
       RETURNING id INTO oid;

  INSERT INTO public.vessels
        (mmsi, imo_number, name, call_sign, flag_code, category,
         gross_tonnage_dwt, engine_power_kw, design_speed_knots,
         compliance_status, shipowner_id)
       VALUES ('999046001','TEST-046','MV 046','TC46','SO','CARGO',
               50000,20000,14.0,'APPROACHING', oid)
       RETURNING id INTO vid;

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id, active)
       VALUES (oid, aid, true);

  -- Insert as DETECTED (not UNCLAIMED) so the guard is actually exercised:
  -- without the ORIGINPORT filter the function would promote this to MATCHED_AUTO.
  INSERT INTO public.arrival_alerts
        (vessel_id, imo_number, status, detection_source)
       VALUES (vid, 'TEST-046', 'DETECTED', 'ORIGINPORT')
       RETURNING id INTO alert_id;

  -- Run the cron function
  PERFORM public.match_pending_alerts();

  -- The ORIGINPORT guard causes the cursor to skip this row entirely,
  -- so the alert remains DETECTED (not MATCHED_AUTO, not UNCLAIMED).
  SELECT status::text INTO new_status FROM public.arrival_alerts WHERE id=alert_id;
  ASSERT new_status = 'DETECTED',
    format('expected DETECTED (guard skipped row), got %s', new_status);
END $$;

ROLLBACK;
