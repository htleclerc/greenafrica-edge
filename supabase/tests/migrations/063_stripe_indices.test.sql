BEGIN;

-- 1. Partial index exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_stripe_pi';
  ASSERT n = 1, format('expected idx_payments_stripe_pi, found %s', n);
END $$;

-- 2. Index has the WHERE clause restricting to rail='STRIPE'
DO $$
DECLARE def TEXT;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_stripe_pi';
  ASSERT def LIKE '%WHERE %rail%STRIPE%', format('expected partial index restricted to rail=STRIPE, got: %s', def);
END $$;

ROLLBACK;
