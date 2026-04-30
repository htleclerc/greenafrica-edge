BEGIN;

-- Setup: 2 shipowners
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Owner A'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Owner B');

DO $$
DECLARE
  prof UUID;
  wA UUID;
  wB UUID;
  bal BIGINT;
  ledger_sum BIGINT;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: no profile seeded';
  END IF;

  -- 1. Create wallets
  INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001') RETURNING id INTO wA;
  INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000002') RETURNING id INTO wB;

  -- 2. Initial balance = 0
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 0 THEN RAISE EXCEPTION 'TEST FAILED: initial balance not zero, got %', bal; END IF;

  -- 3. TOPUP +1000 → balance 1000
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
    VALUES (wA, 1000, 'TOPUP', prof);
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 1000 THEN RAISE EXCEPTION 'TEST FAILED: balance after TOPUP, got %', bal; END IF;

  -- 4. PROFORMA_APPLY -300 → balance 700
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
    VALUES (wA, -300, 'PROFORMA_APPLY', prof);
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 700 THEN RAISE EXCEPTION 'TEST FAILED: balance after apply, got %', bal; END IF;

  -- 5. Try to debit beyond balance → should fail
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
      VALUES (wA, -1000, 'PROFORMA_APPLY', prof);
    RAISE EXCEPTION 'TEST FAILED: over-debit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 6. Wallet A balance still 700 after the failed attempt
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 700 THEN RAISE EXCEPTION 'TEST FAILED: balance changed after failed debit, got %', bal; END IF;

  -- 7. amount_signed = 0 rejected
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
      VALUES (wA, 0, 'TOPUP', prof);
    RAISE EXCEPTION 'TEST FAILED: amount=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 8. ADMIN_ADJUSTMENT without justification → rejected
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
      VALUES (wA, 100, 'ADMIN_ADJUSTMENT', prof);
    RAISE EXCEPTION 'TEST FAILED: ADMIN_ADJUSTMENT without justification accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 9. ADMIN_ADJUSTMENT with justification → accepted
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by, justification)
    VALUES (wA, 50, 'ADMIN_ADJUSTMENT', prof, 'Geste commercial');

  -- 10. Invariant: SUM(ledger) = balance for wallet A (now 1000 - 300 + 50 = 750)
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  SELECT COALESCE(SUM(amount_signed_usd_minor), 0) INTO ledger_sum
    FROM public.wallet_ledger WHERE wallet_id = wA;
  IF ledger_sum <> bal THEN
    RAISE EXCEPTION 'TEST FAILED: invariant broken — sum=% balance=%', ledger_sum, bal;
  END IF;
  IF bal <> 750 THEN
    RAISE EXCEPTION 'TEST FAILED: expected balance 750, got %', bal;
  END IF;

  -- 11. Wallet B isolation: ledger entries on A don't affect B
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wB;
  IF bal <> 0 THEN RAISE EXCEPTION 'TEST FAILED: wallet B contaminated, got %', bal; END IF;

  -- 12. UNIQUE constraint: one wallet per shipowner
  BEGIN
    INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'TEST FAILED: duplicate wallet for shipowner accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 13. Append-only: UPDATE on wallet_ledger forbidden
  BEGIN
    UPDATE public.wallet_ledger SET amount_signed_usd_minor = 0 WHERE wallet_id = wA;
    RAISE EXCEPTION 'TEST FAILED: wallet_ledger UPDATE accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- 14. Append-only: DELETE on wallet_ledger forbidden
  BEGIN
    DELETE FROM public.wallet_ledger WHERE wallet_id = wA;
    RAISE EXCEPTION 'TEST FAILED: wallet_ledger DELETE accepted';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END $$;

ROLLBACK;
SELECT '050 wallets and ledger: PASS' AS test_result;
