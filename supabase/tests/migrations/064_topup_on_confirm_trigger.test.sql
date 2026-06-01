BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 064 test: topup-on-confirm trigger
-- 4 cases:
--   1. INSERT a CONFIRMED payment with NULL transaction → TOPUP ledger row + balance
--   2. UPDATE INITIATED → CONFIRMED with NULL transaction → TOPUP created
--   3. Re-UPDATE same row → still 1 TOPUP (idempotency)
--   4. CONFIRMED payment WITH transaction_id → NO TOPUP
-- ─────────────────────────────────────────────────────────────────────────────

-- Setup: System actor profile (used for confirmed_by + created_by)
INSERT INTO auth.users (id, email) VALUES
  ('99999999-9999-9999-9999-999999999999', 'sys-064@test');
DELETE FROM public.profiles WHERE id = '99999999-9999-9999-9999-999999999999';
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('99999999-9999-9999-9999-999999999999', 'sys-064@test', 'Sys 064', 'SUPERADMIN', true);

-- Setup: 2 shipowners (so each test case gets a fresh wallet)
INSERT INTO public.shipowners (id, name, account_state, preferred_language) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Owner1-064', 'ACTIVE', 'en'),
  ('a0000002-0000-0000-0000-000000000002', 'Owner2-064', 'ACTIVE', 'en'),
  ('a0000003-0000-0000-0000-000000000003', 'Owner3-064', 'ACTIVE', 'en'),
  ('a0000004-0000-0000-0000-000000000004', 'Owner4-064', 'ACTIVE', 'en');

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 1: INSERT a CONFIRMED payment with NULL transaction → TOPUP created
-- ─────────────────────────────────────────────────────────────────────────────
-- STRIPE + CONFIRMED requires a non-null external_reference
-- (payments_stripe_external_ref CHECK, mig 048) — supply one here.
INSERT INTO public.payments (
  id, transaction_id, shipowner_id, amount_minor, currency, amount_usd_minor,
  rail, status, external_reference, confirmed_by, confirmed_at
) VALUES (
  'b0000001-0000-0000-0000-000000000001',
  NULL,
  'a0000001-0000-0000-0000-000000000001',
  100000, 'USD', 100000,
  'STRIPE', 'CONFIRMED', 'pi_topup_064_case1',
  '99999999-9999-9999-9999-999999999999',
  NOW()
);

DO $$
DECLARE
  v_balance BIGINT;
  v_topup_count INT;
BEGIN
  SELECT balance_usd_minor INTO v_balance FROM public.wallets
    WHERE shipowner_id = 'a0000001-0000-0000-0000-000000000001';
  ASSERT v_balance = 100000, format('Case 1: expected wallet balance 100000, got %s', v_balance);

  SELECT count(*) INTO v_topup_count FROM public.wallet_ledger
    WHERE payment_id = 'b0000001-0000-0000-0000-000000000001' AND kind = 'TOPUP';
  ASSERT v_topup_count = 1, format('Case 1: expected 1 TOPUP, got %s', v_topup_count);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 2: UPDATE INITIATED → CONFIRMED with NULL transaction → TOPUP created
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.payments (
  id, transaction_id, shipowner_id, amount_minor, currency, amount_usd_minor,
  rail, status
) VALUES (
  'b0000002-0000-0000-0000-000000000002',
  NULL,
  'a0000002-0000-0000-0000-000000000002',
  200000, 'USD', 200000,
  'WIRE_TRANSFER', 'INITIATED'
);

-- INITIATED → no TOPUP yet
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.wallet_ledger
    WHERE payment_id = 'b0000002-0000-0000-0000-000000000002';
  ASSERT v_count = 0, format('Case 2 pre: expected 0 ledger before confirm, got %s', v_count);
END $$;

UPDATE public.payments
   SET status = 'CONFIRMED',
       confirmed_by = '99999999-9999-9999-9999-999999999999',
       confirmed_at = NOW()
 WHERE id = 'b0000002-0000-0000-0000-000000000002';

DO $$
DECLARE
  v_balance BIGINT;
  v_topup_count INT;
BEGIN
  SELECT balance_usd_minor INTO v_balance FROM public.wallets
    WHERE shipowner_id = 'a0000002-0000-0000-0000-000000000002';
  ASSERT v_balance = 200000, format('Case 2: expected wallet balance 200000, got %s', v_balance);

  SELECT count(*) INTO v_topup_count FROM public.wallet_ledger
    WHERE payment_id = 'b0000002-0000-0000-0000-000000000002' AND kind = 'TOPUP';
  ASSERT v_topup_count = 1, format('Case 2: expected 1 TOPUP, got %s', v_topup_count);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 3: Re-UPDATE same row → still 1 TOPUP (idempotency)
-- We touch a non-status field (rail_details) on an already-CONFIRMED row.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.payments
   SET rail_details = '{"note":"touched"}'::jsonb
 WHERE id = 'b0000002-0000-0000-0000-000000000002';

DO $$
DECLARE
  v_balance BIGINT;
  v_topup_count INT;
BEGIN
  SELECT balance_usd_minor INTO v_balance FROM public.wallets
    WHERE shipowner_id = 'a0000002-0000-0000-0000-000000000002';
  ASSERT v_balance = 200000, format('Case 3: balance must remain 200000, got %s', v_balance);

  SELECT count(*) INTO v_topup_count FROM public.wallet_ledger
    WHERE payment_id = 'b0000002-0000-0000-0000-000000000002' AND kind = 'TOPUP';
  ASSERT v_topup_count = 1, format('Case 3 idempotency: expected 1 TOPUP, got %s', v_topup_count);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Case 4: CONFIRMED payment WITH transaction_id → NO TOPUP
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.vessels (
  id, imo_number, mmsi, name, call_sign, flag_code, category,
  gross_tonnage_dwt, engine_power_kw, design_speed_knots
) VALUES (
  'c0000001-0000-0000-0000-000000000001',
  '6464646', '646464646', 'Ves-064', 'AAA', 'SO', 'CONTAINER',
  1000, 500, 10
);

INSERT INTO public.transactions (
  id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
  document_type, transaction_type, shipowner_id, status, collections_status
) VALUES (
  'd0000001-0000-0000-0000-000000000001',
  'c0000001-0000-0000-0000-000000000001', 'Ves-064', '6464646',
  100, 3000, 'PROFORMA', 'ENTRY_TAX',
  'a0000004-0000-0000-0000-000000000004', 'PENDING', 'CURRENT'
);

INSERT INTO public.payments (
  id, transaction_id, shipowner_id, amount_minor, currency, amount_usd_minor,
  rail, status, confirmed_by, confirmed_at
) VALUES (
  'b0000004-0000-0000-0000-000000000004',
  'd0000001-0000-0000-0000-000000000001',
  'a0000004-0000-0000-0000-000000000004',
  300000, 'USD', 300000,
  'WIRE_TRANSFER', 'CONFIRMED',
  '99999999-9999-9999-9999-999999999999',
  NOW()
);

DO $$
DECLARE
  v_topup_count INT;
BEGIN
  SELECT count(*) INTO v_topup_count FROM public.wallet_ledger
    WHERE payment_id = 'b0000004-0000-0000-0000-000000000004' AND kind = 'TOPUP';
  ASSERT v_topup_count = 0, format('Case 4: expected 0 TOPUP (txn-linked payment), got %s', v_topup_count);
END $$;

ROLLBACK;
SELECT '064 topup-on-confirm trigger: PASS' AS test_result;
