-- Test 047: shipowners KYC extensions
BEGIN;

-- 1. Enum values exist
DO $$
DECLARE
  vals TEXT[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder) INTO vals
    FROM pg_enum
    WHERE enumtypid = 'public.shipowner_account_state'::regtype;

  IF NOT vals @> ARRAY['GHOST','PENDING_REVIEW','INVITED','ACTIVE','REJECTED','SUSPENDED'] THEN
    RAISE EXCEPTION 'TEST FAILED: shipowner_account_state missing required values, got %', vals;
  END IF;
END $$;

-- 2. KYC columns exist with correct types
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipowners'
      AND column_name='preferred_language' AND data_type='text';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: shipowners.preferred_language missing or wrong type';
  END IF;
END $$;

-- 3. CHECK constraint on preferred_language rejects invalid values
DO $$
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, preferred_language)
      VALUES ('Test', 'xx');
    RAISE EXCEPTION 'TEST FAILED: invalid preferred_language was accepted';
  EXCEPTION WHEN check_violation THEN
    -- expected
    NULL;
  END;
END $$;

-- 4. CHECK constraint on proof_doc_type rejects invalid values
DO $$
DECLARE
  sid UUID;
BEGIN
  INSERT INTO public.shipowners (name) VALUES ('Test KYC') RETURNING id INTO sid;
  BEGIN
    UPDATE public.shipowners SET proof_doc_type = 'BOGUS' WHERE id = sid;
    RAISE EXCEPTION 'TEST FAILED: invalid proof_doc_type was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

-- 5. Default preferred_language = 'en'
DO $$
DECLARE
  lang TEXT;
  sid UUID;
BEGIN
  INSERT INTO public.shipowners (name) VALUES ('Default Lang Test') RETURNING id INTO sid;
  SELECT preferred_language INTO lang FROM public.shipowners WHERE id = sid;
  IF lang <> 'en' THEN
    RAISE EXCEPTION 'TEST FAILED: default preferred_language should be en, got %', lang;
  END IF;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

-- 6. PENDING_REVIEW → ACTIVE → SUSPENDED transitions allowed
DO $$
DECLARE
  sid UUID;
  cs TEXT;
BEGIN
  INSERT INTO public.shipowners (name, account_state) VALUES ('Lifecycle', 'PENDING_REVIEW') RETURNING id INTO sid;
  UPDATE public.shipowners SET account_state = 'ACTIVE' WHERE id = sid;
  UPDATE public.shipowners SET account_state = 'SUSPENDED' WHERE id = sid;
  SELECT account_state::TEXT INTO cs FROM public.shipowners WHERE id = sid;
  IF cs <> 'SUSPENDED' THEN
    RAISE EXCEPTION 'TEST FAILED: account_state transition broken, got %', cs;
  END IF;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

ROLLBACK;
SELECT '047 KYC extensions: PASS' AS test_result;
