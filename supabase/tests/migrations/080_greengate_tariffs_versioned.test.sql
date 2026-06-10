-- Test 080: GreenGate v8 Wedge 2 — versioned tariffs table
BEGIN;

-- 1. Seeds: exactly 2 ACTIVE Somaliland tariff rows (MARITIME + AIR),
--    effective_to NULL, currency USD, rate_per_tco2 > 0.
--    Also asserts value-identical cutover: seeded rates must match the live app_config values.
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND status = 'ACTIVE'
     AND effective_to IS NULL
     AND currency = 'USD'
     AND rate_per_tco2 > 0
     AND mode IN ('MARITIME', 'AIR');
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: expected 2 ACTIVE Somaliland seeds (MARITIME+AIR), got %', cnt;
  END IF;
  -- Verify one per mode
  PERFORM 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND mode = 'MARITIME' AND status = 'ACTIVE' AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: MARITIME seed row missing';
  END IF;
  PERFORM 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND mode = 'AIR' AND status = 'ACTIVE' AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: AIR seed row missing';
  END IF;
  -- Value-identity assertions: seeded rates must equal the app_config source values
  PERFORM 1 FROM public.tariffs t
   WHERE t.jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND t.mode = 'MARITIME'
     AND t.status = 'ACTIVE'
     AND t.rate_per_tco2 = (SELECT (value #>> '{}')::numeric FROM public.app_config WHERE key = 'carbon_tax.rate_usd_per_tco2');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: MARITIME seeded rate does not match app_config carbon_tax.rate_usd_per_tco2';
  END IF;
  PERFORM 1 FROM public.tariffs t
   WHERE t.jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND t.mode = 'AIR'
     AND t.status = 'ACTIVE'
     AND t.rate_per_tco2 = (SELECT (value #>> '{}')::numeric FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: AIR seeded rate does not match app_config carbon_tax.air_rate_usd_per_tco2';
  END IF;
END $$;

-- 2. Exclusion constraint rejects an overlapping ACTIVE window for the same key.
--    Insert MARITIME NULL-category ACTIVE at CURRENT_DATE → expect exclusion_violation.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tariffs
      (jurisdiction_id, mode, asset_category, zone, rate_per_tco2, currency,
       effective_from, effective_to, status)
    VALUES
      ('00000000-0000-4000-8000-00000000534f', 'MARITIME', NULL, NULL, 50, 'USD',
       CURRENT_DATE, NULL, 'ACTIVE');
    RAISE EXCEPTION 'TEST FAILED: expected exclusion_violation but insert succeeded';
  EXCEPTION
    WHEN exclusion_violation THEN
      -- expected
  END;
END $$;

-- 2b. A DRAFT row overlapping the same ACTIVE window IS accepted (exclusion only applies to ACTIVE).
--     Flipping that DRAFT row to ACTIVE must raise exclusion_violation.
DO $$
DECLARE draft_id UUID;
BEGIN
  -- Insert a DRAFT overlapping the seeded MARITIME ACTIVE window — must succeed
  INSERT INTO public.tariffs
    (jurisdiction_id, mode, asset_category, zone, rate_per_tco2, currency,
     effective_from, effective_to, status)
  VALUES
    ('00000000-0000-4000-8000-00000000534f', 'MARITIME', NULL, NULL, 50, 'USD',
     CURRENT_DATE, NULL, 'DRAFT')
  RETURNING id INTO draft_id;
  IF draft_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: DRAFT overlapping row should be accepted but insert failed';
  END IF;
  -- Flipping it to ACTIVE must raise exclusion_violation
  BEGIN
    UPDATE public.tariffs SET status = 'ACTIVE' WHERE id = draft_id;
    RAISE EXCEPTION 'TEST FAILED: expected exclusion_violation when promoting DRAFT→ACTIVE but update succeeded';
  EXCEPTION
    WHEN exclusion_violation THEN
      -- expected
  END;
  DELETE FROM public.tariffs WHERE id = draft_id;
END $$;

-- 3. A category-SPECIFIC row ('TANKER') in the same window IS allowed (different key).
--    Insert then delete — no exception expected.
DO $$
DECLARE tid UUID;
BEGIN
  INSERT INTO public.tariffs
    (jurisdiction_id, mode, asset_category, zone, rate_per_tco2, currency,
     effective_from, effective_to, status)
  VALUES
    ('00000000-0000-4000-8000-00000000534f', 'MARITIME', 'TANKER', NULL, 55, 'USD',
     CURRENT_DATE, NULL, 'ACTIVE')
  RETURNING id INTO tid;
  DELETE FROM public.tariffs WHERE id = tid;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED: TANKER-specific row should not conflict: %', SQLERRM;
END $$;

-- 4. Versioning: closing the current AIR row (set effective_to = CURRENT_DATE + 30)
--    allows inserting a successor starting CURRENT_DATE + 30.
DO $$
DECLARE air_id UUID; new_id UUID;
BEGIN
  SELECT id INTO air_id
    FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND mode = 'AIR' AND status = 'ACTIVE' AND effective_to IS NULL;
  IF air_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: AIR seed row not found for versioning test';
  END IF;
  -- Close the current version (allowed: setting effective_to on ACTIVE row)
  UPDATE public.tariffs SET effective_to = CURRENT_DATE + 30 WHERE id = air_id;
  -- Insert a successor (starts where the old one ends — no overlap)
  INSERT INTO public.tariffs
    (jurisdiction_id, mode, rate_per_tco2, currency,
     effective_from, effective_to, status, decree_ref)
  VALUES
    ('00000000-0000-4000-8000-00000000534f', 'AIR', 45, 'USD',
     CURRENT_DATE + 30, NULL, 'ACTIVE', 'MOE&CC/mi/37/2026')
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: successor AIR row not inserted';
  END IF;
  -- Cleanup (ROLLBACK will handle it, but undo for cleanliness within the block)
  DELETE FROM public.tariffs WHERE id = new_id;
  UPDATE public.tariffs SET effective_to = NULL WHERE id = air_id;
END $$;

-- 5. transactions.tariff_id column exists and is a nullable UUID FK to tariffs.
DO $$
DECLARE col_type TEXT; col_nullable TEXT;
BEGIN
  SELECT c.data_type, c.is_nullable
    INTO col_type, col_nullable
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'transactions'
     AND c.column_name = 'tariff_id';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.tariff_id column missing';
  END IF;
  IF col_type <> 'uuid' THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.tariff_id should be uuid, got %', col_type;
  END IF;
  IF col_nullable <> 'YES' THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.tariff_id should be nullable, got %', col_nullable;
  END IF;
END $$;

-- 6. CHECK rejects rate_per_tco2 = 0 (check_violation).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tariffs
      (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status)
    VALUES
      ('00000000-0000-4000-8000-00000000534f', 'MARITIME', 0, 'USD',
       CURRENT_DATE - 365, 'DRAFT');
    RAISE EXCEPTION 'TEST FAILED: expected check_violation for rate_per_tco2=0 but insert succeeded';
  EXCEPTION
    WHEN check_violation THEN
      -- expected
  END;
END $$;

ROLLBACK;
SELECT '080 versioned tariffs: PASS' AS test_result;
