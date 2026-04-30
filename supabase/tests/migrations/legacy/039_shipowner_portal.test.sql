BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 039 tests — shipowner portal v0 schema + RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. vessels SELECT RLS for SHIPOWNER exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='vessels' AND schemaname='public'
     AND policyname='shipowner reads own vessels';
  ASSERT n = 1, 'SHIPOWNER read policy on vessels missing';
END $$;

-- 2. disputes_insert_own policy was tightened (mig 007 had a single-clause
--    policy; mig 039 added the transaction-ownership EXISTS check)
DO $$
DECLARE clause TEXT;
BEGIN
  SELECT with_check INTO clause FROM pg_policies
   WHERE tablename='disputes' AND policyname='disputes_insert_own';
  ASSERT clause LIKE '%transactions%',
    'disputes_insert_own should reference transactions for ownership check';
  ASSERT clause LIKE '%shipowners%',
    'disputes_insert_own should reference shipowners for owner-side ownership';
END $$;

-- 3. shipowners audit columns added
DO $$
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['invited_at', 'invited_by'] LOOP
    ASSERT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='shipowners' AND column_name=c
    ), format('shipowners.%s column missing', c);
  END LOOP;
END $$;

-- 4. shipowner_payment_intents table + enum + indexes
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='shipowner_payment_intents'
  ), 'shipowner_payment_intents table missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'shipowner_payment_intent_status'
  ), 'shipowner_payment_intent_status enum missing';

  ASSERT (SELECT COUNT(*) FROM pg_enum e
            JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='shipowner_payment_intent_status') = 3,
    'shipowner_payment_intent_status should have exactly 3 values (DECLARED, CONFIRMED, REJECTED)';
END $$;

-- 5. RLS enabled + at least one policy of each kind on payment_intents
DO $$
DECLARE n INT;
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.shipowner_payment_intents'::regclass),
    'RLS not enabled on shipowner_payment_intents';

  -- 4 policies expected: 2 SELECT (shipowner own + finance all),
  -- 1 INSERT (shipowner own), 1 UPDATE (finance resolve)
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='shipowner_payment_intents' AND schemaname='public';
  ASSERT n = 4, format('expected 4 policies on shipowner_payment_intents, got %s', n);
END $$;

-- 6. CHECK constraint amount_usd >= 0 enforced
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_schema='public'
       AND check_clause LIKE '%amount_usd%>=%0%'
  ), 'amount_usd >= 0 CHECK constraint missing on shipowner_payment_intents';
END $$;

-- 7. updated_at trigger wired
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname='shipowner_payment_intents_updated_at'
       AND tgrelid='public.shipowner_payment_intents'::regclass
  ), 'updated_at trigger missing on shipowner_payment_intents';
END $$;

ROLLBACK;
