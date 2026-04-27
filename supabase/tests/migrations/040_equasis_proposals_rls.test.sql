BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 040 tests — Equasis proposals RLS + source column
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. source column added with the right CHECK
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='equasis_scrape_proposals'
       AND column_name='source'
       AND is_nullable='NO'
  ), 'source column missing or nullable';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_schema='public'
       AND check_clause LIKE '%manual%'
       AND check_clause LIKE '%fixture%'
       AND check_clause LIKE '%scraper%'
  ), 'source CHECK with manual/fixture/scraper values missing';
END $$;

-- 2. applied → reviewer CHECK constraint
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'equasis_proposals_applied_requires_reviewer'
       AND conrelid = 'public.equasis_scrape_proposals'::regclass
  ), 'applied-requires-reviewer CHECK constraint missing';
END $$;

-- 3. RLS enabled
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.equasis_scrape_proposals'::regclass),
    'RLS not enabled on equasis_scrape_proposals';
END $$;

-- 4. SELECT + UPDATE policies (no INSERT — service_role only)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='equasis_scrape_proposals' AND schemaname='public'
     AND policyname='officers read equasis proposals';
  ASSERT n = 1, 'SELECT policy missing';

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='equasis_scrape_proposals' AND schemaname='public'
     AND policyname='officers resolve equasis proposals';
  ASSERT n = 1, 'UPDATE policy missing';

  -- Defence in depth: no INSERT policy, so non-service_role writers are
  -- denied implicitly.
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='equasis_scrape_proposals' AND schemaname='public'
     AND cmd = 'INSERT';
  ASSERT n = 0, 'unexpected INSERT policy on equasis_scrape_proposals';
END $$;

-- 5. CHECK constraint actually rejects the bad case
DO $$
DECLARE
  raised BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.equasis_scrape_proposals (imo_number, applied)
    VALUES ('BAD-INSERT-TEST', TRUE);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  ASSERT raised, 'CHECK constraint did not reject applied=true with no reviewer';
END $$;

ROLLBACK;
