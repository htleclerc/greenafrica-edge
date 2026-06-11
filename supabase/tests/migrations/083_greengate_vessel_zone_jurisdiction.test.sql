-- Test 083: GreenGate v8 Wedge 2 — vessel zone jurisdiction column
BEGIN;

-- 1. Column exists with correct type (uuid) and is nullable.
DO $$
DECLARE
  col_type     TEXT;
  col_nullable TEXT;
BEGIN
  SELECT c.data_type, c.is_nullable
    INTO col_type, col_nullable
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name   = 'vessels'
     AND c.column_name  = 'last_zone_jurisdiction_id';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: vessels.last_zone_jurisdiction_id column missing';
  END IF;
  IF col_type <> 'uuid' THEN
    RAISE EXCEPTION 'TEST FAILED: last_zone_jurisdiction_id should be uuid, got %', col_type;
  END IF;
  IF col_nullable <> 'YES' THEN
    RAISE EXCEPTION 'TEST FAILED: last_zone_jurisdiction_id should be nullable, got %', col_nullable;
  END IF;
END $$;

-- 2. FK references public.jurisdictions(id).
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = rc.constraint_name
     AND kcu.constraint_schema = rc.constraint_schema
   WHERE rc.constraint_schema        = 'public'
     AND kcu.table_name              = 'vessels'
     AND kcu.column_name             = 'last_zone_jurisdiction_id'
     AND rc.unique_constraint_schema = 'public';
  IF cnt = 0 THEN
    RAISE EXCEPTION 'TEST FAILED: last_zone_jurisdiction_id has no FK referential constraint';
  END IF;
END $$;

-- 3. NULL is accepted (INTERNATIONAL zone / legacy rows).
DO $$
DECLARE vid UUID;
BEGIN
  INSERT INTO public.vessels
    (imo_number, mmsi, name, call_sign, flag_code, category,
     gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status,
     last_zone, last_zone_jurisdiction_id)
  VALUES
    ('TEST-083-NULL','999083001','MV 083 NULL','T083N','SO','CARGO',
     1000,500,10.0,'APPROACHING','INTERNATIONAL',NULL)
  RETURNING id INTO vid;
  IF vid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: insert with NULL last_zone_jurisdiction_id failed';
  END IF;
END $$;

-- 4. A valid jurisdiction UUID is accepted (FK check).
DO $$
DECLARE vid UUID;
BEGIN
  INSERT INTO public.vessels
    (imo_number, mmsi, name, call_sign, flag_code, category,
     gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status,
     last_zone, last_zone_jurisdiction_id)
  VALUES
    ('TEST-083-JID','999083002','MV 083 JID','T083J','SO','CARGO',
     1000,500,10.0,'APPROACHING','EEZ','00000000-0000-4000-8000-00000000534f')
  RETURNING id INTO vid;
  IF vid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: insert with valid jurisdiction_id failed';
  END IF;
END $$;

-- 5. An unknown UUID is rejected by the FK.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessels
      (imo_number, mmsi, name, call_sign, flag_code, category,
       gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status,
       last_zone, last_zone_jurisdiction_id)
    VALUES
      ('TEST-083-BAD','999083003','MV 083 BAD','T083B','SO','CARGO',
       1000,500,10.0,'APPROACHING','EEZ','ffffffff-ffff-4fff-bfff-ffffffffffff');
    RAISE EXCEPTION 'TEST FAILED: expected FK violation for unknown jurisdiction_id but insert succeeded';
  EXCEPTION
    WHEN foreign_key_violation THEN
      -- expected
  END;
END $$;

ROLLBACK;
SELECT '083 vessel zone jurisdiction: PASS' AS test_result;
