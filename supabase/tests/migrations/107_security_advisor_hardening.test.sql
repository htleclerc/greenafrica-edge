-- Test 107: security_advisor_hardening
--   a) les 7 vues sont bien en security_invoker = true
--   b) RLS activée sur fx_rates + policy de lecture présente
BEGIN;

DO $$
DECLARE
  v_name    TEXT;
  v_views   TEXT[] := ARRAY[
    'profile_credit_usage',
    'orphan_transactions',
    'transaction_paid_summary',
    'v_payments_initiated_overdue',
    'v_stripe_webhook_failures',
    'v_wallet_balance_drift',
    'v_transaction_payment_drift'
  ];
  v_options TEXT[];
BEGIN
  -- a) security_invoker sur chaque vue
  FOREACH v_name IN ARRAY v_views LOOP
    SELECT c.reloptions INTO v_options
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_name;

    IF v_options IS NULL OR NOT ('security_invoker=true' = ANY (v_options)) THEN
      RAISE EXCEPTION 'TEST FAILED: view public.% is not security_invoker=true (reloptions=%)', v_name, v_options;
    END IF;
  END LOOP;

  -- b) RLS activée sur fx_rates
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'fx_rates' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: RLS not enabled on public.fx_rates';
  END IF;

  -- b) policy de lecture présente
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'fx_rates' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: no SELECT policy on public.fx_rates';
  END IF;
END $$;

SELECT '107 security_advisor_hardening: 7 views security_invoker + fx_rates RLS: PASS' AS test_result;

ROLLBACK;
SELECT '107 security_advisor_hardening: PASS' AS test_result;
