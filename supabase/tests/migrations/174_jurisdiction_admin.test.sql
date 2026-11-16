-- Test 174 : l'administrateur d'un pays agit dans son pays, et seulement là ;
-- il ne se donne ni ne donne le droit d'administrer.
BEGIN;

DO $$
DECLARE
  so_jid   UUID := '00000000-0000-4000-8000-00000000534f';   -- Somaliland (pré-seedé)
  tst_jid  UUID := '17417417-1111-4111-8111-111111111111';
  cadmin   UUID := 'a1740000-0000-4000-8000-000000000001';   -- PORT_OFFICER, administre SO
  officer  UUID := 'a1740000-0000-4000-8000-000000000002';   -- PORT_OFFICER, SO, sans droit
  cadmin2  UUID := 'a1740000-0000-4000-8000-000000000003';   -- MANAGER, administre SO aussi
  foreigner UUID := 'a1740000-0000-4000-8000-000000000004';  -- FINANCE_ADMIN, autre pays
  newbie   UUID := 'a1740000-0000-4000-8000-000000000005';   -- MANAGER, aucun rattachement
  agent    UUID := 'a1740000-0000-4000-8000-000000000006';   -- SHIPPING_AGENT : pas du personnel
  retired  UUID := 'a1740000-0000-4000-8000-000000000007';   -- administre SO, compte inactif
  cnt      INT;
  blocked  BOOLEAN;
BEGIN
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST174', 'Test Country 174', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;

  INSERT INTO auth.users (id, email) VALUES
    (cadmin, 'cadmin174@admin.test'), (officer, 'officer174@admin.test'),
    (cadmin2, 'cadmin2-174@admin.test'), (foreigner, 'foreigner174@admin.test'),
    (newbie, 'newbie174@admin.test'), (agent, 'agent174@admin.test'),
    (retired, 'retired174@admin.test')
    ON CONFLICT DO NOTHING;
  DELETE FROM public.profiles WHERE id IN (cadmin, officer, cadmin2, foreigner, newbie, agent, retired);
  INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
    (cadmin,    'cadmin174@admin.test',    'Country Admin 174',  'PORT_OFFICER',   true),
    (officer,   'officer174@admin.test',   'Officer 174',        'PORT_OFFICER',   true),
    (cadmin2,   'cadmin2-174@admin.test',  'Country Admin2 174', 'MANAGER',        true),
    (foreigner, 'foreigner174@admin.test', 'Foreigner 174',      'FINANCE_ADMIN',  true),
    (newbie,    'newbie174@admin.test',    'Newbie 174',         'MANAGER',        true),
    (agent,     'agent174@admin.test',     'Agent 174',          'SHIPPING_AGENT', true),
    (retired,   'retired174@admin.test',   'Retired 174',        'PORT_OFFICER',   false);
  DELETE FROM public.user_jurisdictions WHERE user_id IN (cadmin, officer, cadmin2, foreigner, newbie, agent, retired);
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id, is_admin) VALUES
    (cadmin, so_jid, true), (officer, so_jid, false), (cadmin2, so_jid, true),
    (foreigner, tst_jid, false), (retired, so_jid, true);

  -- ── Un agent sans le droit n'invite personne ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', officer::text)::text, true);
  SET LOCAL ROLE authenticated;
  blocked := false;
  BEGIN
    INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (newbie, so_jid);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un agent sans le droit a rattaché quelqu''un'; END IF;

  -- Il ne lit que ses propres rattachements : ni ceux de ses collègues, ni qui
  -- administre quoi.
  SELECT count(*) INTO cnt FROM public.user_jurisdictions WHERE user_id <> officer;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un agent lit % rattachement(s) qui ne sont pas les siens', cnt; END IF;
  SELECT count(*) INTO cnt FROM public.user_jurisdictions WHERE user_id = officer;
  IF cnt <> 1 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un agent ne lit plus son propre rattachement'; END IF;
  RESET ROLE;

  -- ── Un compte inactif n'administre plus rien ───────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', retired::text)::text, true);
  SET LOCAL ROLE authenticated;
  IF cardinality(public.admin_jurisdiction_ids()) <> 0 THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un compte inactif administre encore un pays';
  END IF;
  RESET ROLE;

  -- ── L'administrateur du pays ───────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cadmin::text)::text, true);
  SET LOCAL ROLE authenticated;

  IF public.admin_jurisdiction_ids() <> ARRAY[so_jid] THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAILED: pays administrés inattendus';
  END IF;

  -- Il lit les rattachements de SON pays, pas ceux d'un autre.
  SELECT count(*) INTO cnt FROM public.user_jurisdictions WHERE user_id = officer AND jurisdiction_id = so_jid;
  IF cnt <> 1 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: l''administrateur du pays ne lit pas son personnel'; END IF;
  SELECT count(*) INTO cnt FROM public.user_jurisdictions WHERE jurisdiction_id = tst_jid;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: l''administrateur d''un pays lit le personnel d''un autre'; END IF;

  -- Rattacher du personnel à SON pays : oui.
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (newbie, so_jid);

  -- À un autre pays : non.
  blocked := false;
  BEGIN
    INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (newbie, tst_jid);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: rattachement à un autre pays accepté'; END IF;

  -- Créer un autre administrateur : non.
  DELETE FROM public.user_jurisdictions WHERE user_id = newbie AND jurisdiction_id = so_jid;
  blocked := false;
  BEGIN
    INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id, is_admin) VALUES (newbie, so_jid, true);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un administrateur de pays en a créé un autre'; END IF;

  -- Promouvoir un collègue, ou soi-même dans la durée : sans effet.
  UPDATE public.user_jurisdictions SET is_admin = true WHERE user_id = officer;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un administrateur de pays a promu un collègue'; END IF;

  -- Rattacher quelqu'un qui n'est pas du personnel : non.
  blocked := false;
  BEGIN
    INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (agent, so_jid);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: un agent maritime a été rattaché comme personnel'; END IF;

  -- Retirer un autre administrateur, se retirer soi-même, retirer dans un
  -- autre pays : sans effet.
  DELETE FROM public.user_jurisdictions WHERE user_id IN (cadmin2, cadmin, foreigner);
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % rattachement(s) protégés supprimés', cnt; END IF;

  -- Retirer un agent de SON pays : oui.
  DELETE FROM public.user_jurisdictions WHERE user_id = officer AND jurisdiction_id = so_jid;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 1 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: l''administrateur du pays n''a pas pu retirer un agent'; END IF;

  RESET ROLE;

  -- ── Tarifs : la fonction est appelée par l'application, avec l'acteur ──────
  -- L'administrateur du pays, dans son pays : oui.
  PERFORM * FROM public.create_tariff_version(so_jid, 'MARITIME', 'TEST_174', 12.5,
                                              CURRENT_DATE + 30, 'TEST-174', cadmin);
  -- Dans un autre pays : non.
  blocked := false;
  BEGIN
    PERFORM * FROM public.create_tariff_version(tst_jid, 'MARITIME', 'TEST_174', 12.5,
                                                CURRENT_DATE + 30, 'TEST-174', cadmin);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'TEST FAILED: tarif d''un autre pays modifié par un administrateur de pays'; END IF;
  -- Un compte inactif, même administrateur : non.
  blocked := false;
  BEGIN
    PERFORM * FROM public.create_tariff_version(so_jid, 'MARITIME', 'TEST_174B', 12.5,
                                                CURRENT_DATE + 30, 'TEST-174', retired);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'TEST FAILED: tarif modifié par un compte inactif'; END IF;
END $$;

SELECT '174 jurisdiction admin: PASS' AS test_result;
ROLLBACK;
