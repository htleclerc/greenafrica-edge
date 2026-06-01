-- Test 073: staff jurisdiction RLS filter — cross-tenant isolation (the Wedge-2 gate)
BEGIN;

-- ── Part 1: every rewritten policy carries the jurisdiction filter ───────────
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'transactions:Users see relevant transactions',
    'payments:payments_admin_select',
    'vessels:Shipping agents see own fleet',
    'arrival_alerts:admins read all alerts',
    'arrival_alerts:agents read UNCLAIMED alerts',
    'shipowners:admins full shipowners',
    'shipowners:agents read shipowners'
  ];
  e TEXT; tbl TEXT; pol TEXT; def TEXT;
BEGIN
  FOREACH e IN ARRAY expected LOOP
    tbl := split_part(e, ':', 1);
    pol := split_part(e, ':', 2);
    SELECT pg_get_expr(polqual, polrelid) INTO def
      FROM pg_policy WHERE polname = pol AND polrelid = ('public.' || tbl)::regclass;
    IF def IS NULL THEN
      RAISE EXCEPTION 'TEST FAILED: policy "%" on % is missing', pol, tbl;
    END IF;
    IF def NOT LIKE '%current_jurisdiction_ids%' THEN
      RAISE EXCEPTION 'TEST FAILED: policy "%" on % lacks the jurisdiction filter: %', pol, tbl, def;
    END IF;
  END LOOP;
END $$;

-- ── Part 2: behavioral cross-tenant isolation (a Somaliland officer must not see
--           another jurisdiction's data). Exercised on shipowners. ────────────
DO $$
DECLARE
  so_jid  UUID := '00000000-0000-4000-8000-00000000534f';
  tst_jid UUID := '11111111-1111-4111-8111-111111111111';
  user_a  UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
  -- 2nd jurisdiction + one shipowner in each
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST', 'Test Country', 'ACTIVE') ON CONFLICT (code) DO NOTHING;
  INSERT INTO public.shipowners (name, jurisdiction_id) VALUES ('Owner SO', so_jid);
  INSERT INTO public.shipowners (name, jurisdiction_id) VALUES ('Owner TST', tst_jid);

  -- Staff user A, member of Somaliland only.
  INSERT INTO auth.users (id, email) VALUES (user_a, 'a@isolation.test') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (user_a, 'a@isolation.test', 'Officer A', 'PORT_OFFICER', true) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
    VALUES (user_a, so_jid) ON CONFLICT DO NOTHING;

  -- Act as user A under RLS.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', user_a::text)::text, true);
  SET LOCAL ROLE authenticated;

  IF EXISTS (SELECT 1 FROM public.shipowners WHERE jurisdiction_id = tst_jid) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer can see a TST-jurisdiction shipowner (cross-tenant leak)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shipowners WHERE jurisdiction_id = so_jid) THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED: a Somaliland officer cannot see their own-jurisdiction shipowner';
  END IF;

  RESET ROLE;
END $$;

ROLLBACK;
SELECT '073 GreenGate staff RLS jurisdiction isolation: PASS' AS test_result;
