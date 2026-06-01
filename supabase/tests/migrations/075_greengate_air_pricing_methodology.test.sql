-- Test 075: air pricing + ICAO LTO methodology params
BEGIN;
DO $$
DECLARE
  v_slope     NUMERIC;
  v_intercept NUMERIC;
  v_air_rate  NUMERIC;
  v_mar_rate  NUMERIC;
BEGIN
  -- (a) MTOW fallback coefficients present + positive slope on the ICAO_LTO methodology
  SELECT (params->'mtow_fallback'->>'slope_kg_co2_per_kg_mtow')::numeric,
         (params->'mtow_fallback'->>'intercept_kg')::numeric
    INTO v_slope, v_intercept
    FROM public.methodologies WHERE mode = 'AIR' AND code = 'ICAO_LTO';
  IF v_slope IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: ICAO_LTO mtow_fallback slope not set';
  END IF;
  IF v_slope <= 0 THEN
    RAISE EXCEPTION 'TEST FAILED: mtow_fallback slope must be positive, got %', v_slope;
  END IF;

  -- (b) air rate seeded equal to the maritime rate
  SELECT value::text::numeric INTO v_air_rate FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2';
  SELECT value::text::numeric INTO v_mar_rate FROM public.app_config WHERE key = 'carbon_tax.rate_usd_per_tco2';
  IF v_air_rate IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: carbon_tax.air_rate_usd_per_tco2 not seeded';
  END IF;
  IF v_air_rate <> v_mar_rate THEN
    RAISE EXCEPTION 'TEST FAILED: air rate % != maritime rate %', v_air_rate, v_mar_rate;
  END IF;
END $$;
ROLLBACK;
SELECT '075 GreenGate air pricing + methodology params: PASS' AS test_result;
