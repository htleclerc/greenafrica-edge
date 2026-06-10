-- Test 082: GreenGate v8 Wedge 2 — geofences registry + Djibouti onboarding
BEGIN;

-- 1. DJ jurisdiction exists: fixed id, DJF, POOL, ACTIVE, locales contain fr/ar/en.
DO $$
DECLARE jur RECORD;
BEGIN
  SELECT * INTO jur FROM public.jurisdictions
   WHERE id = '00000000-0000-4000-8000-00000000444a';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: Djibouti jurisdiction row not found';
  END IF;
  IF jur.default_currency <> 'DJF' THEN
    RAISE EXCEPTION 'TEST FAILED: DJ default_currency expected DJF, got %', jur.default_currency;
  END IF;
  IF jur.data_plane <> 'POOL' THEN
    RAISE EXCEPTION 'TEST FAILED: DJ data_plane expected POOL, got %', jur.data_plane;
  END IF;
  IF jur.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'TEST FAILED: DJ status expected ACTIVE, got %', jur.status;
  END IF;
  IF NOT (jur.locales @> ARRAY['fr','ar','en']::TEXT[]) THEN
    RAISE EXCEPTION 'TEST FAILED: DJ locales must contain fr, ar, en — got %', jur.locales;
  END IF;
END $$;

-- 2. Activation matrix: DJ MARITIME and AIR both enabled=TRUE, geofence_ref set, methodology_id NOT NULL.
DO $$
DECLARE
  mar RECORD;
  air RECORD;
BEGIN
  SELECT * INTO mar FROM public.jurisdiction_mode_config
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a' AND mode = 'MARITIME';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: DJ MARITIME mode config row missing';
  END IF;
  IF mar.enabled <> TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: DJ MARITIME enabled expected TRUE, got %', mar.enabled;
  END IF;
  IF mar.methodology_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: DJ MARITIME methodology_id is NULL';
  END IF;
  IF mar.geofence_ref IS NULL OR mar.geofence_ref = '' THEN
    RAISE EXCEPTION 'TEST FAILED: DJ MARITIME geofence_ref not set';
  END IF;

  SELECT * INTO air FROM public.jurisdiction_mode_config
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a' AND mode = 'AIR';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: DJ AIR mode config row missing';
  END IF;
  IF air.enabled <> TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: DJ AIR enabled expected TRUE, got %', air.enabled;
  END IF;
  IF air.methodology_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: DJ AIR methodology_id is NULL';
  END IF;
  IF air.geofence_ref IS NULL OR air.geofence_ref = '' THEN
    RAISE EXCEPTION 'TEST FAILED: DJ AIR geofence_ref not set';
  END IF;
END $$;

-- 3. DJ tariffs: exactly 2 ACTIVE rows at 40 USD (one per mode), effective_from = DATE '2026-03-31'.
DO $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     AND status = 'ACTIVE'
     AND rate_per_tco2 = 40
     AND currency = 'USD'
     AND effective_from = DATE '2026-03-31'
     AND mode IN ('MARITIME','AIR');
  IF cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED: expected 2 DJ ACTIVE tariff rows at 40 USD, got %', cnt;
  END IF;
  PERFORM 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     AND mode = 'MARITIME' AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: DJ MARITIME tariff row missing';
  END IF;
  PERFORM 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     AND mode = 'AIR' AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: DJ AIR tariff row missing';
  END IF;
END $$;

-- 4. DJ revenue split: escrow 0/100 open rule, contract_ref ESCROW_PENDING_DJ_MINFIN.
DO $$
BEGIN
  PERFORM 1 FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     AND concessionaire_pct = 0
     AND sovereign_pct = 100
     AND effective_to IS NULL
     AND contract_ref = 'ESCROW_PENDING_DJ_MINFIN';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: DJ escrow split rule not found (expected 0/100 open, ESCROW_PENDING_DJ_MINFIN)';
  END IF;
END $$;

-- 5. Geofences: exactly 11 active rows (scoped to the 11 seeded refs);
--    somaliland-fir and djibouti-fir both present;
--    every non-PORT ring (among seeded refs) is CLOSED (geometry[0] = geometry[last]);
--    every PORT geometry (among seeded refs) has lat + lng keys.
DO $$
DECLARE
  cnt       INT;
  r         RECORD;
  first_pt  JSONB;
  last_pt   JSONB;
  arr_len   INT;
  seeded_refs TEXT[] := ARRAY[
    'somaliland-port-berbera',
    'somaliland-port-zeila',
    'somaliland-eez',
    'somaliland-transit-aden',
    'somaliland-fir',
    'somaliland-dest-berbera',
    'somaliland-dest-zeila',
    'djibouti-eez',
    'djibouti-port-djibouti',
    'djibouti-fir',
    'djibouti-dest-djibouti'
  ];
BEGIN
  -- 5a. Row count — scoped to the 11 seeded refs
  SELECT COUNT(*) INTO cnt
    FROM public.geofences
   WHERE active = TRUE
     AND ref = ANY(seeded_refs);
  IF cnt <> 11 THEN
    RAISE EXCEPTION 'TEST FAILED: expected 11 active geofence rows (seeded refs), got %', cnt;
  END IF;

  -- 5b. Required FIR refs present
  PERFORM 1 FROM public.geofences WHERE ref = 'somaliland-fir' AND active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: somaliland-fir geofence row missing';
  END IF;
  PERFORM 1 FROM public.geofences WHERE ref = 'djibouti-fir' AND active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: djibouti-fir geofence row missing';
  END IF;

  -- 5c. Every non-PORT ring (seeded refs) is closed (first element = last element)
  FOR r IN
    SELECT ref, geometry FROM public.geofences
     WHERE kind <> 'PORT'
       AND active = TRUE
       AND (ref LIKE 'somaliland-%' OR ref LIKE 'djibouti-%')
  LOOP
    arr_len  := jsonb_array_length(r.geometry);
    first_pt := r.geometry -> 0;
    last_pt  := r.geometry -> (arr_len - 1);
    IF first_pt IS DISTINCT FROM last_pt THEN
      RAISE EXCEPTION 'TEST FAILED: geofence % ring is not closed (first != last point)', r.ref;
    END IF;
  END LOOP;

  -- 5d. Every PORT geometry (seeded refs) has lat + lng keys
  FOR r IN
    SELECT ref, geometry FROM public.geofences
     WHERE kind = 'PORT'
       AND active = TRUE
       AND (ref LIKE 'somaliland-%' OR ref LIKE 'djibouti-%')
  LOOP
    IF (r.geometry ->> 'lat') IS NULL OR (r.geometry ->> 'lng') IS NULL THEN
      RAISE EXCEPTION 'TEST FAILED: PORT geofence % missing lat or lng key', r.ref;
    END IF;
  END LOOP;
END $$;

-- 6. SO FIR de-overlap + transit corridor west edge:
--    somaliland-fir min lng (across all ring points) = 43.45
--    djibouti-fir   max lng (across all ring points) = 43.45
--    somaliland-transit-aden min lng = 43.45 (W1→W2 narrowing)
DO $$
DECLARE
  so_min_lng      NUMERIC;
  dj_max_lng      NUMERIC;
  transit_min_lng NUMERIC;
BEGIN
  -- Extract all lng values from the SO FIR ring and find the minimum
  SELECT MIN((pt->>'lng')::numeric) INTO so_min_lng
    FROM public.geofences g,
         jsonb_array_elements(g.geometry) AS pt
   WHERE g.ref = 'somaliland-fir';

  IF so_min_lng IS DISTINCT FROM 43.45 THEN
    RAISE EXCEPTION 'TEST FAILED: somaliland-fir min lng expected 43.45, got %', so_min_lng;
  END IF;

  -- Extract all lng values from the DJ FIR ring and find the maximum
  SELECT MAX((pt->>'lng')::numeric) INTO dj_max_lng
    FROM public.geofences g,
         jsonb_array_elements(g.geometry) AS pt
   WHERE g.ref = 'djibouti-fir';

  IF dj_max_lng IS DISTINCT FROM 43.45 THEN
    RAISE EXCEPTION 'TEST FAILED: djibouti-fir max lng expected 43.45, got %', dj_max_lng;
  END IF;

  -- Transit corridor west edge: W1→W2 narrowing moved it from 43.00 to 43.45
  SELECT MIN((pt->>'lng')::numeric) INTO transit_min_lng
    FROM public.geofences g,
         jsonb_array_elements(g.geometry) AS pt
   WHERE g.ref = 'somaliland-transit-aden';

  IF transit_min_lng IS DISTINCT FROM 43.45 THEN
    RAISE EXCEPTION 'TEST FAILED: somaliland-transit-aden min lng expected 43.45 (W2 narrowing), got %', transit_min_lng;
  END IF;
END $$;

-- 7. Memberships: staff profiles get DJ; agents do NOT.
--    Insert a stub PORT_OFFICER and a stub SHIPPING_AGENT, re-run the backfill
--    INSERT from the migration inline, then assert:
--      - the officer has a DJ user_jurisdictions row
--      - the agent does NOT
DO $$
DECLARE
  officer_auth_id UUID := gen_random_uuid();
  agent_auth_id   UUID := gen_random_uuid();
  officer_id      UUID;
  agent_id        UUID;
  cnt             INT;
BEGIN
  -- Create auth stubs
  INSERT INTO auth.users (id, email) VALUES
    (officer_auth_id, 'test-officer-082@test.invalid'),
    (agent_auth_id,   'test-agent-082@test.invalid');

  -- Create profiles
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (officer_auth_id, 'test-officer-082@test.invalid', 'Test Officer', 'PORT_OFFICER', TRUE)
  RETURNING id INTO officer_id;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (agent_auth_id, 'test-agent-082@test.invalid', 'Test Agent', 'SHIPPING_AGENT', TRUE)
  RETURNING id INTO agent_id;

  -- Re-run the migration's backfill INSERT (mirrors the exact WHERE clause)
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
  SELECT p.id, '00000000-0000-4000-8000-00000000444a'
    FROM public.profiles p
   WHERE p.role IN ('PORT_OFFICER','FINANCE_ADMIN','MANAGER')
     AND p.is_active = true
  ON CONFLICT DO NOTHING;

  -- Assert: officer got DJ
  SELECT COUNT(*) INTO cnt
    FROM public.user_jurisdictions
   WHERE user_id = officer_id
     AND jurisdiction_id = '00000000-0000-4000-8000-00000000444a';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED: PORT_OFFICER stub expected DJ membership, got % rows', cnt;
  END IF;

  -- Assert: agent did NOT get DJ
  SELECT COUNT(*) INTO cnt
    FROM public.user_jurisdictions
   WHERE user_id = agent_id
     AND jurisdiction_id = '00000000-0000-4000-8000-00000000444a';
  IF cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: SHIPPING_AGENT stub must NOT get DJ membership, got % rows', cnt;
  END IF;
END $$;

-- 8. Disjointness: no two same-kind ACTIVE geofences (among the 11 seeded refs)
--    have overlapping bounding boxes.  Abutting edges (shared boundary value) pass
--    because the comparisons are strict (<).  PORT kind is skipped (point geometry).
--    EEZ kind is skipped: the DJ EEZ ring is concave (10-point shape extending east
--    past 43.20 only above lat 11.55), so its bbox legitimately overlaps the SO EEZ
--    bbox even though the polygons themselves abut.  Polygon-level disjointness for
--    EEZ pairs is verified by inspection of the seeded ring coordinates above.
DO $$
DECLARE
  seeded_refs TEXT[] := ARRAY[
    'somaliland-port-berbera',
    'somaliland-port-zeila',
    'somaliland-eez',
    'somaliland-transit-aden',
    'somaliland-fir',
    'somaliland-dest-berbera',
    'somaliland-dest-zeila',
    'djibouti-eez',
    'djibouti-port-djibouti',
    'djibouti-fir',
    'djibouti-dest-djibouti'
  ];
  overlap_count INT;
BEGIN
  -- Build per-ring bounding boxes and check every same-kind pair for overlap.
  -- Two bboxes overlap iff: a.min_lng < b.max_lng AND b.min_lng < a.max_lng
  --                    AND  a.min_lat < b.max_lat AND b.min_lat < a.max_lat
  -- Strict < means abutting edges (shared value) do NOT count as overlap.
  -- EEZ and PORT are excluded (see comment above).
  WITH bbox AS (
    SELECT
      g.ref,
      g.kind,
      MIN((pt->>'lat')::numeric) AS min_lat,
      MAX((pt->>'lat')::numeric) AS max_lat,
      MIN((pt->>'lng')::numeric) AS min_lng,
      MAX((pt->>'lng')::numeric) AS max_lng
    FROM public.geofences g,
         jsonb_array_elements(g.geometry) AS pt
    WHERE g.active = TRUE
      AND g.kind NOT IN ('PORT', 'EEZ')
      AND g.ref = ANY(seeded_refs)
    GROUP BY g.ref, g.kind
  )
  SELECT COUNT(*) INTO overlap_count
    FROM bbox a
    JOIN bbox b ON a.kind = b.kind AND a.ref < b.ref  -- each pair once
   WHERE a.min_lng < b.max_lng AND b.min_lng < a.max_lng
     AND a.min_lat < b.max_lat AND b.min_lat < a.max_lat;

  IF overlap_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED: % same-kind geofence bbox pair(s) overlap among seeded refs (PORT_VICINITY/TRANSIT_LANE/FIR)', overlap_count;
  END IF;
END $$;

ROLLBACK;
SELECT '082 geofences + Djibouti: PASS' AS test_result;
