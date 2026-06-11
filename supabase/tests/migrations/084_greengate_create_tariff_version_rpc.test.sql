-- Test 084: GreenGate v8 Wedge 2 — transactional tariff version creation RPC
BEGIN;

-- Use seeded profiles from the local harness (no INSERT needed — avoids auth.users FK).
-- FINANCE_ADMIN actor: 00000000-0000-0000-0000-000000000002
-- SHIPPING_AGENT actor: 00000000-0000-0000-0000-000000000003
-- The seeded profiles are is_active=false; temporarily activate them for RPC role checks.
-- The ROLLBACK at the end reverts all changes including these UPDATEs.
UPDATE public.profiles SET is_active = true
 WHERE id IN ('00000000-0000-0000-0000-000000000002',
              '00000000-0000-0000-0000-000000000003');

-- ── 1. Happy path ─────────────────────────────────────────────────────────────
-- Expects: new_id populated, closed_id = the existing MARITIME seed, old row now
-- closed at the new effective_from, new row ACTIVE + effective_to NULL.
-- Also verifies the immutability trigger does NOT block the close UPDATE
-- (setting effective_to on ACTIVE row is explicitly allowed).
DO $$
DECLARE
  v_new_id    UUID;
  v_closed_id UUID;
  v_old_id    UUID;
  v_eff_to    DATE;
  v_future    DATE := CURRENT_DATE + 30;
BEGIN
  SELECT id INTO v_old_id
    FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND mode = 'MARITIME' AND status = 'ACTIVE' AND effective_to IS NULL
     AND asset_category IS NULL;
  IF v_old_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: MARITIME seed row missing for happy-path test';
  END IF;

  SELECT t.new_id, t.closed_id INTO v_new_id, v_closed_id
    FROM public.create_tariff_version(
      '00000000-0000-4000-8000-00000000534f',
      'MARITIME',
      NULL,
      50,
      v_future,
      'DECREE-084-TEST',
      '00000000-0000-0000-0000-000000000002'
    ) t;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: new_id is NULL';
  END IF;
  IF v_closed_id IS DISTINCT FROM v_old_id THEN
    RAISE EXCEPTION 'TEST FAILED: closed_id % does not match expected %', v_closed_id, v_old_id;
  END IF;

  -- Old row is now closed at v_future
  SELECT effective_to INTO v_eff_to FROM public.tariffs WHERE id = v_old_id;
  IF v_eff_to IS DISTINCT FROM v_future THEN
    RAISE EXCEPTION 'TEST FAILED: old row effective_to should be % got %', v_future, v_eff_to;
  END IF;

  -- New row is ACTIVE and open
  PERFORM 1 FROM public.tariffs
   WHERE id = v_new_id AND status = 'ACTIVE' AND effective_to IS NULL
     AND rate_per_tco2 = 50 AND decree_ref = 'DECREE-084-TEST';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: new tariff row not found / wrong values';
  END IF;
END $$;

-- ── 2. Strictly-future enforced: effective_from = CURRENT_DATE → check_violation ─
DO $$
BEGIN
  BEGIN
    PERFORM public.create_tariff_version(
      '00000000-0000-4000-8000-00000000534f',
      'AIR',
      NULL,
      55,
      CURRENT_DATE,          -- same-day → must be rejected
      'DECREE-TODAY',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'TEST FAILED: expected check_violation for same-day effective_from but call succeeded';
  EXCEPTION
    WHEN check_violation THEN
      -- expected
    WHEN OTHERS THEN
      RAISE EXCEPTION 'TEST FAILED: unexpected error (expected check_violation): %', SQLERRM;
  END;
END $$;

-- ── 3. Forbidden: actor with role SHIPPING_AGENT → insufficient_privilege ──────
DO $$
BEGIN
  BEGIN
    PERFORM public.create_tariff_version(
      '00000000-0000-4000-8000-00000000534f',
      'AIR',
      NULL,
      55,
      CURRENT_DATE + 10,
      'DECREE-AGENT',
      '00000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'TEST FAILED: expected insufficient_privilege for SHIPPING_AGENT but call succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      -- expected
    WHEN OTHERS THEN
      RAISE EXCEPTION 'TEST FAILED: unexpected error (expected insufficient_privilege): %', SQLERRM;
  END;
END $$;

-- ── 4. Open-version-after guard: create a future version then try an earlier one ─
-- After test 1, the currently-open MARITIME row started at CURRENT_DATE + 30.
-- Try to create a version with effective_from = CURRENT_DATE + 29 (one day earlier).
-- Expected: exclusion_violation (or check_violation if +29 <= CURRENT_DATE, impossible here).
DO $$
DECLARE
  v_open_from DATE;
BEGIN
  SELECT effective_from INTO v_open_from
    FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND mode = 'MARITIME' AND status = 'ACTIVE' AND effective_to IS NULL
     AND asset_category IS NULL;
  IF v_open_from IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: no open MARITIME row found for guard test';
  END IF;

  BEGIN
    PERFORM public.create_tariff_version(
      '00000000-0000-4000-8000-00000000534f',
      'MARITIME',
      NULL,
      60,
      v_open_from - 1,  -- one day earlier than the open row
      'DECREE-EARLIER',
      '00000000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'TEST FAILED: expected exclusion_violation for earlier effective_from but call succeeded';
  EXCEPTION
    WHEN exclusion_violation THEN
      -- expected
    WHEN check_violation THEN
      -- acceptable: if v_open_from - 1 <= CURRENT_DATE, caught by strictly-future guard
    WHEN OTHERS THEN
      RAISE EXCEPTION 'TEST FAILED: unexpected error (expected exclusion_violation): %', SQLERRM;
  END;
END $$;

-- ── 5. Atomicity probe: after a failed call the open row is still open ───────────
DO $$
BEGIN
  PERFORM 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND mode = 'MARITIME' AND status = 'ACTIVE' AND effective_to IS NULL
     AND asset_category IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: atomicity violated — the open MARITIME row was closed by the failed test-4 call';
  END IF;
END $$;

-- ── 6. First-version case: no open row for category-specific TANKER/AIR ─────────
-- The seeded AIR row is the null-category one. TANKER-specific AIR has no open row.
-- closed_id should be NULL; insert must succeed.
DO $$
DECLARE
  v_new_id    UUID;
  v_closed_id UUID;
BEGIN
  SELECT t.new_id, t.closed_id INTO v_new_id, v_closed_id
    FROM public.create_tariff_version(
      '00000000-0000-4000-8000-00000000534f',
      'AIR',
      'TANKER',
      70,
      CURRENT_DATE + 7,
      'DECREE-TANKER-AIR',
      '00000000-0000-0000-0000-000000000002'
    ) t;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: first-version case: new_id is NULL';
  END IF;
  IF v_closed_id IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED: first-version case: closed_id should be NULL, got %', v_closed_id;
  END IF;
  PERFORM 1 FROM public.tariffs WHERE id = v_new_id AND asset_category = 'TANKER' AND mode = 'AIR';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: first-version TANKER/AIR row not found';
  END IF;
END $$;

ROLLBACK;
SELECT '084 create tariff version rpc: PASS' AS test_result;
