BEGIN;

-- Enum shipowner_account_state
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_type WHERE typname='shipowner_account_state'),
    'shipowner_account_state enum missing';
  -- Original mig 024 values must be present. Mig 047 (Plan 7A) added
  -- PENDING_REVIEW, REJECTED, SUSPENDED — so we assert SUPERSET, not equality.
  ASSERT (SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='shipowner_account_state')
         @> ARRAY['GHOST','INVITED','ACTIVE'],
    'shipowner_account_state values wrong (missing original GHOST/INVITED/ACTIVE)';
END $$;

-- shipowners table
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='shipowners' AND table_schema='public'),
    'shipowners table missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='shipowners' AND column_name='official_email_source'),
    'shipowners.official_email_source missing';
END $$;

-- owner_agent_mappings table + unique constraint
DO $$
DECLARE v_owner UUID;
DECLARE v_profile UUID;
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='owner_agent_mappings' AND table_schema='public'),
    'owner_agent_mappings table missing';

  -- Round-trip: insert, then duplicate insert should fail on UNIQUE
  INSERT INTO public.shipowners (name) VALUES ('Test Owner') RETURNING id INTO v_owner;

  -- profiles.id has FK to auth.users(id), so use a seeded demo profile.
  -- The seed.sql creates demo.agent@... (UUID 0000...0003). If seeds have not
  -- been loaded, fall back to the first profile of any role.
  SELECT id INTO v_profile FROM public.profiles WHERE role='SHIPPING_AGENT' LIMIT 1;
  IF v_profile IS NULL THEN
    SELECT id INTO v_profile FROM public.profiles LIMIT 1;
  END IF;
  ASSERT v_profile IS NOT NULL,
    'no profile available for test; run supabase db reset to load seed.sql';

  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id, valid_from)
  VALUES (v_owner, v_profile, CURRENT_DATE);

  BEGIN
    INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id, valid_from)
    VALUES (v_owner, v_profile, CURRENT_DATE);
    RAISE EXCEPTION 'unique constraint on (shipowner_id,agent_profile_id,valid_from) should have fired';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

-- vessels.shipowner_id and vessels.last_zone columns
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='vessels' AND column_name='shipowner_id'),
    'vessels.shipowner_id missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name='vessels' AND column_name='last_zone'),
    'vessels.last_zone missing';
END $$;

ROLLBACK;
