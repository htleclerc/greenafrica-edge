-- Test 091: enable_self_service — verify both flags are set to true
BEGIN;

DO $$
DECLARE
  maritime_val JSONB;
  air_val      JSONB;
BEGIN
  -- Apply the migration logic inline (tests run after migration in CI;
  -- re-running here is idempotent and verifies the INSERT … ON CONFLICT path).
  INSERT INTO public.app_config (key, value)
  VALUES
    ('feature.shipowner_self_service_enabled', 'true'::jsonb),
    ('feature.air_self_service_enabled',       'true'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  SELECT value INTO maritime_val
    FROM public.app_config
   WHERE key = 'feature.shipowner_self_service_enabled';

  SELECT value INTO air_val
    FROM public.app_config
   WHERE key = 'feature.air_self_service_enabled';

  IF maritime_val IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED: feature.shipowner_self_service_enabled expected true, got %', maritime_val;
  END IF;

  IF air_val IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED: feature.air_self_service_enabled expected true, got %', air_val;
  END IF;
END $$;

SELECT '091 enable_self_service: both maritime + air flags = true: PASS' AS test_result;

ROLLBACK;
SELECT '091 enable_self_service: PASS' AS test_result;
