BEGIN;

DO $$
DECLARE
  r NUMERIC; src TEXT; ts TIMESTAMPTZ;
BEGIN
  -- 1. Insert two rates for EUR
  INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source, fetched_at)
  VALUES ('USD','EUR', 0.92, 'OPENEXCHANGERATES', NOW() - INTERVAL '1 day');
  INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source, fetched_at)
  VALUES ('USD','EUR', 0.93, 'OPENEXCHANGERATES', NOW());

  -- 2. fx_rate_latest returns most recent
  SELECT rate, source, fetched_at INTO r, src, ts FROM public.fx_rate_latest('USD','EUR');
  IF r <> 0.93 THEN
    RAISE EXCEPTION 'TEST FAILED: fx_rate_latest returned wrong rate %', r;
  END IF;

  -- 3. rate <= 0 rejected
  BEGIN
    INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source) VALUES ('USD','GBP', 0, 'X');
    RAISE EXCEPTION 'TEST FAILED: rate=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. ccy length != 3 rejected
  BEGIN
    INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source) VALUES ('US','EUR', 1, 'X');
    RAISE EXCEPTION 'TEST FAILED: ccy length 2 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 5. allowed_currencies seeded
  PERFORM 1 FROM public.app_config WHERE key = 'fx.allowed_currencies';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: app_config fx.allowed_currencies not seeded';
  END IF;
END $$;

ROLLBACK;
SELECT '054 fx rates cache: PASS' AS test_result;
