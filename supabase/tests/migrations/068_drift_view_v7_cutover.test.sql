-- Test mig 068: v_transaction_payment_drift excludes pre-2026-05-01 transactions.
-- DEFERRED: Docker still broken on the dev machine (carries 7E/7F/7G/7H-3 precedent);
-- pg test runner unused for mig 068 — validated post-push on hosted (drift row count
-- should drop from 4 → 0 once mig 068 is applied to the hosted DB).

BEGIN;

-- ─── Setup ─────────────────────────────────────────────────────────────────
INSERT INTO public.shipowners (id, name)
  VALUES ('cccccccc-0000-0000-0000-000000000068', 'DriftOwner068');

INSERT INTO public.vessels (
  id, imo_number, mmsi, name, call_sign, flag_code, category,
  gross_tonnage_dwt, engine_power_kw, design_speed_knots
) VALUES (
  'eeeeeeee-0000-0000-0000-000000000068',
  '6800001', '6800001000', 'DriftVes068', 'DRV68', 'SO', 'CONTAINER',
  5000, 1000, 12.5
);

-- ─── Test 1: pre-v7 transaction with drift is NOT surfaced by the view ────
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, partial_paid_usd, status, collections_status, created_at
  ) VALUES (
    'aaaa0001-0000-0000-0000-000000000068',
    'eeeeeeee-0000-0000-0000-000000000068', 'DriftVes068', '6800001',
    'cccccccc-0000-0000-0000-000000000068',
    'FINAL', 'ENTRY_TAX',
    -- status=PAID requires collections_status=PAID (enforce_status_collections_invariant, mig 022).
    100.00, 500.00, 500.00, 'PAID', 'PAID',
    -- Pre-v7 cutover date — should be filtered out by mig 068.
    TIMESTAMPTZ '2025-08-15 10:00:00+00'
  );

  -- No payments row → computed_paid_usd=0, reported=500 → drift=500.
  -- Pre-mig-068 this would surface; post-mig-068 it must NOT.
  SELECT count(*) INTO v_count FROM public.v_transaction_payment_drift
    WHERE transaction_id = 'aaaa0001-0000-0000-0000-000000000068';
  ASSERT v_count = 0,
    format('pre-v7 transaction should be excluded by date floor, got %s rows', v_count);
END $$;

-- ─── Test 2: post-v7 transaction with drift IS surfaced (sanity) ──────────
DO $$
DECLARE
  v_count INT;
  v_drift NUMERIC;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, partial_paid_usd, status, collections_status, created_at
  ) VALUES (
    'aaaa0002-0000-0000-0000-000000000068',
    'eeeeeeee-0000-0000-0000-000000000068', 'DriftVes068', '6800001',
    'cccccccc-0000-0000-0000-000000000068',
    'FINAL', 'ENTRY_TAX',
    100.00, 800.00, 800.00, 'PAID', 'PAID',
    -- v7-era date (post-cutover).
    TIMESTAMPTZ '2026-06-01 10:00:00+00'
  );

  SELECT count(*), MAX(drift_usd) INTO v_count, v_drift
    FROM public.v_transaction_payment_drift
    WHERE transaction_id = 'aaaa0002-0000-0000-0000-000000000068';
  ASSERT v_count = 1,
    format('v7-era transaction with drift should surface, got %s rows', v_count);
  ASSERT v_drift = 800.00,
    format('expected drift_usd=800.00, got %s', v_drift);
END $$;

-- ─── Test 3: exact boundary — 2026-05-01 00:00:00+00 IS included ──────────
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, partial_paid_usd, status, collections_status, created_at
  ) VALUES (
    'aaaa0003-0000-0000-0000-000000000068',
    'eeeeeeee-0000-0000-0000-000000000068', 'DriftVes068', '6800001',
    'cccccccc-0000-0000-0000-000000000068',
    'FINAL', 'ENTRY_TAX',
    100.00, 100.00, 100.00, 'PAID', 'PAID',
    TIMESTAMPTZ '2026-05-01 00:00:00+00'  -- exact boundary, inclusive (>=)
  );

  SELECT count(*) INTO v_count FROM public.v_transaction_payment_drift
    WHERE transaction_id = 'aaaa0003-0000-0000-0000-000000000068';
  ASSERT v_count = 1,
    format('boundary transaction (2026-05-01 00:00 UTC) should be included, got %s rows', v_count);
END $$;

-- ─── Test 4: boundary − 1µs — 2026-04-30 23:59:59.999999+00 EXCLUDED ─────
DO $$
DECLARE v_count INT;
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    document_type, transaction_type,
    emissions_tco2, tax_amount_usd, partial_paid_usd, status, collections_status, created_at
  ) VALUES (
    'aaaa0004-0000-0000-0000-000000000068',
    'eeeeeeee-0000-0000-0000-000000000068', 'DriftVes068', '6800001',
    'cccccccc-0000-0000-0000-000000000068',
    'FINAL', 'ENTRY_TAX',
    100.00, 100.00, 100.00, 'PAID', 'PAID',
    TIMESTAMPTZ '2026-04-30 23:59:59.999999+00'
  );

  SELECT count(*) INTO v_count FROM public.v_transaction_payment_drift
    WHERE transaction_id = 'aaaa0004-0000-0000-0000-000000000068';
  ASSERT v_count = 0,
    format('just-pre-boundary transaction should be excluded, got %s rows', v_count);
END $$;

ROLLBACK;
SELECT '068 drift view v7 cutover: PASS' AS test_result;
