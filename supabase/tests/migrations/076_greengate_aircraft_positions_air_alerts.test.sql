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

ROLLBACK;
SELECT '076 GreenGate aircraft positions + air alerts: PASS' AS test_result;
