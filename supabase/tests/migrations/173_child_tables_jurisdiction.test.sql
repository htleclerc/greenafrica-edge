-- Test 173 : les tables filles portent leur pays, et le personnel d'un pays ne
-- lit ni n'écrit celles d'un autre.
--
-- Trois tables servent de témoins, une par table mère :
--   exemptions            ← vessels
--   disputes              ← transactions
--   owner_agent_mappings  ← shipowners
-- La partie 1 vérifie la structure des neuf.
BEGIN;

-- ── Partie 1 : structure des neuf tables ─────────────────────────────────────
DO $$
DECLARE
  tables text[] := ARRAY[
    'collection_reminders', 'collections_event', 'dispute_intervals', 'disputes',
    'exemptions', 'inspections', 'owner_agent_mappings', 'owner_members', 'payment_proofs'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = t
                      AND column_name = 'jurisdiction_id' AND is_nullable = 'NO') THEN
      RAISE EXCEPTION 'TEST FAILED: %.jurisdiction_id absente ou facultative', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = ('public.' || t)::regclass
                      AND tgname = 'aa_stamp_jurisdiction' AND tgenabled <> 'D') THEN
      RAISE EXCEPTION 'TEST FAILED: déclencheur aa_stamp_jurisdiction absent ou désactivé sur %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = t
                      AND policyname = 'staff_jurisdiction_wall' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'TEST FAILED: cloison staff_jurisdiction_wall absente ou non restrictive sur %', t;
    END IF;
    -- Aucun déclencheur applicatif ne doit être resté suspendu après le remplissage.
    IF EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgrelid = ('public.' || t)::regclass AND NOT tgisinternal AND tgenabled = 'D') THEN
      RAISE EXCEPTION 'TEST FAILED: un déclencheur est resté désactivé sur %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'Partie 1 : colonne, déclencheur et cloison présents sur les 9 tables — OK';
END $$;

-- ── Parties 2 à 5 : comportement, sur deux pays ──────────────────────────────
DO $$
DECLARE
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';   -- Somaliland (pré-seedé)
  tst_jid   UUID := '17317317-1111-4111-8111-111111111111';
  officer   UUID := 'a1730000-0000-4000-8000-000000000001';   -- PORT_OFFICER, SO seulement
  admin     UUID := 'a1730000-0000-4000-8000-000000000002';   -- SUPERADMIN
  agent     UUID := 'a1730000-0000-4000-8000-000000000003';   -- SHIPPING_AGENT, sans pays
  manager   UUID := 'a1730000-0000-4000-8000-000000000004';   -- MANAGER, SO seulement
  so_own    UUID := 'b1730000-0000-4000-8000-000000000001';
  tst_own   UUID := 'b1730000-0000-4000-8000-000000000002';
  so_vsl    UUID := 'c1730000-0000-4000-8000-000000000001';
  tst_vsl   UUID := 'c1730000-0000-4000-8000-000000000002';
  so_txn    UUID := 'd1730000-0000-4000-8000-000000000001';
  tst_txn   UUID := 'd1730000-0000-4000-8000-000000000002';
  cnt       INT;
  stamped   UUID;
  blocked   BOOLEAN;
BEGIN
  -- Deux pays
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST173', 'Test Country 173', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;

  -- Trois utilisateurs
  INSERT INTO auth.users (id, email) VALUES
    (officer, 'officer173@isolation.test'),
    (admin,   'admin173@isolation.test'),
    (agent,   'agent173@isolation.test'),
    (manager, 'manager173@isolation.test')
    ON CONFLICT DO NOTHING;
  DELETE FROM public.profiles WHERE id IN (officer, admin, agent, manager);
  INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
    (officer, 'officer173@isolation.test', 'Officer 173', 'PORT_OFFICER',   true),
    (admin,   'admin173@isolation.test',   'Admin 173',   'SUPERADMIN',     true),
    (agent,   'agent173@isolation.test',   'Agent 173',   'SHIPPING_AGENT', true),
    (manager, 'manager173@isolation.test', 'Manager 173', 'MANAGER',        true);
  DELETE FROM public.user_jurisdictions WHERE user_id IN (officer, admin, agent, manager);
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES (officer, so_jid), (manager, so_jid);

  -- Une mère de chaque sorte par pays
  INSERT INTO public.shipowners (id, name, account_state, official_email, preferred_language, jurisdiction_id)
    VALUES (so_own,  'Owner SO 173',  'ACTIVE', 'so173@test',  'en', so_jid),
           (tst_own, 'Owner TST 173', 'ACTIVE', 'tst173@test', 'en', tst_jid);
  INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category,
                              gross_tonnage_dwt, engine_power_kw, design_speed_knots, jurisdiction_id)
    VALUES (so_vsl,  '1730173001', '173001001', 'Vessel SO 173',  'VSO173', 'SO', 'CARGO', 5000, 1000, 12.0, so_jid),
           (tst_vsl, '1730173002', '173001002', 'Vessel TST 173', 'VTT173', 'DJ', 'CARGO', 5000, 1000, 12.0, tst_jid);
  INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, transaction_type,
                                   emissions_tco2, tax_amount_usd, status, shipowner_id, jurisdiction_id)
    VALUES (so_txn,  so_vsl,  'Vessel SO 173',  '1730173001', 'ENTRY_TAX', 10.0, 100.0, 'PENDING', so_own,  so_jid),
           (tst_txn, tst_vsl, 'Vessel TST 173', '1730173002', 'ENTRY_TAX', 10.0, 100.0, 'PENDING', tst_own, tst_jid);

  -- ── Partie 2 : le pays est recopié de la mère, quoi que dise l'appelant ────
  -- Sans pays fourni.
  INSERT INTO public.exemptions (vessel_id, vessel_name, reason, valid_until, approved_by)
    VALUES (tst_vsl, 'Vessel TST 173', 'OTHER', CURRENT_DATE + 30, admin);
  SELECT jurisdiction_id INTO stamped FROM public.exemptions WHERE vessel_id = tst_vsl;
  IF stamped IS DISTINCT FROM tst_jid THEN
    RAISE EXCEPTION 'TEST FAILED (stamp): exemption du navire TST rangée dans % au lieu de TST', stamped;
  END IF;

  -- Avec un pays mensonger : la ligne TST déclarée SO doit rester TST.
  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id, jurisdiction_id)
    VALUES (tst_own, agent, so_jid);
  SELECT jurisdiction_id INTO stamped FROM public.owner_agent_mappings WHERE shipowner_id = tst_own;
  IF stamped IS DISTINCT FROM tst_jid THEN
    RAISE EXCEPTION 'TEST FAILED (stamp): pays mensonger accepté sur owner_agent_mappings (%)', stamped;
  END IF;

  -- Une modification ne déplace pas la ligne.
  UPDATE public.owner_agent_mappings SET jurisdiction_id = so_jid WHERE shipowner_id = tst_own;
  SELECT jurisdiction_id INTO stamped FROM public.owner_agent_mappings WHERE shipowner_id = tst_own;
  IF stamped IS DISTINCT FROM tst_jid THEN
    RAISE EXCEPTION 'TEST FAILED (stamp): une modification a déplacé la ligne vers %', stamped;
  END IF;

  -- Le reste des témoins, un par pays.
  INSERT INTO public.exemptions (vessel_id, vessel_name, reason, valid_until, approved_by)
    VALUES (so_vsl, 'Vessel SO 173', 'OTHER', CURRENT_DATE + 30, admin);
  INSERT INTO public.owner_agent_mappings (shipowner_id, agent_profile_id) VALUES (so_own, agent);
  INSERT INTO public.disputes (transaction_id, vessel_id, submitted_by, reason, description, original_amount_usd)
    VALUES (so_txn,  so_vsl,  admin, 'OTHER', 'litige SO 173',  100.0),
           (tst_txn, tst_vsl, admin, 'OTHER', 'litige TST 173', 100.0);
  SELECT jurisdiction_id INTO stamped FROM public.disputes WHERE transaction_id = tst_txn;
  IF stamped IS DISTINCT FROM tst_jid THEN
    RAISE EXCEPTION 'TEST FAILED (stamp): litige de la transaction TST rangé dans %', stamped;
  END IF;
  RAISE NOTICE 'Partie 2 : pays recopié de la mère, valeur de l''appelant ignorée — OK';

  -- ── Partie 3 : un agent du Somaliland ne voit pas l'autre pays ─────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', officer::text)::text, true);
  SET LOCAL ROLE authenticated;

  SELECT COUNT(*) INTO cnt FROM public.exemptions WHERE vessel_id = tst_vsl;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (exemptions): fuite vers un agent d''un autre pays'; END IF;
  SELECT COUNT(*) INTO cnt FROM public.exemptions WHERE vessel_id = so_vsl;
  IF cnt = 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (exemptions): l''agent ne voit plus son propre pays'; END IF;

  SELECT COUNT(*) INTO cnt FROM public.disputes WHERE transaction_id = tst_txn;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (disputes): fuite vers un agent d''un autre pays'; END IF;
  SELECT COUNT(*) INTO cnt FROM public.disputes WHERE transaction_id = so_txn;
  IF cnt = 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (disputes): l''agent ne voit plus son propre pays'; END IF;

  SELECT COUNT(*) INTO cnt FROM public.owner_agent_mappings WHERE shipowner_id = tst_own;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (owner_agent_mappings): fuite vers un agent d''un autre pays'; END IF;
  SELECT COUNT(*) INTO cnt FROM public.owner_agent_mappings WHERE shipowner_id = so_own;
  IF cnt = 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (owner_agent_mappings): l''agent ne voit plus son propre pays'; END IF;

  -- Il ne peut pas non plus écrire chez le voisin.
  blocked := false;
  BEGIN
    INSERT INTO public.exemptions (vessel_id, vessel_name, reason, valid_until, approved_by)
      VALUES (tst_vsl, 'Vessel TST 173', 'MILITARY', CURRENT_DATE + 30, officer);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (exemptions): écriture acceptée dans un autre pays'; END IF;

  -- …alors qu'il le peut dans le sien.
  INSERT INTO public.exemptions (vessel_id, vessel_name, reason, valid_until, approved_by)
    VALUES (so_vsl, 'Vessel SO 173', 'MILITARY', CURRENT_DATE + 30, officer);

  -- Modifier une ligne du voisin ne touche rien.
  UPDATE public.owner_agent_mappings SET priority = 1 WHERE shipowner_id = tst_own;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (owner_agent_mappings): modification acceptée dans un autre pays'; END IF;

  -- Rattacher une de SES lignes à une mère du voisin : le pays suit la mère, et
  -- la cloison refuse la ligne ainsi déplacée.
  blocked := false;
  BEGIN
    UPDATE public.owner_agent_mappings SET shipowner_id = tst_own WHERE shipowner_id = so_own;
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  IF NOT blocked THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (owner_agent_mappings): ligne déplacée vers un autre pays par changement de mère'; END IF;

  RESET ROLE;
  RAISE NOTICE 'Partie 3 : lecture et écriture cloisonnées pour un agent du Somaliland — OK';

  -- ── Partie 3 bis : autres rôles du personnel, et personnel sans pays ───────
  -- Un MANAGER du Somaliland est cloisonné comme l'agent.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', manager::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.owner_agent_mappings WHERE shipowner_id = tst_own;
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (MANAGER): fuite vers un manager d''un autre pays'; END IF;
  SELECT COUNT(*) INTO cnt FROM public.owner_agent_mappings WHERE shipowner_id = so_own;
  IF cnt = 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (MANAGER): le manager ne voit plus son propre pays'; END IF;
  RESET ROLE;

  -- Sans aucun pays rattaché, un membre du personnel ne voit rien : la cloison
  -- se ferme par défaut, elle ne s'ouvre pas.
  DELETE FROM public.user_jurisdictions WHERE user_id = officer;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', officer::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.owner_agent_mappings WHERE shipowner_id IN (so_own, tst_own);
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (sans pays): % ligne(s) visibles par un membre du personnel sans pays', cnt; END IF;
  SELECT COUNT(*) INTO cnt FROM public.exemptions WHERE vessel_id IN (so_vsl, tst_vsl);
  IF cnt > 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (sans pays): % exemption(s) visibles par un membre du personnel sans pays', cnt; END IF;
  RESET ROLE;
  RAISE NOTICE 'Partie 3 bis : manager cloisonné, personnel sans pays fermé par défaut — OK';

  -- Le journal de recouvrement refuse toute modification : son pays doit être
  -- posé dès l'insertion, et la table rester non modifiable.
  INSERT INTO public.collections_event (transaction_id, event_type, payload_hash)
    VALUES (tst_txn, 'ISSUED', 'hash-173');
  SELECT jurisdiction_id INTO stamped FROM public.collections_event WHERE transaction_id = tst_txn;
  IF stamped IS DISTINCT FROM tst_jid THEN
    RAISE EXCEPTION 'TEST FAILED (collections_event): événement de la transaction TST rangé dans %', stamped;
  END IF;
  blocked := false;
  BEGIN
    UPDATE public.collections_event SET event_type = 'ALTERED' WHERE transaction_id = tst_txn;
  EXCEPTION WHEN OTHERS THEN
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'TEST FAILED (collections_event): le journal est devenu modifiable'; END IF;
  RAISE NOTICE 'Partie 3 ter : journal de recouvrement tamponné et toujours non modifiable — OK';

  -- ── Partie 4 : un super-administrateur voit tous les pays ──────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.exemptions WHERE vessel_id IN (so_vsl, tst_vsl);
  IF cnt < 3 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (superadmin): % exemption(s) visibles sur 3', cnt; END IF;
  SELECT COUNT(*) INTO cnt FROM public.disputes WHERE transaction_id IN (so_txn, tst_txn);
  IF cnt <> 2 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (superadmin): % litige(s) visibles sur 2', cnt; END IF;
  RESET ROLE;
  RAISE NOTICE 'Partie 4 : le super-administrateur voit les deux pays — OK';

  -- ── Partie 5 : la cloison ne vise que le personnel ─────────────────────────
  -- L'agent maritime n'appartient à aucun pays ; ses propres correspondances lui
  -- restent lisibles dans les deux, par sa relation.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', agent::text)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO cnt FROM public.owner_agent_mappings WHERE agent_profile_id = agent;
  IF cnt <> 2 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (agent): % correspondance(s) visibles sur 2', cnt; END IF;
  RESET ROLE;
  RAISE NOTICE 'Partie 5 : un agent maritime garde l''accès à ses propres lignes — OK';
END $$;

ROLLBACK;
SELECT '173 child tables jurisdiction: PASS' AS test_result;
