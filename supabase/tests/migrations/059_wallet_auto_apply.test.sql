BEGIN;

-- Setup: Create a system user (needed for wallet_ledger.created_by in the trigger)
INSERT INTO auth.users (id, email) VALUES
  ('99999999-9999-9999-9999-999999999999', 'system@test');
DELETE FROM public.profiles WHERE id = '99999999-9999-9999-9999-999999999999';
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('99999999-9999-9999-9999-999999999999', 'system@test', 'System', 'SUPERADMIN', true);

-- Setup: Create a shipowner + wallet with auto_apply ON and balance
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AutoOwner', 'ACTIVE', 'en');

-- Create wallet for this shipowner with auto_apply ON
-- Balance starts at 0; we'll use ledger to add funds
INSERT INTO public.wallets (id, shipowner_id, auto_apply_to_proforma)
  VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    true
  );

-- Seed a TOPUP ledger entry to create the $5000 balance
-- The apply_ledger_to_wallet trigger will add this to the wallet balance
DO $$
DECLARE prof UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN RAISE EXCEPTION 'TEST FAILED: no profile seeded'; END IF;

  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-bbbbbbbbbbbb', 500000, 'TOPUP', prof);
END $$;

-- Vessel (must have NOT NULL columns for transactions)
INSERT INTO public.vessels (
  id, imo_number, mmsi, name, call_sign, flag_code, category,
  gross_tonnage_dwt, engine_power_kw, design_speed_knots
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '7777777', '777777777', 'TestVes', 'ZZZ', 'SO', 'CONTAINER',
  1000, 500, 10
);

-- Insert a PROFORMA worth $3000 → trigger should auto-apply $3000 from wallet
INSERT INTO public.transactions (
  id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
  document_type, transaction_type, shipowner_id, status, collections_status
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111', 'TestVes', '7777777',
  100, 3000, 'PROFORMA', 'ENTRY_TAX',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PENDING', 'CURRENT'
);

-- Trigger should have fired: wallet → 200000 (500000 - 300000), tx → PAID
DO $$
DECLARE
  v_balance BIGINT;
  v_status TEXT;
  v_payment_count INT;
BEGIN
  SELECT balance_usd_minor INTO v_balance FROM public.wallets
    WHERE shipowner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  ASSERT v_balance = 200000, format('expected wallet 200000, got %s', v_balance);

  SELECT status::TEXT INTO v_status FROM public.transactions
    WHERE id = '22222222-2222-2222-2222-222222222222';
  ASSERT v_status = 'PAID', format('expected status PAID, got %s', v_status);

  SELECT count(*) INTO v_payment_count FROM public.payments
    WHERE transaction_id = '22222222-2222-2222-2222-222222222222' AND rail = 'WALLET';
  ASSERT v_payment_count = 1, format('expected 1 WALLET payment, got %s', v_payment_count);
END $$;

-- Storage bucket exists
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM storage.buckets WHERE id = 'payment-proofs';
  ASSERT v_count = 1, 'payment-proofs bucket should exist';
END $$;

ROLLBACK;
SELECT '059 wallet auto-apply trigger + payment-proofs bucket: PASS' AS test_result;
