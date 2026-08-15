-- Test 119 : l'auto-mise à jour de son propre profil ne peut pas changer les
-- colonnes porteuses de privilège (role, is_active) — seul un SUPERADMIN
-- agissant sur un AUTRE compte, ou un client service_role, le peut encore.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'staff-self@test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'staff-admin@test');

-- Le trigger on_auth_user_created (mig 001) a déjà inséré un profil pour
-- chacun ; on le remplace pour poser des rôles et un is_active déterministes.
DELETE FROM public.profiles WHERE id IN (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000002'
);

-- is_active = FALSE sur le compte "self" : reproduit l'état réel d'un compte
-- fraîchement inscrit en attente d'approbation (mig 001, handle_new_user).
INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'staff-self@test',  'Staff Self',  'PORT_OFFICER', FALSE),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'staff-admin@test', 'Staff Admin', 'SUPERADMIN',   TRUE);

-- Contexte : utilisateur authentifié agissant sur SA PROPRE ligne (auth.uid() = id,
-- policy "Users can update own profile", mig 001).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- ── a) auto-élévation refusée : impossible de passer son propre role à
--        SUPERADMIN par UPDATE — c'est la faille corrigée par cette migration ──
DO $$
DECLARE
  v_error_msg TEXT := '';
  v_role      public.user_role;
BEGIN
  BEGIN
    UPDATE public.profiles SET role = 'SUPERADMIN'
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
  END;
  ASSERT v_error_msg <> '', 'TEST FAILED : auto-élévation du role aurait dû être refusée (aucune exception levée)';
  ASSERT v_error_msg LIKE '%role cannot be self-updated%',
    format('TEST FAILED : message d''erreur inattendu : %s', v_error_msg);

  SELECT role INTO v_role FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  ASSERT v_role = 'PORT_OFFICER', format('TEST FAILED : le role n''aurait pas dû changer, trouvé %s', v_role);
END $$;

-- ── b) même refus sur is_active : bloque le contournement de l'approbation
--        staff (handle_new_user pose is_active = false par défaut) ─────────────
DO $$
DECLARE v_error_msg TEXT := '';
        v_active    BOOLEAN;
BEGIN
  BEGIN
    UPDATE public.profiles SET is_active = TRUE
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
  END;
  ASSERT v_error_msg LIKE '%is_active cannot be self-updated%',
    format('TEST FAILED : message d''erreur inattendu : %s', v_error_msg);

  SELECT is_active INTO v_active FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  ASSERT v_active = FALSE, 'TEST FAILED : is_active n''aurait pas dû changer';
END $$;

-- ── c) auto-mise à jour bénigne toujours autorisée (colonne non protégée) ───
DO $$
DECLARE v_name TEXT;
BEGIN
  UPDATE public.profiles SET full_name = 'Staff Self Renamed'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  SELECT full_name INTO v_name FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  ASSERT v_name = 'Staff Self Renamed',
    'TEST FAILED : une auto-mise à jour bénigne (full_name) doit rester possible';
END $$;

-- ── d) un SUPERADMIN reste libre de promouvoir un AUTRE compte : chemin de
--        promotion/rétrogradation prévu (policy "Superadmin can update any
--        profile", mig 001/021) ne doit pas être cassé par ce trigger ────────
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}';

DO $$
DECLARE v_role public.user_role;
BEGIN
  UPDATE public.profiles SET role = 'FINANCE_ADMIN'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  SELECT role INTO v_role FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  ASSERT v_role = 'FINANCE_ADMIN',
    format('TEST FAILED : un SUPERADMIN doit pouvoir changer le role d''un autre compte, trouvé %s', v_role);
END $$;

-- ── e) le rôle service_role (clients admin mintés via lib/supabase/tenant.ts —
--        /api/auth/approve, inviteStaff, registerShipowner, etc., tous
--        service_role) reste libre de modifier role/is_active ──────────────
-- "sub" délibérément posé ICI (contrairement au (f) plus bas) : ça isole la
-- branche auth.role() = 'service_role' du trigger de la branche auth.uid()
-- IS NULL ajoutée par le correctif post-CI — sans "sub", ce cas se
-- confondrait avec (f) et ne prouverait plus rien de spécifique à
-- service_role. (En pratique un vrai JWT service_role ne porte pas de "sub" ;
-- on le synthétise seulement pour discriminer les deux bypass du trigger.)
SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"service_role"}';

DO $$
DECLARE v_active BOOLEAN;
BEGIN
  UPDATE public.profiles SET is_active = TRUE
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  SELECT is_active INTO v_active FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  ASSERT v_active = TRUE,
    'TEST FAILED : service_role doit pouvoir modifier is_active (chemin /api/auth/approve)';
END $$;

-- ── f) session sans AUCUN contexte JWT (psql superuser nu, comme une
--        fixture de migration/test qui pose is_active/role directement en
--        SQL — le scénario exact qui a cassé 082/084/088 avant ce correctif) :
--        doit rester libre, sans quoi ce trigger casse toute fixture SQL du
--        dépôt qui prépare un profil actif/rôlé sans passer par PostgREST ──
RESET ROLE;
SET LOCAL "request.jwt.claims" = '';

DO $$
DECLARE v_role public.user_role;
BEGIN
  UPDATE public.profiles SET role = 'SHIPPING_AGENT'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

  SELECT role INTO v_role FROM public.profiles WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  ASSERT v_role = 'SHIPPING_AGENT',
    format('TEST FAILED : une session sans contexte JWT (migrations/fixtures) doit pouvoir écrire role/is_active, trouvé %s', v_role);
END $$;

DO $$ BEGIN RAISE NOTICE 'mig 119 : toutes les assertions passent'; END $$;

ROLLBACK;
SELECT '119_profiles_self_update_column_guard: PASS' AS test_result;
