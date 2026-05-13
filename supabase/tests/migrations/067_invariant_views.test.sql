-- Plan 7H-3 — Migration 067 invariant views tests.
--
-- DEFERRED: this test has not been executed in CI/local because Docker is
-- still broken on the host running these migrations (carries the 7E/7F/7G
-- precedent — 10 migs now pending end-to-end pg-test: 060-067).
-- Ops verifies on hosted post-push by running the views' SELECTs against
-- known seeded data; failure modes are caught by the local schema review
-- of mig 067 SQL.
--
-- Coverage:
--   1. All 4 views exist in pg_views
--   2. Empty DB → all 4 views return 0 rows
--   3. Payment INITIATED with created_at = NOW() - 25h →
--      v_payments_initiated_overdue returns the row
--   4. STRIPE payment status=REJECTED rejected_reason='Stripe: card declined' →
--      v_stripe_webhook_failures returns the row
--   5. Wallet balance=1000 + ledger=+500 → v_wallet_balance_drift drift=500
--   6. transaction.partial_paid_usd=30000 + CONFIRMED payment 2500000 minor
--      → v_transaction_payment_drift drift=5000

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 1: all 4 views exist
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_views
    WHERE schemaname = 'public'
      AND viewname IN (
        'v_payments_initiated_overdue',
        'v_stripe_webhook_failures',
        'v_wallet_balance_drift',
        'v_transaction_payment_drift'
      );
  ASSERT n = 4, format('expected 4 invariant views in public, got %s', n);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 2: empty DB → 0 rows from each view (sanity)
-- We assume the local test DB has no pre-existing drift in payments / wallets
-- / transactions. If sibling tests leak fixtures, those would show up here —
-- in practice each test wraps BEGIN/ROLLBACK so the surface is clean.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.v_payments_initiated_overdue;
  ASSERT n = 0, format('expected 0 from v_payments_initiated_overdue on clean DB, got %s', n);
  SELECT COUNT(*) INTO n FROM public.v_stripe_webhook_failures;
  ASSERT n = 0, format('expected 0 from v_stripe_webhook_failures on clean DB, got %s', n);
  SELECT COUNT(*) INTO n FROM public.v_wallet_balance_drift;
  ASSERT n = 0, format('expected 0 from v_wallet_balance_drift on clean DB, got %s', n);
  SELECT COUNT(*) INTO n FROM public.v_transaction_payment_drift;
  ASSERT n = 0, format('expected 0 from v_transaction_payment_drift on clean DB, got %s', n);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Shared fixtures
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local');
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local', 'A', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TestCo', 'ACTIVE', 'en');
INSERT INTO public.vessels (id, imo_number, name, jurisdiction_country, shipowner_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '9999999', 'TEST', 'KE',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- ─────────────────────────────────────────────────────────────────────────
-- Test 3: INITIATED payment older than 24h → surfaces in overdue view
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.payments
  (id, shipowner_id, declared_by, amount_minor, currency, amount_usd_minor,
   rail, status, created_at, updated_at)
  VALUES
  ('11111111-1111-1111-1111-111111111111',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   10000, 'USD', 10000,
   'WIRE_TRANSFER', 'INITIATED',
   NOW() - INTERVAL '25 hours',
   NOW() - INTERVAL '25 hours');

DO $$
DECLARE n INT;
DECLARE age NUMERIC;
BEGIN
  SELECT COUNT(*) INTO n FROM public.v_payments_initiated_overdue
    WHERE id = '11111111-1111-1111-1111-111111111111';
  ASSERT n = 1, format('expected 25h-old INITIATED payment in overdue view, got %s', n);

  SELECT age_hours INTO age FROM public.v_payments_initiated_overdue
    WHERE id = '11111111-1111-1111-1111-111111111111';
  ASSERT age >= 24.0, format('expected age_hours >= 24, got %s', age);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 4: STRIPE rail REJECTED via webhook → surfaces in failures view
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.payments
  (id, shipowner_id, declared_by, amount_minor, currency, amount_usd_minor,
   rail, status, rejected_reason, external_reference,
   created_at, updated_at)
  VALUES
  ('22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   5000, 'USD', 5000,
   'STRIPE', 'REJECTED', 'Stripe: card declined', 'pi_test_123',
   NOW() - INTERVAL '1 hour',
   NOW() - INTERVAL '30 minutes');

DO $$
DECLARE n INT;
DECLARE stripe_pi TEXT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.v_stripe_webhook_failures
    WHERE id = '22222222-2222-2222-2222-222222222222';
  ASSERT n = 1, format('expected Stripe REJECTED payment in failures view, got %s', n);

  SELECT stripe_payment_intent_id INTO stripe_pi FROM public.v_stripe_webhook_failures
    WHERE id = '22222222-2222-2222-2222-222222222222';
  ASSERT stripe_pi = 'pi_test_123',
    format('expected stripe_payment_intent_id=pi_test_123, got %s', stripe_pi);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 5: Wallet balance ≠ SUM(ledger) → surfaces in drift view
-- Setup: insert ledger +500 (trigger sets balance to 500), then UPDATE
-- balance directly to 1000 (bypasses apply_ledger_to_wallet trigger).
-- Expected drift = 1000 - 500 = +500.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.wallets (id, shipowner_id, balance_usd_minor)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd',
          'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          0);

INSERT INTO public.wallet_ledger
  (wallet_id, amount_signed_usd_minor, kind, created_by)
  VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 500, 'TOPUP',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- Trigger has now set wallets.balance_usd_minor = 500. Force drift:
UPDATE public.wallets SET balance_usd_minor = 1000
  WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

DO $$
DECLARE n INT;
DECLARE d BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.v_wallet_balance_drift
    WHERE wallet_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  ASSERT n = 1, format('expected wallet drift row, got %s', n);

  SELECT drift_minor INTO d FROM public.v_wallet_balance_drift
    WHERE wallet_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  ASSERT d = 500, format('expected drift_minor=500, got %s', d);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 6: transaction.partial_paid_usd ≠ SUM(confirmed payments in $)
-- Setup: transaction with tax=30000 USD, partial_paid_usd=30000, then a
-- single CONFIRMED payment of 2,500,000 minor = $25,000.
-- recompute_transaction_status trigger will set status=PARTIALLY_PAID
-- but partial_paid_usd remains 30000 (no automated sync there).
-- Expected drift = 30000 - 25000 = +5000 USD.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
   partial_paid_usd, status, document_type, transaction_type,
   shipowner_id, invoice_ref, created_at)
  VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 100.0, 30000.00,
   30000.00, 'PENDING', 'FINAL', 'ENTRY_TAX',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-DRIFT-T6',
   NOW() - INTERVAL '1 day');

INSERT INTO public.payments
  (id, transaction_id, shipowner_id, declared_by,
   amount_minor, currency, amount_usd_minor,
   rail, status, confirmed_by, confirmed_at,
   created_at, updated_at)
  VALUES
  ('33333333-3333-3333-3333-333333333333',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   2500000, 'USD', 2500000,
   'WIRE_TRANSFER', 'CONFIRMED',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NOW(),
   NOW(), NOW());

DO $$
DECLARE n INT;
DECLARE d NUMERIC;
BEGIN
  SELECT COUNT(*) INTO n FROM public.v_transaction_payment_drift
    WHERE transaction_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  ASSERT n = 1, format('expected txn payment drift row, got %s', n);

  SELECT drift_usd INTO d FROM public.v_transaction_payment_drift
    WHERE transaction_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  ASSERT ABS(d - 5000.00) < 0.01,
    format('expected drift_usd ~= 5000.00, got %s', d);
END $$;

ROLLBACK;
