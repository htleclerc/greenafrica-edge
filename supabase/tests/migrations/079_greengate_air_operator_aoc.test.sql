-- W1-E mig 079: aoc_number column + proof_doc_type CHECK accepts 'AOC'.
BEGIN;

-- 1. aoc_number column exists and is nullable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipowners' AND column_name='aoc_number'
  ) THEN RAISE EXCEPTION 'aoc_number column missing'; END IF;

  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='shipowners' AND column_name='aoc_number') <> 'YES'
  THEN RAISE EXCEPTION 'aoc_number must be nullable'; END IF;
END $$;

-- 2. proof_doc_type CHECK accepts 'AOC' (insert a minimal air operator row).
INSERT INTO public.shipowners (name, account_state, applicable_modes, proof_doc_type)
VALUES ('AOC test op', 'PENDING_REVIEW', ARRAY['AIR'::transport_mode], 'AOC');

-- 3. proof_doc_type CHECK still rejects a bogus value.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, account_state, proof_doc_type)
    VALUES ('bogus doc', 'GHOST', 'NOT_A_REAL_TYPE');
    RAISE EXCEPTION 'CHECK should have rejected NOT_A_REAL_TYPE';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;
END $$;

-- 4. Maritime value still accepted (non-regression).
INSERT INTO public.shipowners (name, account_state, proof_doc_type)
VALUES ('maritime doc', 'GHOST', 'TRADE_REGISTER');

SELECT '079 GreenGate air operator AOC: PASS' AS result;
ROLLBACK;
