BEGIN;

-- Before mig 062: table exists.
-- After mig 062: table is gone.

-- 1. Table does not exist
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'shipowner_payment_intents';
  ASSERT n = 0, format('expected shipowner_payment_intents dropped, found %s', n);
END $$;

-- 2. No leftover RLS policies (they cascade with DROP TABLE but be explicit)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'shipowner_payment_intents';
  ASSERT n = 0, format('expected no leftover policies, found %s', n);
END $$;

-- 3. No leftover indexes
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'shipowner_payment_intents';
  ASSERT n = 0, format('expected no leftover indexes, found %s', n);
END $$;

-- 4. v7 payments table still exists (sanity — we drop the LEGACY, not v7)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'payments';
  ASSERT n = 1, format('payments table must still exist, found %s', n);
END $$;

ROLLBACK;
