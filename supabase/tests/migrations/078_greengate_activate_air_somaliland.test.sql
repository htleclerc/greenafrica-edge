-- Test 078: activating AIR for Somaliland flips the mig-071 row enabled=TRUE +
-- sets geofence_ref/activated_at, while MARITIME stays enabled (no regression).
BEGIN;

DO $$
DECLARE
  so_jid UUID := '00000000-0000-4000-8000-00000000534f';
  air_enabled   BOOLEAN;
  air_geofence  TEXT;
  air_activated TIMESTAMPTZ;
  mar_enabled   BOOLEAN;
BEGIN
  SELECT enabled, geofence_ref, activated_at
    INTO air_enabled, air_geofence, air_activated
    FROM public.jurisdiction_mode_config
   WHERE jurisdiction_id = so_jid AND mode = 'AIR';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland AIR jurisdiction_mode_config row is missing';
  END IF;
  IF air_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland AIR is not enabled (enabled=%)', air_enabled;
  END IF;
  IF air_geofence IS DISTINCT FROM 'somaliland-fir' THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland AIR geofence_ref=% (want somaliland-fir)', air_geofence;
  END IF;
  IF air_activated IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland AIR activated_at is NULL';
  END IF;

  -- MARITIME must remain enabled (mig 071 turned it on; 078 must not touch it).
  SELECT enabled INTO mar_enabled
    FROM public.jurisdiction_mode_config
   WHERE jurisdiction_id = so_jid AND mode = 'MARITIME';
  IF mar_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland MARITIME is no longer enabled (enabled=%)', mar_enabled;
  END IF;
END $$;

ROLLBACK;
SELECT '078 GreenGate activate AIR (Somaliland): PASS' AS test_result;
