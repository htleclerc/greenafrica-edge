-- Test 074: aviation data foundation — structure + cross-tenant aircraft isolation
BEGIN;

-- ── Part 1: structural ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.aircraft') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: table public.aircraft is missing';
  END IF;
  IF to_regclass('public.air_emission_factors') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: table public.air_emission_factors is missing';
  END IF;

  PERFORM 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='aircraft'
      AND column_name IN ('icao24','registration','icao_type','engine_type',
                          'mtow_kg','operator_id','jurisdiction_id','compliance_status')
    GROUP BY table_name HAVING count(*) = 8;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: aircraft is missing one or more expected columns';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.aircraft'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: RLS not enabled on aircraft';
  END IF;

  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
        WHERE polname = 'operators + staff see aircraft'
          AND polrelid = 'public.aircraft'::regclass) NOT LIKE '%current_jurisdiction_ids%' THEN
    RAISE EXCEPTION 'TEST FAILED: aircraft SELECT policy lacks the jurisdiction filter';
  END IF;

  IF (SELECT count(*) FROM public.air_emission_factors) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED: air_emission_factors seed is empty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polname = 'anyone reads air emission factors'
                    AND polrelid = 'public.air_emission_factors'::regclass) THEN
    RAISE EXCEPTION 'TEST FAILED: air_emission_factors read policy missing';
  END IF;
END $$;

-- ── Part 2: behavioral cross-tenant isolation (a Somaliland officer must not see
--           another jurisdiction's aircraft). Mirrors the mig-073 test. ────────
DO $$
DECLARE
  so_jid  UUID := '00000000-0000-4000-8000-00000000534f';
  tst_jid UUID := '11111111-1111-4111-8111-111111111111';
  user_a  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST', 'Test Country', 'ACTIVE') ON CONFLICT (code) DO NOTHING;
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('6O-SO1', 'A320', so_jid);
  INSERT INTO public.aircraft (registration, icao_type, jurisdiction_id)
    VALUES ('TST-AC1', 'A320', tst_jid);

  INSERT INTO auth.users (id, email) VALUES (user_a, 'a@air-isolation.test') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (user_a, 'a@air-isolation.test', 'Officer A', 'PORT_OFFICER', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
    VALUES (user_a, so_jid) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_a::text)::text, true);
  SET LOCAL ROLE authenticated;

  IF EXISTS (SELECT 1 FROM public.aircraft WHERE jurisdiction_id = tst_jid) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer can see a TST-jurisdiction aircraft (cross-tenant leak)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.aircraft WHERE jurisdiction_id = so_jid) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer cannot see their own-jurisdiction aircraft';
  END IF;

  RESET ROLE;
END $$;

ROLLBACK;
SELECT '074 GreenGate aviation data foundation: PASS' AS test_result;
