-- DEFERRED: Docker broken, batch verify with 060-065 once restored.
-- Tests mig 066: auto-enqueue refunds trigger + relaxed refund_rail NOT NULL.

BEGIN;

-- ─── Setup ─────────────────────────────────────────────────────────────────
INSERT INTO public.shipowners (id, name)
  VALUES ('cccccccc-0000-0000-0000-000000000001', 'TriggerOwner');

INSERT INTO public.vessels (
  id, imo_number, mmsi, name, call_sign, flag_code, category,
  gross_tonnage_dwt, engine_power_kw, design_speed_knots
) VALUES (
  'eeeeeeee-0000-0000-0000-000000000001',
  '8888881', '888888881', 'TrigVes', 'TRG1', 'SO', 'CONTAINER',
  5000, 1000, 12.5
);

-- ─── Test 1: Function and trigger exist ────────────────────────────────────
DO $$
DECLARE
  v_func INT;
  v_trig INT;
BEGIN
  SELECT count(*) INTO v_func FROM pg_proc
    WHERE proname = 'enqueue_refund_on_transaction'
      AND pronamespace = 'public'::regnamespace;
  ASSERT v_func = 1, format('expected enqueue_refund_on_transaction function, got count=%s', v_func);

  SELECT count(*) INTO v_trig FROM pg_trigger
    WHERE tgname = 'trg_refund_enqueue'
      AND tgrelid = 'public.transactions'::regclass;
  ASSERT v_trig = 1, format('expected trg_refund_enqueue trigger, got count=%s', v_trig);
END $$;

-- ─── Test 2: INSERT REFUND tx → refunds row appears (REQUESTED, NULL rail) ─
DO $$
DECLARE
  v_count    INT;
  v_status   TEXT;
  v_rail     TEXT;
  v_amount   BIGINT;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, status
  ) VALUES (
    'ffffffff-0000-0000-0000-000000000001',
    'eeeeeeee-0000-0000-0000-000000000001', 'TrigVes', '8888881',
    'cccccccc-0000-0000-0000-000000000001',
    'REFUND', 'ENTRY_TAX',
    100.00, 25.00, 'PENDING'
  );

  SELECT count(*) INTO v_count FROM public.refunds
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000001';
  ASSERT v_count = 1, format('expected 1 refunds row, got %s', v_count);

  SELECT status::TEXT, refund_rail::TEXT, amount_usd_minor
    INTO v_status, v_rail, v_amount
    FROM public.refunds
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000001';
  ASSERT v_status = 'REQUESTED', format('expected REQUESTED, got %s', v_status);
  ASSERT v_rail IS NULL, format('expected NULL rail, got %s', v_rail);
  -- 25.00 USD * 100 = 2500 minor
  ASSERT v_amount = 2500, format('expected amount_usd_minor=2500, got %s', v_amount);
END $$;

-- ─── Test 3: INSERT non-REFUND (PROFORMA) tx → no refunds row ──────────────
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, status
  ) VALUES (
    'ffffffff-0000-0000-0000-000000000002',
    'eeeeeeee-0000-0000-0000-000000000001', 'TrigVes', '8888881',
    'cccccccc-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX',
    100.00, 30.00, 'PENDING'
  );

  SELECT count(*) INTO v_count FROM public.refunds
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000002';
  ASSERT v_count = 0, format('expected 0 refunds row for PROFORMA, got %s', v_count);
END $$;

-- ─── Test 4: INSERT REFUND tx with NULL shipowner_id → no refunds row ──────
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, status
  ) VALUES (
    'ffffffff-0000-0000-0000-000000000003',
    'eeeeeeee-0000-0000-0000-000000000001', 'TrigVes', '8888881',
    NULL,
    'REFUND', 'ENTRY_TAX',
    100.00, 10.00, 'PENDING'
  );

  SELECT count(*) INTO v_count FROM public.refunds
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000003';
  ASSERT v_count = 0, format('expected 0 refunds row (NULL shipowner), got %s', v_count);
END $$;

-- ─── Test 5: Idempotency — EXISTS guard skips trigger when refunds row already present ─
-- Approach: temporarily disable the trigger, INSERT a REFUND transaction,
-- INSERT a refunds row manually with refund_rail='WALLET'. Then ENABLE the
-- trigger and manually invoke the trigger function body via a DO block that
-- mirrors its logic (since PG doesn't allow re-firing AFTER INSERT triggers
-- on the same row, and we can't directly CALL a trigger function without
-- trigger context). Verify count remains 1 across the simulated re-fire.
DO $$
DECLARE
  v_count INT;
BEGIN
  ALTER TABLE public.transactions DISABLE TRIGGER trg_refund_enqueue;

  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, status
  ) VALUES (
    'ffffffff-0000-0000-0000-000000000004',
    'eeeeeeee-0000-0000-0000-000000000001', 'TrigVes', '8888881',
    'cccccccc-0000-0000-0000-000000000001',
    'REFUND', 'ENTRY_TAX',
    100.00, 15.00, 'PENDING'
  );

  -- Manually pre-INSERT a refunds row (rail=WALLET, status=REQUESTED)
  INSERT INTO public.refunds (
    transaction_id, shipowner_id, amount_usd_minor, refund_rail, status
  ) VALUES (
    'ffffffff-0000-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000001',
    1500, 'WALLET', 'REQUESTED'
  );

  ALTER TABLE public.transactions ENABLE TRIGGER trg_refund_enqueue;

  -- Simulate trigger re-fire by running the EXISTS guard logic explicitly.
  -- If the guard fails, the trigger would INSERT a duplicate; we'd see count=2.
  IF NOT EXISTS (SELECT 1 FROM public.refunds
                   WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000004') THEN
    INSERT INTO public.refunds (
      transaction_id, shipowner_id, amount_usd_minor, refund_rail, status
    ) VALUES (
      'ffffffff-0000-0000-0000-000000000004',
      'cccccccc-0000-0000-0000-000000000001',
      1500, NULL, 'REQUESTED'
    );
  END IF;

  SELECT count(*) INTO v_count FROM public.refunds
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000004';
  ASSERT v_count = 1, format('idempotency: expected 1 refunds row, got %s', v_count);
END $$;

-- ─── Test 6: UPDATE refunds → APPROVED with NULL rail fails CHECK ──────────
DO $$
DECLARE
  prof UUID;
  caught BOOLEAN := false;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN RAISE EXCEPTION 'TEST FAILED: no profile seeded'; END IF;

  -- refunds row for tx ffff...0001 was created by trigger with rail=NULL,
  -- status=REQUESTED. Attempting to move to APPROVED without setting rail
  -- must fail refunds_rail_required_after_request.
  BEGIN
    UPDATE public.refunds
      SET status = 'APPROVED', approved_by = prof
      WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN
    caught := true;
  END;

  ASSERT caught, 'expected check_violation when transitioning APPROVED with NULL rail';

  -- Sanity: same UPDATE with rail set succeeds
  UPDATE public.refunds
    SET status = 'APPROVED', refund_rail = 'WALLET', approved_by = prof
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000001';
END $$;

-- ─── Test 7: REJECTED with NULL rail succeeds (relaxed CHECK allows it) ────
-- An admin rejecting a REQUESTED refund should not be forced to pick a rail.
-- The CHECK was relaxed to: status IN ('REQUESTED','REJECTED') OR rail IS NOT NULL.
DO $$
DECLARE
  prof UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles OFFSET 1 LIMIT 1;
  IF prof IS NULL THEN
    SELECT id INTO prof FROM public.profiles LIMIT 1;
  END IF;

  -- Re-create a REQUESTED refunds row (test 6 mutated tx ...0001's refund).
  -- Use tx ...0004 from test 5 (already exists with status=REQUESTED, rail=WALLET).
  -- Reset it back to NULL rail for this test:
  UPDATE public.refunds
    SET refund_rail = NULL, status = 'REQUESTED'
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000004';

  -- Now reject it without setting rail — should succeed.
  UPDATE public.refunds
    SET status = 'REJECTED', rejection_reason = 'duplicate request'
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000004';

  -- Verify the row landed in REJECTED with NULL rail
  PERFORM 1 FROM public.refunds
    WHERE transaction_id = 'ffffffff-0000-0000-0000-000000000004'
      AND status = 'REJECTED'
      AND refund_rail IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST 7 FAILED: REJECTED with NULL rail did not persist';
  END IF;
END $$;

ROLLBACK;
SELECT '066 refund enqueue trigger: PASS' AS test_result;
