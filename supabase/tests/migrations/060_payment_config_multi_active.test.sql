BEGIN;

-- 1. After mig 060, two providers MUST be allowed active simultaneously
UPDATE public.payment_config SET is_active = true WHERE provider = 'flutterwave';
UPDATE public.payment_config SET is_active = true WHERE provider = 'wire_transfer';

DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.payment_config WHERE is_active = true;
  ASSERT n = 2, format('expected 2 active providers, got %s', n);
END $$;

-- 2. routes_rail column exists and is seeded for every row
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.payment_config WHERE routes_rail IS NULL;
  ASSERT n = 0, format('expected all rows seeded with routes_rail, got %s nulls', n);
END $$;

-- 3. wire_transfer serves WIRE_TRANSFER rail
DO $$
DECLARE rails TEXT[];
BEGIN
  SELECT routes_rail INTO rails FROM public.payment_config WHERE provider = 'wire_transfer';
  ASSERT 'WIRE_TRANSFER' = ANY(rails), 'wire_transfer must route WIRE_TRANSFER';
END $$;

-- 4. wave serves MOBILE_MONEY only
DO $$
DECLARE rails TEXT[];
BEGIN
  SELECT routes_rail INTO rails FROM public.payment_config WHERE provider = 'wave';
  ASSERT rails = ARRAY['MOBILE_MONEY']::TEXT[], format('wave routes wrong: %s', rails);
END $$;

-- 5. The old unique index is gone
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'payment_config_single_active';
  ASSERT n = 0, 'payment_config_single_active must be dropped';
END $$;

ROLLBACK;
