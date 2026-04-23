BEGIN;

-- user_role now includes SHIPOWNER
DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
     WHERE t.typname='user_role' AND enumlabel='SHIPOWNER'
  ), 'user_role missing SHIPOWNER value';
END $$;

-- RLS enabled on new tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arrival_alerts','shipowners','owner_agent_mappings',
    'emission_factors','equasis_scrape_proposals'
  ] LOOP
    ASSERT (SELECT relrowsecurity FROM pg_class
             WHERE oid = ('public.'||t)::regclass),
      format('RLS not enabled on %s', t);
  END LOOP;
END $$;

-- At least one policy on each
DO $$
DECLARE t TEXT;
DECLARE n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'arrival_alerts','shipowners','owner_agent_mappings',
    'emission_factors','equasis_scrape_proposals'
  ] LOOP
    SELECT COUNT(*) INTO n FROM pg_policies WHERE tablename=t AND schemaname='public';
    ASSERT n >= 1, format('%s has no RLS policies', t);
  END LOOP;
END $$;

ROLLBACK;
