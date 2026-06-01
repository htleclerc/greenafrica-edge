-- Test 072: jurisdiction_id denormalised onto operator + money rail (Model B)
BEGIN;

-- 1. jurisdiction_id column present + NOT NULL + Somaliland DEFAULT on each money-rail table
DO $$
DECLARE
  t TEXT;
  is_nullable TEXT;
  def TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipowners','payments','wallets','wallet_ledger','refunds','owner_notifications'] LOOP
    SELECT c.is_nullable, c.column_default INTO is_nullable, def
      FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=t AND c.column_name='jurisdiction_id';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TEST FAILED: %.jurisdiction_id missing', t;
    END IF;
    IF is_nullable <> 'NO' THEN
      RAISE EXCEPTION 'TEST FAILED: %.jurisdiction_id should be NOT NULL', t;
    END IF;
    IF def IS NULL OR def NOT LIKE '%00000000-0000-4000-8000-00000000534f%' THEN
      RAISE EXCEPTION 'TEST FAILED: %.jurisdiction_id default not Somaliland, got %', t, def;
    END IF;
  END LOOP;
END $$;

-- 2. FK integrity: jurisdiction_id references jurisdictions(id) (insert with bogus id rejected)
DO $$
DECLARE sid UUID;
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, jurisdiction_id)
      VALUES ('Bad Juri', '99999999-9999-4999-8999-999999999999') RETURNING id INTO sid;
    RAISE EXCEPTION 'TEST FAILED: shipowners accepted a non-existent jurisdiction_id';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;  -- expected
  END;
END $$;

-- 3. New operator without explicit jurisdiction inherits Somaliland (expand-step DEFAULT)
DO $$
DECLARE jid UUID; sid UUID;
BEGIN
  INSERT INTO public.shipowners (name) VALUES ('Default Juri Test') RETURNING id INTO sid;
  SELECT jurisdiction_id INTO jid FROM public.shipowners WHERE id = sid;
  IF jid <> '00000000-0000-4000-8000-00000000534f'::uuid THEN
    RAISE EXCEPTION 'TEST FAILED: operator default jurisdiction not Somaliland, got %', jid;
  END IF;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

ROLLBACK;
SELECT '072 GreenGate money jurisdiction: PASS' AS test_result;
