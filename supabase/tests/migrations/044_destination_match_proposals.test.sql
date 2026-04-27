BEGIN;

-- 1. Table exists with expected columns + types
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='destination_match_proposals'
  ), 'destination_match_proposals table missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='destination_match_proposals'
       AND column_name='raw_destination' AND is_nullable='NO'
  ), 'raw_destination column missing or nullable';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='destination_match_proposals'
       AND column_name='fuzzy_score' AND data_type='integer'
  ), 'fuzzy_score column missing or wrong type';
END $$;

-- 2. Status enum exists
DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='destination_proposal_status' AND e.enumlabel='PENDING')),
    'PENDING enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='destination_proposal_status' AND e.enumlabel='APPROVED')),
    'APPROVED enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='destination_proposal_status' AND e.enumlabel='REJECTED')),
    'REJECTED enum value missing';
END $$;

-- 3. RLS enabled
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class
           WHERE oid='public.destination_match_proposals'::regclass),
    'RLS not enabled';
END $$;

-- 4. SELECT + UPDATE policies (NO INSERT policy on purpose)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='destination_match_proposals'
     AND cmd='SELECT';
  ASSERT n = 1, format('expected 1 SELECT policy, got %s', n);

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='destination_match_proposals'
     AND cmd='UPDATE';
  ASSERT n = 1, format('expected 1 UPDATE policy, got %s', n);

  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='destination_match_proposals'
     AND cmd='INSERT';
  ASSERT n = 0, 'INSERT policy must not exist (service_role only)';
END $$;

-- 5. Unique partial index on (mmsi, normalized) WHERE status='PENDING'
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND indexname='destination_match_proposals_unique_pending_idx'
  ), 'unique pending index missing';
END $$;

ROLLBACK;
