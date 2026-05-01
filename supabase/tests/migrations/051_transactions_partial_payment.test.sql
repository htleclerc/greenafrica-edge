BEGIN;

-- Setup: shipowner + vessel (required NOT NULL for transactions) + transaction with tax_amount_usd = 10.00 dollars
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'PartialOwner');

INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots)
VALUES ('dddddddd-0000-0000-0000-000000000001', '9999991', '999999991', 'Partial Vessel', 'TPRT', 'SO', 'CONTAINER', 5000, 1000, 12.5);

-- transaction tax_amount_usd = 10.00 dollars → due_usd_minor (in view) = 1000 cents
-- collections_status starts as CURRENT
INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, shipowner_id, document_type, transaction_type, emissions_tco2, tax_amount_usd, status, collections_status)
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'Partial Vessel', '9999991',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX', 100.00, 10.00, 'PENDING', 'CURRENT'
  );

DO $$
DECLARE
  prof UUID;
  ts TEXT;
  p1 UUID;
  paid BIGINT;
  remaining BIGINT;
  due_v BIGINT;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: no profile seeded';
  END IF;

  -- 0. Verify view returns due=1000 cents (10.00 dollars * 100)
  SELECT due_usd_minor INTO due_v FROM public.transaction_paid_summary
    WHERE transaction_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF due_v <> 1000 THEN
    RAISE EXCEPTION 'TEST FAILED: view due_usd_minor expected 1000, got %', due_v;
  END IF;

  -- 1. INITIATED payment doesn't change transaction status
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          400, 'USD', 400, 'WIRE_TRANSFER', 'INITIATED')
  RETURNING id INTO p1;

  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PENDING' THEN
    RAISE EXCEPTION 'TEST FAILED: status changed on INITIATED, got %', ts;
  END IF;

  -- 2. CONFIRM partial → PARTIALLY_PAID (400 of 1000)
  UPDATE public.payments SET status='CONFIRMED', confirmed_by=prof, confirmed_at=NOW()
    WHERE id = p1;
  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: status not PARTIALLY_PAID after partial confirm, got %', ts;
  END IF;

  -- 3. CONFIRM second payment that completes (600 cents brings 400+600=1000) → PAID
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          600, 'USD', 600, 'WIRE_TRANSFER', 'CONFIRMED', prof, NOW());

  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: status not PAID after full confirm, got %', ts;
  END IF;

  -- Verify collections_status also transitioned to PAID to maintain invariant
  SELECT collections_status INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: collections_status not PAID after full confirm, got %', ts;
  END IF;

  -- 4. View final state matches: paid=1000, remaining=0
  SELECT paid_usd_minor, remaining_usd_minor INTO paid, remaining
    FROM public.transaction_paid_summary
    WHERE transaction_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF paid <> 1000 OR remaining <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: view mismatch paid=% remaining=%', paid, remaining;
  END IF;

  -- 5. Reject of one payment → recompute → PARTIALLY_PAID again (only 600 confirmed)
  UPDATE public.payments SET status='REJECTED', rejected_reason='test'
    WHERE id = p1;
  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: status after reject of partial, got %', ts;
  END IF;
END $$;

ROLLBACK;
SELECT '051 partial payment: PASS' AS test_result;
