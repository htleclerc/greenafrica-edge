BEGIN;

-- Setup
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'RefundOwner');

INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots)
VALUES ('dddddddd-0000-0000-0000-000000000001', '9999992', '999999992', 'Refund Vessel', 'TRFD', 'SO', 'CONTAINER', 5000, 1000, 12.5);

INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, shipowner_id, document_type, transaction_type, emissions_tco2, tax_amount_usd, status)
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'Refund Vessel', '9999992',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'REFUND', 'ENTRY_TAX', 100.00, 5.00, 'PENDING'
  );

DO $$
DECLARE
  prof UUID;
  rid UUID;
  wid UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: no profile seeded';
  END IF;

  -- 1. Happy path: REQUESTED
  INSERT INTO public.refunds (transaction_id, shipowner_id, amount_usd_minor, refund_rail, requested_by)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          500, 'WALLET', prof)
  RETURNING id INTO rid;

  -- 2. amount_usd_minor <= 0 rejected
  BEGIN
    INSERT INTO public.refunds (transaction_id, shipowner_id, amount_usd_minor, refund_rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            0, 'WALLET');
    RAISE EXCEPTION 'TEST FAILED: amount=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 3. APPROVED needs approved_by
  BEGIN
    UPDATE public.refunds SET status='APPROVED' WHERE id = rid;
    RAISE EXCEPTION 'TEST FAILED: APPROVED without approved_by accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. APPROVED with approved_by
  UPDATE public.refunds SET status='APPROVED', approved_by=prof WHERE id = rid;

  -- 5. EXECUTED needs executed_by + executed_at
  BEGIN
    UPDATE public.refunds SET status='EXECUTED' WHERE id = rid;
    RAISE EXCEPTION 'TEST FAILED: EXECUTED without audit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  UPDATE public.refunds SET status='EXECUTED', executed_by=prof, executed_at=NOW() WHERE id = rid;

  -- 6. wallet_ledger.refund_id FK now valid
  INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001') RETURNING id INTO wid;
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, refund_id, created_by)
    VALUES (wid, 500, 'REFUND_CREDIT', rid, prof);

  -- 7. wallet_ledger.refund_id rejects bogus refund UUID (FK now exists)
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, refund_id, created_by)
      VALUES (wid, 100, 'REFUND_CREDIT', '00000000-0000-0000-0000-000000000000', prof);
    RAISE EXCEPTION 'TEST FAILED: bogus refund_id accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

ROLLBACK;
SELECT '052 refunds: PASS' AS test_result;
