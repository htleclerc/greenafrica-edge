-- Test 071: GreenGate v8 Foundation — tenant + mode discriminators (additive)
BEGIN;

-- 1. transport_mode enum exists with MARITIME + AIR
DO $$
DECLARE vals TEXT[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder) INTO vals
    FROM pg_enum WHERE enumtypid = 'public.transport_mode'::regtype;
  IF NOT vals @> ARRAY['MARITIME','AIR'] THEN
    RAISE EXCEPTION 'TEST FAILED: transport_mode missing values, got %', vals;
  END IF;
END $$;

-- 2. Somaliland seeded as tenant #1 with the fixed id, ACTIVE, POOL
DO $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.jurisdictions WHERE code = 'SO';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: Somaliland jurisdiction not seeded'; END IF;
  IF r.id <> '00000000-0000-4000-8000-00000000534f'::uuid THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland fixed id mismatch, got %', r.id;
  END IF;
  IF r.status <> 'ACTIVE' OR r.data_plane <> 'POOL' THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland status/data_plane wrong (% / %)', r.status, r.data_plane;
  END IF;
  IF NOT (r.locales @> ARRAY['so','ar','en']::TEXT[]) THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland locales should include so/ar/en, got %', r.locales;
  END IF;
END $$;

-- 3. methodologies seeded (IMO maritime + ICAO LTO air)
DO $$
BEGIN
  PERFORM 1 FROM public.methodologies WHERE mode='MARITIME' AND code='IMO_MEPC_364_79';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: IMO methodology not seeded'; END IF;
  PERFORM 1 FROM public.methodologies WHERE mode='AIR' AND code='ICAO_LTO';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: ICAO LTO methodology not seeded'; END IF;
END $$;

-- 4. activation matrix: Somaliland MARITIME enabled, AIR present-but-disabled
DO $$
DECLARE maritime_on BOOLEAN; air_on BOOLEAN;
BEGIN
  SELECT enabled INTO maritime_on FROM public.jurisdiction_mode_config
    WHERE jurisdiction_id='00000000-0000-4000-8000-00000000534f' AND mode='MARITIME';
  SELECT enabled INTO air_on FROM public.jurisdiction_mode_config
    WHERE jurisdiction_id='00000000-0000-4000-8000-00000000534f' AND mode='AIR';
  IF maritime_on IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland MARITIME should be enabled, got %', maritime_on;
  END IF;
  IF air_on IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland AIR should be present-but-disabled, got %', air_on;
  END IF;
END $$;

-- 5. discriminator columns exist with the Somaliland-backfill DEFAULT + mode default
DO $$
DECLARE def TEXT;
BEGIN
  -- transactions.jurisdiction_id default references Somaliland id
  SELECT column_default INTO def FROM information_schema.columns
    WHERE table_schema='public' AND table_name='transactions' AND column_name='jurisdiction_id';
  IF def IS NULL OR def NOT LIKE '%00000000-0000-4000-8000-00000000534f%' THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.jurisdiction_id default not Somaliland, got %', def;
  END IF;
  -- transactions.mode default = MARITIME
  SELECT column_default INTO def FROM information_schema.columns
    WHERE table_schema='public' AND table_name='transactions' AND column_name='mode';
  IF def IS NULL OR def NOT LIKE '%MARITIME%' THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.mode default not MARITIME, got %', def;
  END IF;
  -- arrival_alerts gets jurisdiction_id, mode, distance_m
  PERFORM 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='arrival_alerts' AND column_name IN ('jurisdiction_id','mode','distance_m');
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
        AND table_name='arrival_alerts' AND column_name IN ('jurisdiction_id','mode','distance_m')) <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED: arrival_alerts missing one of jurisdiction_id/mode/distance_m';
  END IF;
  -- vessels gets jurisdiction_id
  PERFORM 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='vessels' AND column_name='jurisdiction_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: vessels.jurisdiction_id missing'; END IF;
END $$;

-- 6. shipowners.applicable_modes defaults to {MARITIME} (operator generalisation 5A)
DO $$
DECLARE modes public.transport_mode[]; sid UUID;
BEGIN
  INSERT INTO public.shipowners (name) VALUES ('Mode Default Test') RETURNING id INTO sid;
  SELECT applicable_modes INTO modes FROM public.shipowners WHERE id = sid;
  IF modes IS DISTINCT FROM ARRAY['MARITIME']::public.transport_mode[] THEN
    RAISE EXCEPTION 'TEST FAILED: applicable_modes default should be {MARITIME}, got %', modes;
  END IF;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

-- 7. current_jurisdiction_ids() helper exists, STABLE, SECURITY DEFINER, returns uuid[]
DO $$
DECLARE r RECORD;
BEGIN
  SELECT p.provolatile, p.prosecdef, pg_get_function_result(p.oid) AS rettype INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='current_jurisdiction_ids';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAILED: current_jurisdiction_ids() missing'; END IF;
  IF r.provolatile <> 's' THEN RAISE EXCEPTION 'TEST FAILED: helper should be STABLE'; END IF;
  IF NOT r.prosecdef THEN RAISE EXCEPTION 'TEST FAILED: helper should be SECURITY DEFINER'; END IF;
  IF r.rettype <> 'uuid[]' THEN RAISE EXCEPTION 'TEST FAILED: helper should return uuid[], got %', r.rettype; END IF;
END $$;

-- 8. RLS enabled on the new control-plane tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['jurisdictions','methodologies','jurisdiction_mode_config','user_jurisdictions'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.'||t)::regclass) THEN
      RAISE EXCEPTION 'TEST FAILED: RLS not enabled on public.%', t;
    END IF;
  END LOOP;
END $$;

ROLLBACK;
SELECT '071 GreenGate foundation tenancy: PASS' AS test_result;
