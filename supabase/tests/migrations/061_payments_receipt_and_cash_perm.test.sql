BEGIN;

-- 1. Three new columns exist on payments
DO $$
DECLARE missing INT;
BEGIN
  SELECT COUNT(*) INTO missing
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name IN ('receipt_ref', 'receipt_storage_path', 'receipt_generated_at');
  ASSERT missing = 3, format('expected 3 receipt cols, found %s', missing);
END $$;

-- 2. receipt_ref UNIQUE when not null
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'payments_receipt_ref_unique';
  ASSERT n = 1, 'payments_receipt_ref_unique partial unique index missing';
END $$;

-- 3. profiles.can_record_cash exists with default false
DO $$
DECLARE col_default TEXT;
BEGIN
  SELECT column_default INTO col_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_record_cash';
  ASSERT col_default IS NOT NULL, 'can_record_cash column missing';
  ASSERT col_default LIKE 'false%', format('expected default false, got %s', col_default);
END $$;

-- 4. UNIQUE constraint enforced — inserting two payments with the same receipt_ref fails
INSERT INTO auth.users (id, email) VALUES
  ('11111111-aaaa-aaaa-aaaa-111111111111', 'unique-test@local');
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('11111111-aaaa-aaaa-aaaa-111111111111', 'unique-test@local', 'Tester', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('22222222-bbbb-bbbb-bbbb-222222222222', 'TestCo', 'ACTIVE', 'en');
INSERT INTO public.payments
  (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor, rail, status,
   receipt_ref, receipt_storage_path, receipt_generated_at)
  VALUES
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   10000, 'USD', 10000, 'WIRE_TRANSFER', 'CONFIRMED',
   'RCT-2026-DUPE', 'documents/receipts/RCT-2026-DUPE.pdf', NOW()),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   20000, 'USD', 20000, 'WIRE_TRANSFER', 'CONFIRMED',
   'RCT-2026-OTHER', 'documents/receipts/RCT-2026-OTHER.pdf', NOW());

DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments
      (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor, rail, status, receipt_ref)
      VALUES
      ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
       30000, 'USD', 30000, 'WIRE_TRANSFER', 'CONFIRMED', 'RCT-2026-DUPE');
    RAISE EXCEPTION 'expected unique violation, got success';
  EXCEPTION WHEN unique_violation THEN
    -- expected
    NULL;
  END;
END $$;

-- 5. NULL receipt_ref allowed multiple times (partial unique semantics)
INSERT INTO public.payments
  (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor, rail, status, receipt_ref)
  VALUES
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   40000, 'USD', 40000, 'WIRE_TRANSFER', 'INITIATED', NULL),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   50000, 'USD', 50000, 'WIRE_TRANSFER', 'INITIATED', NULL);

ROLLBACK;
