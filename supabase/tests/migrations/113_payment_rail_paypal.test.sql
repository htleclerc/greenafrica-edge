BEGIN;

-- 1. La valeur d'enum PAYPAL existe
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'payment_rail' AND e.enumlabel = 'PAYPAL';
  ASSERT n = 1, format('expected enum label PAYPAL on payment_rail, found %s', n);
END $$;

-- 2. Les rails préexistants sont intacts (aucune valeur perdue)
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['STRIPE','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT',
                           'NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET']
  LOOP
    ASSERT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'payment_rail' AND e.enumlabel = r
    ), format('enum label %s missing from payment_rail', r);
  END LOOP;
END $$;

-- 3. refunds.refund_rail partage l'enum et accepte donc PAYPAL mécaniquement
DO $$
DECLARE v_type TEXT;
BEGIN
  SELECT t.typname INTO v_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE c.relname = 'refunds' AND a.attname = 'refund_rail';
  ASSERT v_type = 'payment_rail',
    format('expected refunds.refund_rail to use payment_rail, got %s', v_type);
END $$;

ROLLBACK;
