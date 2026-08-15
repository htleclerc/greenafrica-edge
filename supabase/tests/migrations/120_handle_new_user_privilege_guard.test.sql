-- Test 120 : handle_new_user() ne dérive aucun privilège des métadonnées
-- fournies par le client. Le rôle ne fait autorité que depuis
-- raw_app_meta_data (API admin / service_role) ; raw_user_meta_data
-- (`options.data` du signup PUBLIC) n'est accepté que pour l'allowlist sans
-- privilège, et n'active jamais un compte.
--
-- CE QUE CES ASSERTIONS EXERCENT RÉELLEMENT
-- ─────────────────────────────────────────
-- Chaque cas insère dans auth.users et lit la ligne public.profiles que le
-- trigger on_auth_user_created (mig 001) vient de semer. C'est le VRAI chemin
-- du trigger :
--   • un trigger FOR EACH ROW se déclenche pour tout rôle Postgres, superuser
--     compris — seuls ALTER TABLE … DISABLE TRIGGER ou session_replication_role
--     l'en empêchent (la mig 100 doit d'ailleurs DISABLE explicitement le
--     trigger append-only de audit_logs pour faire son backfill) ;
--   • le test 119 repose déjà sur ce fait en CI verte : il commence par
--     supprimer « le profil que le trigger a déjà inséré » ;
--   • le corps de handle_new_user() ne lit QUE NEW.id, NEW.email,
--     NEW.raw_user_meta_data et NEW.raw_app_meta_data. Poser ces colonnes dans
--     un INSERT reproduit donc exactement l'état que GoTrue présente au
--     trigger en production — il n'y a aucune autre entrée à simuler.
--
-- CE QU'ELLES N'EXERCENT PAS, ET POURQUOI CE N'EST PAS TESTABLE ICI
-- ────────────────────────────────────────────────────────────────
-- Que GoTrue route bien `options.data` de signUp() vers raw_user_meta_data, et
-- `app_metadata` de l'API admin vers raw_app_meta_data, relève de GoTrue et non
-- de Postgres : aucune assertion SQL ne peut le prouver. Ce point est établi
-- par lecture du SDK installé (@supabase/auth-js 2.98.0), cité dans l'en-tête
-- de la migration 120 : GenerateLinkOptions.data est documenté « maps to the
-- auth.users.raw_user_meta_data column », et AdminUserAttributes.app_metadata
-- « maps to the auth.users.app_metadata column ». La frontière de privilège
-- testée ici est donc celle des DEUX COLONNES, qui est la seule que la base
-- puisse voir et défendre.
BEGIN;

-- ── a) FAILLE PRINCIPALE : un rôle staff présenté par le canal CLIENT n'est
--        jamais honoré. C'est exactement le payload qu'un inconnu peut poster
--        sur /auth/v1/signup (ouvert en prod, mig 091) ─────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'attacker-superadmin@test',
  jsonb_build_object('full_name', 'Mallory', 'role', 'SUPERADMIN', 'is_active', true)
);

DO $$
DECLARE v_role public.user_role;
        v_active BOOLEAN;
BEGIN
  SELECT role, is_active INTO v_role, v_active
    FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

  ASSERT v_role IS NOT NULL, 'TEST FAILED : le trigger n''a pas créé de profil — le reste du test ne prouverait rien';

  -- Exigence 1 : aucun profil privilégié.
  ASSERT v_role <> 'SUPERADMIN',
    'TEST FAILED : un signup public portant role=SUPERADMIN a produit un profil SUPERADMIN (élévation de privilège)';
  ASSERT v_role = 'SHIPOWNER',
    format('TEST FAILED : repli attendu SHIPOWNER (moindre privilège), trouvé %s', v_role);

  -- Exigence 2 : pas d'auto-approbation.
  ASSERT v_active = FALSE,
    'TEST FAILED : un signup public portant is_active=true s''est auto-approuvé';
END $$;

-- ── b) Même refus pour les autres rôles staff, un par un. Une allowlist qui
--        ne laisserait passer QUE SUPERADMIN par erreur serait invisible en
--        (a) — d'où l'énumération explicite ─────────────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000002', 'attacker-po@test',
   jsonb_build_object('role', 'PORT_OFFICER')),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'attacker-fa@test',
   jsonb_build_object('role', 'FINANCE_ADMIN')),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'attacker-mgr@test',
   jsonb_build_object('role', 'MANAGER')),
  ('bbbbbbbb-0000-0000-0000-000000000005', 'attacker-agent@test',
   jsonb_build_object('role', 'SHIPPING_AGENT'));

DO $$
DECLARE v_leaked TEXT;
BEGIN
  SELECT string_agg(format('%s→%s', email, role), ', ')
    INTO v_leaked
    FROM public.profiles
   WHERE id IN (
           'bbbbbbbb-0000-0000-0000-000000000002',
           'bbbbbbbb-0000-0000-0000-000000000003',
           'bbbbbbbb-0000-0000-0000-000000000004',
           'bbbbbbbb-0000-0000-0000-000000000005')
     AND role <> 'SHIPOWNER';

  ASSERT v_leaked IS NULL,
    format('TEST FAILED : des rôles staff du canal client ont été honorés : %s', v_leaked);

  -- Le compte doit exister : sans ce contrôle, un trigger qui n'insérerait
  -- plus rien du tout ferait passer l'assertion ci-dessus pour de mauvaises
  -- raisons.
  ASSERT (SELECT count(*) FROM public.profiles WHERE id IN (
           'bbbbbbbb-0000-0000-0000-000000000002',
           'bbbbbbbb-0000-0000-0000-000000000003',
           'bbbbbbbb-0000-0000-0000-000000000004',
           'bbbbbbbb-0000-0000-0000-000000000005')) = 4,
    'TEST FAILED : les quatre profils auraient dû être créés';
END $$;

-- ── c) is_active du canal client n'active jamais, quel que soit le rôle —
--        y compris avec le rôle allowlisté et sans aucun rôle ────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000006', 'selfapprove-owner@test',
   jsonb_build_object('role', 'SHIPOWNER', 'is_active', true)),
  ('bbbbbbbb-0000-0000-0000-000000000007', 'selfapprove-norole@test',
   jsonb_build_object('is_active', true));

DO $$
DECLARE v_active_count INT;
BEGIN
  SELECT count(*) INTO v_active_count
    FROM public.profiles
   WHERE id IN ('bbbbbbbb-0000-0000-0000-000000000006',
                'bbbbbbbb-0000-0000-0000-000000000007')
     AND is_active;

  ASSERT v_active_count = 0,
    format('TEST FAILED : %s profil(s) activé(s) depuis raw_user_meta_data — l''approbation est contournable', v_active_count);
END $$;

-- ── d) LA PAIRE DISCRIMINANTE : même libellé de rôle, deux canaux, deux
--        résultats. Elle prouve que le correctif tient à la COLONNE et non au
--        libellé — retirer la branche app_metadata fait échouer ce cas,
--        retirer le filtrage du canal client fait échouer (a) ────────────────
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES (
  'bbbbbbbb-0000-0000-0000-000000000008',
  'server-superadmin@test',
  jsonb_build_object('provider', 'email', 'role', 'SUPERADMIN', 'is_active', true)
);

DO $$
DECLARE v_role public.user_role;
        v_active BOOLEAN;
BEGIN
  SELECT role, is_active INTO v_role, v_active
    FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000008';

  ASSERT v_role = 'SUPERADMIN',
    format('TEST FAILED : raw_app_meta_data (canal service_role) doit faire autorité sur le rôle, trouvé %s', v_role);
  ASSERT v_active = TRUE,
    'TEST FAILED : raw_app_meta_data doit pouvoir activer le compte (bootstrap SUPERADMIN, fixtures, seed.sql)';
END $$;

-- ── e) EXIGENCE 3 : le rattachement armateur (requestVesselAccessCode →
--        generateLink data:{role:'SHIPOWNER'}) produit bien un SHIPOWNER.
--
--        Note d'honnêteté : 'SHIPOWNER' étant AUSSI le repli de moindre
--        privilège, ce cas seul ne distingue pas « allowlist honorée » de
--        « repli appliqué ». Ce qu'il verrouille réellement, et qui est
--        l'enjeu de sécurité, c'est la NON-RÉGRESSION vers PORT_OFFICER : le
--        rôle qui, via la policy « Users see relevant audit logs » (mig 100),
--        ouvrirait à un armateur auto-rattaché les audit_logs non tagués de
--        toute la plateforme. Le caractère discriminant du canal, lui, est
--        prouvé par la paire (a)+(d). ─────────────────────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'bbbbbbbb-0000-0000-0000-000000000009',
  'owner-selfclaim@test',
  jsonb_build_object('role', 'SHIPOWNER')
);

DO $$
DECLARE v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-000000000009';

  ASSERT v_role <> 'PORT_OFFICER',
    'TEST FAILED : le rattachement armateur retombe sur PORT_OFFICER — régression mig 100 (lecture des audit_logs non tagués)';
  ASSERT v_role = 'SHIPOWNER',
    format('TEST FAILED : le rattachement armateur doit produire un SHIPOWNER, trouvé %s', v_role);
END $$;

-- ── f) EXIGENCE 4 : l'invitation staff continue de fonctionner. Reproduit
--        actions/inviteStaff.ts : invite avec un rôle staff en
--        user_metadata (désormais ignoré du trigger), PUIS upsert explicite du
--        profil par un client service_role. L'état final doit être le rôle
--        staff, actif. ────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (
  'bbbbbbbb-0000-0000-0000-00000000000a',
  'invited-staff@test',
  jsonb_build_object('full_name', 'Invited Officer', 'role', 'FINANCE_ADMIN')
);

INSERT INTO public.profiles (id, email, full_name, role, is_active)
VALUES ('bbbbbbbb-0000-0000-0000-00000000000a', 'invited-staff@test',
        'Invited Officer', 'FINANCE_ADMIN', TRUE)
ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role, is_active = EXCLUDED.is_active, full_name = EXCLUDED.full_name;

DO $$
DECLARE v_role public.user_role;
        v_active BOOLEAN;
BEGIN
  SELECT role, is_active INTO v_role, v_active
    FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000a';

  ASSERT v_role = 'FINANCE_ADMIN',
    format('TEST FAILED : l''upsert service_role de l''invitation staff doit poser le rôle, trouvé %s', v_role);
  ASSERT v_active = TRUE,
    'TEST FAILED : l''invitation staff doit rester activante via son upsert';
END $$;

-- ── g) Un libellé hors enum ne fait plus échouer la création du compte.
--        L'ancien `(raw_user_meta_data->>'role')::public.user_role` levait
--        22P02 ; le trigger étant AFTER INSERT sur auth.users, l'exception
--        faisait échouer l'INSERT lui-même — `options.data={role:'x'}`
--        suffisait à casser /auth/v1/signup. Si la régression revenait, c'est
--        l'INSERT ci-dessous qui lèverait, et ON_ERROR_STOP=1 ferait échouer
--        le fichier. ──────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data) VALUES (
  'bbbbbbbb-0000-0000-0000-00000000000b',
  'garbage-role@test',
  jsonb_build_object('role', 'ROOT'),
  jsonb_build_object('role', 'NOT_A_ROLE_EITHER')
);

DO $$
DECLARE v_role public.user_role;
        v_active BOOLEAN;
BEGIN
  SELECT role, is_active INTO v_role, v_active
    FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000b';

  ASSERT v_role = 'SHIPOWNER',
    format('TEST FAILED : un rôle hors enum doit retomber sur SHIPOWNER, trouvé %s', v_role);
  ASSERT v_active = FALSE,
    'TEST FAILED : un rôle hors enum ne doit pas produire un compte actif';
END $$;

-- ── h) Aucune métadonnée du tout (invitations sans `data` :
--        registerShipowner, registerAirOperator, approveShipownerRegistration,
--        /auth/sl) : repli de moindre privilège, jamais un rôle staff ─────────
INSERT INTO auth.users (id, email) VALUES
  ('bbbbbbbb-0000-0000-0000-00000000000c', 'no-metadata@test');

DO $$
DECLARE v_role public.user_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = 'bbbbbbbb-0000-0000-0000-00000000000c';

  ASSERT v_role = 'SHIPOWNER',
    format('TEST FAILED : sans métadonnée, le repli doit être SHIPOWNER et non un rôle staff, trouvé %s', v_role);
END $$;

DO $$ BEGIN RAISE NOTICE 'mig 120 : toutes les assertions passent'; END $$;

ROLLBACK;
SELECT '120_handle_new_user_privilege_guard: PASS' AS test_result;
