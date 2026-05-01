BEGIN;

-- Setup: a shipowner + vessel + a transaction
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Owner');
INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category,
  gross_tonnage_dwt, engine_power_kw, design_speed_knots, shipowner_id)
  VALUES (
    'cccccccc-0000-0000-0000-000000000001',
    '1234567',
    '987654321',
    'Test Vessel',
    'TEST',
    'LR',
    'CONTAINER',
    10000,
    5000,
    20.0,
    'aaaaaaaa-0000-0000-0000-000000000001'
  ) ON CONFLICT DO NOTHING;
INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, shipowner_id,
  document_type, transaction_type, emissions_tco2, tax_amount_usd, status)
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001',
    'Test Vessel',
    '1234567',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX', 250.0, 10000.00, 'PENDING'
  ) ON CONFLICT DO NOTHING;

-- 1. Happy path: USD STRIPE INITIATED
DO $$
BEGIN
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          500000, 'USD', 500000, 'STRIPE', 'INITIATED');
END $$;

-- 2. Reject: currency=USD with fx_rate set
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, fx_rate, fx_rate_source, fx_rate_locked_at, rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            500000, 'USD', 500000, 1.0, 'ECB', NOW(), 'STRIPE');
    RAISE EXCEPTION 'TEST FAILED: USD with fx_rate accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 3. Reject: currency=EUR without fx_rate
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            500000, 'EUR', 540000, 'WIRE_TRANSFER');
    RAISE EXCEPTION 'TEST FAILED: EUR without fx_rate accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 4. Reject: status=CONFIRMED without confirmed_by/confirmed_at
DO $$
DECLARE pid UUID;
BEGIN
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          100, 'USD', 100, 'WIRE_TRANSFER', 'INITIATED')
  RETURNING id INTO pid;

  BEGIN
    UPDATE public.payments SET status = 'CONFIRMED' WHERE id = pid;
    RAISE EXCEPTION 'TEST FAILED: CONFIRMED without confirmed_by accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 5. Reject: rail=STRIPE status=CONFIRMED without external_reference
DO $$
DECLARE pid UUID; admin_id UUID;
BEGIN
  -- Get any profile to act as admin
  SELECT id INTO admin_id FROM public.profiles LIMIT 1;
  IF admin_id IS NULL THEN
    -- Skip: no profiles seeded
    RETURN;
  END IF;

  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          100, 'USD', 100, 'STRIPE', 'INITIATED')
  RETURNING id INTO pid;

  BEGIN
    UPDATE public.payments SET status='CONFIRMED', confirmed_by=admin_id, confirmed_at=NOW()
      WHERE id = pid;
    RAISE EXCEPTION 'TEST FAILED: STRIPE CONFIRMED without external_reference accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 6. Multi-currency happy path: EUR with fx_rate
DO $$
BEGIN
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, fx_rate, fx_rate_source, fx_rate_locked_at, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          500000, 'EUR', 540000, 1.08, 'OPENEXCHANGERATES', NOW(),
          'WIRE_TRANSFER', 'INITIATED');
END $$;

-- 7. amount_minor = 0 rejected
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            0, 'USD', 0, 'WIRE_TRANSFER');
    RAISE EXCEPTION 'TEST FAILED: amount_minor=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 8. All 10 rails inserted (smoke)
DO $$
DECLARE r public.payment_rail;
BEGIN
  FOREACH r IN ARRAY ARRAY['STRIPE','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT',
                           'NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET']::public.payment_rail[]
  LOOP
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, rail, status)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            100, 'USD', 100, r, 'INITIATED');
  END LOOP;
END $$;

ROLLBACK;
SELECT '048 payments polymorphic: PASS' AS test_result;
