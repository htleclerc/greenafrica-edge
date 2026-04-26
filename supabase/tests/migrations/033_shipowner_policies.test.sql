BEGIN;

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='arrival_alerts' AND schemaname='public'
     AND policyname='shipowner reads own vessel alerts';
  ASSERT n = 1, 'SHIPOWNER read policy on arrival_alerts missing';

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='transactions' AND schemaname='public'
     AND policyname='shipowner reads own transactions';
  ASSERT n = 1, 'SHIPOWNER read policy on transactions missing';
END $$;

ROLLBACK;
