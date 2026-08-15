-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 119 : verrou colonnes privilégiées sur l'auto-mise à jour du profil
--
-- FAILLE (pré-existante, non introduite par cette branche ; PO a demandé le
-- correctif) : la policy RLS "Users can update own profile" (mig 001) est
--
--   FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)
--
-- Le commentaire de la mig 001 affirme "chaque user peut mettre à jour son
-- propre profil (sauf le rôle)" — mais rien ne l'applique : WITH CHECK ne
-- restreint QUE la ligne visée (elle doit rester la sienne), jamais les
-- colonnes modifiées. Aucune migration ultérieure ne resserre cette policy
-- (021/101/108 ne touchent que les policies de LECTURE) et aucun GRANT
-- colonne par colonne ne limite l'UPDATE. Tout utilisateur authentifié peut
-- donc, dès /signup (self-service armateur/agent, mig 091, EN PROD) :
--
--   PATCH /rest/v1/profiles?id=eq.<self>  { "role": "SUPERADMIN" }
--   PATCH /rest/v1/profiles?id=eq.<self>  { "is_active": true }
--
-- — s'auto-promouvoir SUPERADMIN, ou contourner l'approbation staff prévue
-- par handle_new_user() (mig 001 : is_active = false par défaut à l'inscription).
--
-- POURQUOI UN TRIGGER (pas une policy resserrée)
-- ───────────────────────────────────────────────
-- RLS ne sait pas exprimer « ces colonnes ne changent pas » : WITH CHECK ne
-- voit que la ligne NEW finale, jamais une comparaison colonne par colonne
-- face à OLD. Un trigger BEFORE UPDATE est le seul outil du moteur qui
-- compare explicitement NEW à OLD par colonne — pattern déjà utilisé par la
-- mig 089 (transactions_fiscal_immutable_guard) pour la même raison.
--
-- CHEMINS LÉGITIMES VÉRIFIÉS (grep -rn "from('profiles')" frontend/src, puis
-- inspection de chaque site qui appelle .update()/.upsert() sur profiles) —
-- AUCUN ne doit casser :
--   • frontend/src/app/api/auth/approve/route.ts — UPDATE is_active=true,
--     via createPlatformClient() (lib/supabase/tenant.ts) → service_role.
--   • frontend/src/actions/anonymizeOwner.ts — UPDATE email/full_name (RGPD
--     Art. 17), via createTenantClient()/createPlatformClient() → service_role.
--   • frontend/src/actions/registerAirOperator.ts,
--     frontend/src/actions/inviteShipowner.ts,
--     frontend/src/actions/approveShipownerRegistration.ts,
--     frontend/src/actions/registerShipowner.ts — UPSERT profiles (role,
--     is_active compris) via createPlatformClient()/createTenantClient() →
--     service_role. Un UPSERT dont la ligne existe déjà exécute un UPDATE
--     (INSERT … ON CONFLICT DO UPDATE) et déclenche donc CE trigger comme
--     n'importe quel UPDATE.
--   Les quatre clients ci-dessus sont mintés UNIQUEMENT par
--   lib/supabase/tenant.ts avec SUPABASE_SERVICE_ROLE_KEY (un lint ESLint
--   interdit l'usage brut de cette clé ailleurs) — ils s'exécutent tous côté
--   Postgres sous le rôle service_role. Aucun autre call site du frontend ne
--   fait `.from('profiles').update(...)` avec un client de session
--   (createClient() côté navigateur/serveur) : les seules lectures de
--   profiles via ce client sont des SELECT (RoleContext.tsx, LoginPage.tsx).
--
--   IMPORTANT : contrairement à RLS, un trigger s'exécute pour TOUT rôle
--   Postgres, y compris service_role (RLS bypass ≠ trigger bypass — le
--   BYPASSRLS du rôle service_role ne dispense d'aucun trigger). D'où le
--   garde-fou explicite `auth.role() = 'service_role'` ci-dessous : sans lui,
--   les quatre chemins listés plus haut échoueraient tous.
--
-- RÉCURSION : public.get_user_role() (mig 001) est SECURITY DEFINER — son
-- SELECT interne sur profiles s'exécute avec les droits du propriétaire de la
-- fonction et ne repasse donc PAS par la RLS de profiles (la mig 021 documente
-- déjà ce pattern precis pour casser une récursion RLS profiles↔profiles).
-- Un simple SELECT ne déclenche par ailleurs jamais un trigger BEFORE UPDATE
-- — appeler get_user_role() depuis ce trigger ne peut donc ni recourir à RLS
-- ni reboucler sur lui-même.
--
-- COLONNES PROTÉGÉES : role, is_active (la faille exploitée), plus id et
-- email (défense en profondeur — email doit rester synchronisé avec
-- auth.users ; id est la PK référencée par auth.users(id) ON DELETE CASCADE).
--
-- CHEMIN PRÉSERVÉ : un SUPERADMIN courant (seul rôle que la policy
-- "Superadmin can update any profile", mig 001/021, laisse toucher la ligne
-- d'un AUTRE utilisateur via RLS) reste libre de modifier ces colonnes — sans
-- ce garde-fou, aucune promotion/rétrogradation manuelle depuis l'app ne
-- serait plus jamais possible.
--
-- CORRECTIF POST-CI (même migration, jamais déployée ailleurs qu'en CI
-- éphémère avant ce correctif — éditée en place plutôt qu'une 120) : la
-- première version bloquait aussi toute session SANS contexte JWT (auth.uid()
-- NULL — migrations, fixtures de tests SQL directes), cassant
-- 082_greengate_geofences_djibouti.test.sql, 084_greengate_create_tariff_
-- version_rpc.test.sql et 088_greengate_tariff_invariants.test.sql, qui
-- posent is_active sur des profils en session psql superuser nue (aucun
-- SET request.jwt.claims). Ajout d'un bypass explicite auth.uid() IS NULL,
-- voir sa justification inline dans la fonction ci-dessous.
--
-- DOWN:
--   DROP TRIGGER IF EXISTS profiles_privileged_column_guard ON public.profiles;
--   DROP FUNCTION IF EXISTS public.profiles_privileged_column_guard();
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.profiles_privileged_column_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Aucun contexte JWT du tout (session psql brute : migrations, fixtures de
  -- tests SQL, tout client qui ne passe pas par PostgREST) : auth.uid() est
  -- NULL. Le vecteur protégé exige un utilisateur AUTHENTIFIÉ modifiant SA
  -- PROPRE ligne (auth.uid() non NULL et = id — la condition même de la
  -- policy "Users can update own profile", mig 001) ; sans JWT il n'y a
  -- personne à qui refuser un privilège, et RLS elle-même n'accorderait
  -- jamais l'accès en écriture à une session avec auth.uid() NULL (ni "Users
  -- can update own profile" ni "Superadmin can update any profile" ne
  -- peuvent être vraies avec un id NULL) — donc cette branche n'ouvre rien
  -- qu'un attaquant via PostgREST pourrait atteindre : l'API REST fournit
  -- toujours un JWT (même la clé anon en est un), donc y compris un appel
  -- anon a request.jwt.claims posé (juste sans "sub"), tandis qu'un vrai
  -- superuser/service Postgres direct n'en a aucun.
  --
  -- auth.uid() (fourni par la plateforme, hors dépôt) lit
  -- current_setting(clé, true) — le second argument "missing_ok" lui fait
  -- renvoyer NULL plutôt que lever une erreur quand le paramètre est absent ;
  -- ce IF est donc sûr même hors contexte de requête. Vérifié empiriquement
  -- par l'échec CI initial : les fixtures 082/084/088 (SET is_active en session
  -- psql superuser nue, sans aucun SET request.jwt.claims) remontaient bien
  -- l'exception métier "is_active cannot be self-updated" — pas une erreur
  -- bas niveau de paramètre de configuration manquant — la preuve qu'auth.uid()
  -- s'est résolu proprement en NULL plutôt que de lever.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- service_role (admin API routes, crons, scripts — tous mintés via
  -- lib/supabase/tenant.ts) : déjà RLS-bypass, ne pas re-restreindre ici sous
  -- peine de casser l'approbation staff, l'anonymisation RGPD et les upserts
  -- d'inscription/invitation.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Un SUPERADMIN courant reste libre de modifier ces colonnes, y compris sur
  -- la ligne d'un autre utilisateur (chemin de promotion/rétrogradation).
  IF public.get_user_role()::text = 'SUPERADMIN' THEN
    RETURN NEW;
  END IF;

  -- Tout le reste n'a pu atteindre ce trigger, pour la ligne d'un AUTRE
  -- utilisateur, qu'en violant déjà la RLS ("Superadmin can update any
  -- profile" exige SUPERADMIN) — donc en pratique cette branche ne voit que
  -- l'auto-mise à jour (auth.uid() = id, policy "Users can update own
  -- profile"). C'est exactement le chemin de la faille : verrouiller les
  -- colonnes porteuses de privilège.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'profiles: role cannot be self-updated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'profiles: is_active cannot be self-updated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'profiles: id cannot be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'profiles: email cannot be self-updated — it must stay in sync with auth.users'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_privileged_column_guard() IS
'Mig 119 : bloque l''auto-élévation de privilège sur profiles. La policy RLS
"Users can update own profile" (mig 001) autorise auth.uid() = id sans
restriction de colonne — ce trigger verrouille role/is_active/id/email sur
ce chemin. service_role et SUPERADMIN (chemins staff prouvés) bypassent.';

CREATE TRIGGER profiles_privileged_column_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_privileged_column_guard();
