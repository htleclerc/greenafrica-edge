-- Test 173 : seul l'administrateur général écrit ce qui définit les pays ; le
-- personnel d'un pays n'écrit que les réglages de ses pays.
BEGIN;

DO $$
DECLARE
  so_jid   UUID := '00000000-0000-4000-8000-00000000534f';   -- Somaliland (pré-seedé)
  tst_jid  UUID := '17317317-1111-4111-8111-111111111111';
  officer  UUID := 'a1730000-0000-4000-8000-000000000001';   -- PORT_OFFICER, SO seulement
  finance  UUID := 'a1730000-0000-4000-8000-000000000002';   -- FINANCE_ADMIN, SO seulement
  manager  UUID := 'a1730000-0000-4000-8000-000000000003';   -- MANAGER, SO seulement
  admin    UUID := 'a1730000-0000-4000-8000-000000000004';   -- SUPERADMIN, aucun rattachement
  who      UUID;
  cnt      INT;
  blocked  BOOLEAN;
BEGIN
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST173', 'Test Country 173', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;

  INSERT INTO auth.users (id, email) VALUES
    (officer, 'officer173@lockdown.test'), (finance, 'finance173@lockdown.test'),
    (manager, 'manager173@lockdown.test'), (admin,   'admin173@lockdown.test')
    ON CONFLICT DO NOTHING;
  DELETE FROM public.profiles WHERE id IN (officer, finance, manager, admin);
  INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
    (officer, 'officer173@lockdown.test', 'Officer 173', 'PORT_OFFICER',  true),
    (finance, 'finance173@lockdown.test', 'Finance 173', 'FINANCE_ADMIN', true),
    (manager, 'manager173@lockdown.test', 'Manager 173', 'MANAGER',       true),
    (admin,   'admin173@lockdown.test',   'Admin 173',   'SUPERADMIN',    true);
  DELETE FROM public.user_jurisdictions WHERE user_id IN (officer, finance, manager, admin);
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES
    (officer, so_jid), (finance, so_jid), (manager, so_jid);

  -- ── Partie 1 : le personnel d'un pays ne s'ouvre pas un autre pays ─────────
  FOREACH who IN ARRAY ARRAY[officer, finance, manager] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who::text)::text, true);
    SET LOCAL ROLE authenticated;

    -- Se rattacher soi-même à l'autre pays.
    blocked := false;
    BEGIN
      INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (who, tst_jid);
    EXCEPTION WHEN insufficient_privilege THEN blocked := true;
    END;
    IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a pu se rattacher lui-même à un autre pays', who; END IF;

    -- Retirer son propre rattachement, ou celui d'un collègue : sans effet.
    DELETE FROM public.user_jurisdictions WHERE jurisdiction_id = so_jid;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a supprimé % rattachement(s)', who, cnt; END IF;

    -- Modifier ou supprimer un pays : sans effet.
    UPDATE public.jurisdictions SET name = 'pris' WHERE id IN (so_jid, tst_jid);
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a modifié % pays', who, cnt; END IF;
    DELETE FROM public.jurisdictions WHERE id = tst_jid;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a supprimé un pays', who; END IF;

    -- Créer un pays.
    blocked := false;
    BEGIN
      INSERT INTO public.jurisdictions (code, name, status) VALUES ('X173', 'Pays pirate', 'ACTIVE');
    EXCEPTION WHEN insufficient_privilege THEN blocked := true;
    END;
    IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a pu créer un pays', who; END IF;

    -- Ouvrir un mode dans un pays, même le sien.
    UPDATE public.jurisdiction_mode_config SET enabled = NOT enabled WHERE jurisdiction_id = so_jid;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a basculé % mode(s)', who, cnt; END IF;

    -- Réécrire un référentiel commun.
    UPDATE public.methodologies SET version = 'pris';
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a modifié % méthode(s)', who, cnt; END IF;
    UPDATE public.emission_factors SET source = source;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a modifié % facteur(s) d''émission', who, cnt; END IF;
    UPDATE public.air_emission_factors SET source = source;
    GET DIAGNOSTICS cnt = ROW_COUNT;
    IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % a modifié % facteur(s) aérien(s)', who, cnt; END IF;

    -- Il lit toujours ses propres rattachements : la lecture n'a pas changé.
    SELECT count(*) INTO cnt FROM public.user_jurisdictions WHERE user_id = who;
    IF cnt <> 1 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: % ne lit plus son propre rattachement', who; END IF;

    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'Partie 1 : agent, finance et manager ne peuvent ni s''ouvrir un pays ni toucher au pilotage — OK';

  -- ── Partie 2 : réglages d'un pays, par son personnel et pour lui seul ──────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', finance::text)::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.jurisdiction_billing_cc (jurisdiction_id, cc_emails) VALUES (so_jid, ARRAY['cc@so.test'])
    ON CONFLICT (jurisdiction_id) DO UPDATE SET cc_emails = EXCLUDED.cc_emails;

  blocked := false;
  BEGIN
    INSERT INTO public.jurisdiction_billing_cc (jurisdiction_id, cc_emails) VALUES (tst_jid, ARRAY['cc@pirate.test']);
  EXCEPTION WHEN insufficient_privilege THEN blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: copies de facturation écrites dans un autre pays'; END IF;

  -- Le profil d'émetteur par défaut de la plateforme n'est pas à lui.
  UPDATE public.jurisdiction_issuer_profile SET payment_terms_days = payment_terms_days WHERE jurisdiction_id IS NULL;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: profil d''émetteur par défaut modifié par un pays'; END IF;

  RESET ROLE;
  RAISE NOTICE 'Partie 2 : réglages d''un pays écrits par son personnel, pour lui seul — OK';

  -- ── Partie 3 : l'administrateur général, sans aucun rattachement ───────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin::text)::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (officer, tst_jid);
  UPDATE public.jurisdictions SET name = 'Test Country 173 bis' WHERE id = tst_jid;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 1 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: l''administrateur général ne peut pas modifier un pays'; END IF;
  INSERT INTO public.jurisdiction_billing_cc (jurisdiction_id, cc_emails) VALUES (tst_jid, ARRAY['cc@tst.test']);
  UPDATE public.jurisdiction_issuer_profile SET payment_terms_days = payment_terms_days WHERE jurisdiction_id IS NULL;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt <> 1 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: l''administrateur général ne peut pas modifier le profil d''émetteur par défaut (% ligne)', cnt; END IF;
  UPDATE public.methodologies SET version = version;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt = 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED: l''administrateur général ne peut pas modifier les méthodes'; END IF;

  RESET ROLE;
  RAISE NOTICE 'Partie 3 : l''administrateur général écrit tout, sans rattachement — OK';
END $$;

ROLLBACK;
SELECT '173 control plane write lockdown: PASS' AS test_result;
