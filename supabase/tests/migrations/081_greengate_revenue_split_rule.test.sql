-- Test 081: GreenGate v8 Wedge 2 — revenue_split_rule (D3)
BEGIN;

-- 1. Seed: Somaliland escrow row exists — 0/100, effective_to NULL, contract_ref ESCROW_PENDING_MINFIN.
DO $$
BEGIN
  PERFORM 1 FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND concessionaire_pct = 0
     AND sovereign_pct = 100
     AND effective_to IS NULL
     AND contract_ref = 'ESCROW_PENDING_MINFIN';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland escrow seed row not found (expected 0/100, effective_to NULL, contract_ref ESCROW_PENDING_MINFIN)';
  END IF;
END $$;

-- 2. CHECK rejects split that does not sum to 100 (e.g. 60 + 30 = 90).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.revenue_split_rule
      (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct,
       contract_ref, signature_hash, signed_by)
    VALUES
      ('00000000-0000-4000-8000-00000000534f', NOW() + INTERVAL '1 year', 60, 30,
       'BAD_SUM', 'PENDING', 'tester');
    RAISE EXCEPTION 'TEST FAILED: expected check_violation for 60+30 split but insert succeeded';
  EXCEPTION
    WHEN check_violation THEN
      -- expected
  END;
END $$;

-- 3. Exclusion constraint rejects a second NULL-effective_to row for the same jurisdiction
--    (overlapping open-ended window).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.revenue_split_rule
      (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct,
       contract_ref, signature_hash, signed_by)
    VALUES
      ('00000000-0000-4000-8000-00000000534f', NOW() + INTERVAL '1 year', 0, 100,
       'DUPLICATE_OPEN', 'PENDING', 'tester');
    RAISE EXCEPTION 'TEST FAILED: expected exclusion_violation for second open-ended row but insert succeeded';
  EXCEPTION
    WHEN exclusion_violation THEN
      -- expected
  END;
END $$;

-- 4. UPDATE of concessionaire_pct on the seed row must be rejected by the append-only trigger.
DO $$
DECLARE seed_id UUID;
BEGIN
  SELECT id INTO seed_id FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND effective_to IS NULL;
  BEGIN
    UPDATE public.revenue_split_rule
       SET concessionaire_pct = 10, sovereign_pct = 90
     WHERE id = seed_id;
    RAISE EXCEPTION 'TEST FAILED: expected append-only rejection for concessionaire_pct update but update succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL; -- expected
  END;
END $$;

-- 5. DELETE of the seed row must be rejected by the append-only trigger.
DO $$
DECLARE seed_id UUID;
BEGIN
  SELECT id INTO seed_id FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND effective_to IS NULL;
  BEGIN
    DELETE FROM public.revenue_split_rule WHERE id = seed_id;
    RAISE EXCEPTION 'TEST FAILED: expected append-only rejection for DELETE but delete succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL; -- expected
  END;
END $$;

-- 6. Versioning lifecycle:
--    a) Closing effective_to on the seed (NULL → NOW() + 30 days) must succeed.
--    b) INSERT of a successor row starting at that same timestamp must succeed.
--    c) A second UPDATE re-touching the now-CLOSED row's effective_to must be rejected
--       (OLD.effective_to is no longer NULL).
DO $$
DECLARE
  seed_id        UUID;
  close_ts       TIMESTAMPTZ;
  successor_id   UUID;
BEGIN
  SELECT id INTO seed_id FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND effective_to IS NULL;
  IF seed_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: seed row not found for versioning test';
  END IF;

  close_ts := NOW() + INTERVAL '30 days';

  -- a) Close the current rule — should be accepted
  UPDATE public.revenue_split_rule SET effective_to = close_ts WHERE id = seed_id;

  -- b) Insert the successor starting at close_ts — should succeed (no overlap)
  INSERT INTO public.revenue_split_rule
    (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct,
     contract_ref, signature_hash, signed_by)
  VALUES
    ('00000000-0000-4000-8000-00000000534f', close_ts, 15, 85,
     'MINFIN_AGREEMENT_2026', 'SIG_PLACEHOLDER', 'ministre_finances')
  RETURNING id INTO successor_id;
  IF successor_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: successor row not inserted after closing seed';
  END IF;

  -- c) Re-touch the now-CLOSED seed row effective_to — must be rejected
  BEGIN
    UPDATE public.revenue_split_rule SET effective_to = close_ts + INTERVAL '1 day'
     WHERE id = seed_id;
    RAISE EXCEPTION 'TEST FAILED: expected append-only rejection for re-touching a closed row but update succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL; -- expected
  END;
END $$;

-- 7. Cross-jurisdiction independence: inserting an open split rule for a second jurisdiction
--    while SO's open rule exists → must succeed (no cross-jurisdiction overlap).
DO $$
DECLARE zz_jur_id UUID; zz_rule_id UUID;
BEGIN
  INSERT INTO public.jurisdictions (code, name, status)
  VALUES ('ZZ', 'Test Z', 'ACTIVE')
  RETURNING id INTO zz_jur_id;

  INSERT INTO public.revenue_split_rule
    (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct,
     contract_ref, signature_hash, signed_by)
  VALUES
    (zz_jur_id, TIMESTAMPTZ '2026-03-31T00:00:00Z', 50, 50,
     'TEST_ZZ_CONTRACT', 'PENDING', 'tester')
  RETURNING id INTO zz_rule_id;

  IF zz_rule_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: cross-jurisdiction insert should succeed but returned NULL id';
  END IF;
END $$;

-- 8. effective_to <= effective_from is rejected by the CHECK constraint (check_violation).
DO $$
BEGIN
  BEGIN
    INSERT INTO public.revenue_split_rule
      (jurisdiction_id, effective_from, effective_to, concessionaire_pct, sovereign_pct,
       contract_ref, signature_hash, signed_by)
    VALUES
      ('00000000-0000-4000-8000-00000000534f',
       TIMESTAMPTZ '2026-03-31T00:00:00Z',
       TIMESTAMPTZ '2026-03-31T00:00:00Z',  -- equal: not > effective_from
       0, 100, 'BAD_RANGE', 'PENDING', 'tester');
    RAISE EXCEPTION 'TEST FAILED: expected check_violation for effective_to <= effective_from but insert succeeded';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- expected
  END;
END $$;

-- 9. Combined close+mutate UPDATE on an OPEN row → insufficient_privilege.
--    Attempting to set both effective_to AND change contract_ref in one UPDATE
--    must be rejected because contract_ref is immutable.
DO $$
DECLARE seed_id UUID;
BEGIN
  SELECT id INTO seed_id FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND effective_to IS NULL;
  BEGIN
    UPDATE public.revenue_split_rule
       SET effective_to = NOW() + INTERVAL '1 day',
           contract_ref = 'SNEAKY'
     WHERE id = seed_id;
    RAISE EXCEPTION 'TEST FAILED: expected append-only rejection for combined close+mutate but update succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL; -- expected
  END;
END $$;

ROLLBACK;
SELECT '081 revenue split rule: PASS' AS test_result;
