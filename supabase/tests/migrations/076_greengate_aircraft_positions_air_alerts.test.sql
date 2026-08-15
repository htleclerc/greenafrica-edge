-- Test 076: aircraft_positions + polymorphic arrival_alerts — structure + RLS + CHECK
BEGIN;

-- ── Part 1: structural ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.aircraft_positions') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: table public.aircraft_positions is missing';
  END IF;

  PERFORM 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='aircraft_positions'
      AND column_name IN ('aircraft_id','lat','lng','altitude_ft',
                          'ground_speed_kt','heading','in_fir','recorded_at')
    GROUP BY table_name HAVING count(*) = 8;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: aircraft_positions is missing one or more expected columns';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='arrival_alerts'
                    AND column_name='aircraft_id') THEN
    RAISE EXCEPTION 'TEST FAILED: arrival_alerts.aircraft_id column is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'arrival_alerts_asset_per_mode'
                    AND conrelid = 'public.arrival_alerts'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: arrival_alerts_asset_per_mode CHECK constraint is missing';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aircraft_positions'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: RLS not enabled on aircraft_positions';
  END IF;
END $$;

-- ── Part 2: behavioral — the mode-discriminated asset CHECK ───────────────────
-- An AIR alert with aircraft_id (and no vessel_id) must INSERT; an AIR alert with
-- a NULL aircraft_id must be rejected by the CHECK.
DO $$
DECLARE
  so_jid UUID := '00000000-0000-4000-8000-00000000534f';
  ac_id  UUID;
BEGIN
  -- Seed a Somaliland aircraft to satisfy the aircraft_id FK.
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('6O-AIR1', 'A320', so_jid) RETURNING id INTO ac_id;

  -- AIR alert with aircraft_id, no vessel_id → must SUCCEED.
  INSERT INTO public.arrival_alerts (aircraft_id, mode, detected_lat, detected_lng,
                                     status, jurisdiction_id)
    VALUES (ac_id, 'AIR', 9.52, 44.09, 'MATCHED_AUTO', so_jid);

  -- AIR alert with NULL aircraft_id → must RAISE (CHECK violation).
  BEGIN
    INSERT INTO public.arrival_alerts (aircraft_id, mode, detected_lat, detected_lng,
                                       status, jurisdiction_id)
      VALUES (NULL, 'AIR', 9.52, 44.09, 'MATCHED_AUTO', so_jid);
    RAISE EXCEPTION 'TEST FAILED: an AIR alert with NULL aircraft_id was accepted (CHECK not enforced)';
  EXCEPTION
    WHEN check_violation THEN
      NULL;  -- expected: the CHECK rejected it
  END;
END $$;

-- ── Part 3: icao24 UNIQUE arbiter — the upsert ON CONFLICT (icao24) target must
--           resolve (mig-074's PARTIAL index could not serve as an arbiter). Run the
--           same INSERT ... ON CONFLICT twice; the 2nd takes the conflict path and
--           must NOT raise. Exactly one row must remain. ──────────────────────────
DO $$
DECLARE
  so_jid UUID := '00000000-0000-4000-8000-00000000534f';
  n      INT;
BEGIN
  INSERT INTO public.aircraft (icao24, registration, jurisdiction_id)
    VALUES ('abc123','T1', so_jid)
    ON CONFLICT (icao24) DO UPDATE SET registration='T1b';
  -- 2nd insert: conflict path. If icao24 lacked a usable UNIQUE arbiter this RAISES 42P10.
  INSERT INTO public.aircraft (icao24, registration, jurisdiction_id)
    VALUES ('abc123','T1', so_jid)
    ON CONFLICT (icao24) DO UPDATE SET registration='T1b';

  SELECT count(*) INTO n FROM public.aircraft WHERE icao24='abc123';
  IF n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: expected exactly 1 aircraft with icao24=abc123, found %', n;
  END IF;
END $$;

-- ── Part 4: one OPEN air alert per aircraft — idx_alert_active_per_aircraft must
--           reject a 2nd OPEN (non-terminal) air alert for the same aircraft. ──────
DO $$
DECLARE
  so_jid UUID := '00000000-0000-4000-8000-00000000534f';
  ac_id  UUID;
BEGIN
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('6O-DUP1', 'A320', so_jid) RETURNING id INTO ac_id;

  -- First OPEN air alert → must SUCCEED.
  INSERT INTO public.arrival_alerts (aircraft_id, mode, detected_lat, detected_lng,
                                     status, jurisdiction_id)
    VALUES (ac_id, 'AIR', 9.52, 44.09, 'MATCHED_AUTO', so_jid);

  -- Second OPEN air alert for the SAME aircraft → must RAISE (unique index).
  BEGIN
    INSERT INTO public.arrival_alerts (aircraft_id, mode, detected_lat, detected_lng,
                                       status, jurisdiction_id)
      VALUES (ac_id, 'AIR', 9.60, 44.10, 'MATCHED_AUTO', so_jid);
    RAISE EXCEPTION 'TEST FAILED: a 2nd OPEN air alert for the same aircraft was accepted (dup-alert index missing)';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;  -- expected: idx_alert_active_per_aircraft rejected it
  END;
END $$;

-- ── Part 5: cross-tenant isolation on aircraft_positions — the SELECT policy
--           resolves jurisdiction via the aircraft join, so a Somaliland officer
--           must NOT see a position whose aircraft is in TST, but MUST see one in
--           Somaliland. Mirrors the mig-074 aircraft isolation test. ──────────────
DO $$
DECLARE
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
  tst_jid   UUID := '11111111-1111-4111-8111-111111111111';
  officer   UUID := '22222222-2222-4222-8222-222222222222';
  so_ac     UUID;
  tst_ac    UUID;
BEGIN
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST', 'Test Country', 'ACTIVE') ON CONFLICT (code) DO NOTHING;

  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('6O-POS1', 'A320', so_jid) RETURNING id INTO so_ac;
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('TST-POS1', 'A320', tst_jid) RETURNING id INTO tst_ac;

  INSERT INTO public.aircraft_positions (aircraft_id, lat, lng, in_fir)
    VALUES (so_ac, 9.52, 44.09, true);
  INSERT INTO public.aircraft_positions (aircraft_id, lat, lng, in_fir)
    VALUES (tst_ac, 1.00, 1.00, false);

  -- Rôle staff posé via raw_app_meta_data (canal serveur, mig 120) : l'INSERT
  -- profiles qui suit est un no-op (ON CONFLICT DO NOTHING sur la ligne déjà
  -- créée par on_auth_user_created), donc le repli du trigger — SHIPOWNER
  -- depuis la mig 120 — s'appliquerait sans cette métadonnée.
  INSERT INTO auth.users (id, email, raw_app_meta_data)
    VALUES (officer, 'officer@air-pos-isolation.test', jsonb_build_object('role', 'PORT_OFFICER'))
    ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (officer, 'officer@air-pos-isolation.test', 'Pos Officer', 'PORT_OFFICER', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
    VALUES (officer, so_jid) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', officer::text)::text, true);
  SET LOCAL ROLE authenticated;

  IF EXISTS (SELECT 1 FROM public.aircraft_positions WHERE aircraft_id = tst_ac) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer can see a TST-jurisdiction aircraft_positions row (cross-tenant leak)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.aircraft_positions WHERE aircraft_id = so_ac) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer cannot see their own-jurisdiction aircraft_positions row';
  END IF;

  RESET ROLE;
END $$;

ROLLBACK;
SELECT '076 GreenGate aircraft positions + air alerts: PASS' AS test_result;
