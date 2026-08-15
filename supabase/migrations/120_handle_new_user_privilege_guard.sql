-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 120 : handle_new_user() ne dérive plus de privilège des métadonnées
--                 fournies par le client (moitié CRÉATION de la faille 119)
--
-- FAILLE
-- ──────
-- handle_new_user() (mig 001, l.64-83) est un trigger AFTER INSERT ON auth.users
-- qui sème public.profiles. Il lit le rôle TEL QUEL dans raw_user_meta_data :
--
--   role = CASE WHEN NEW.raw_user_meta_data->>'role' IS NOT NULL AND <> ''
--               THEN (NEW.raw_user_meta_data->>'role')::public.user_role
--               ELSE 'PORT_OFFICER' END,
--   is_active = COALESCE((NEW.raw_user_meta_data->>'is_active')::boolean, false)
--
-- Or raw_user_meta_data est alimenté par `options.data` de l'endpoint PUBLIC et
-- NON AUTHENTIFIÉ POST /auth/v1/signup (clé anon), et l'inscription self-service
-- est ACTIVE en production (mig 091). Un inconnu pouvait donc créer un compte
-- portant role='SUPERADMIN' ET is_active=true dans le même appel — en
-- contournant l'approbation staff que le commentaire de la mig 001 décrit
-- pourtant lui-même (« is_active = false par défaut → le SUPERADMIN doit
-- approuver »).
--
-- La mig 119 ferme la moitié MISE À JOUR (s'auto-promouvoir après coup, par
-- PATCH sur profiles). Elle ne couvre pas celle-ci : son trigger est BEFORE
-- UPDATE, et le profil frauduleux naît ici déjà privilégié — aucun UPDATE n'est
-- nécessaire. Les deux moitiés sont indépendantes.
--
-- LE PRINCIPE : QUEL CANAL DE MÉTADONNÉES EST ÉCRIVABLE PAR LE CLIENT
-- ───────────────────────────────────────────────────────────────────
-- auth.users porte deux colonnes de métadonnées, et une seule est hors de
-- portée du client :
--
--   • raw_user_meta_data  ← `options.data` de signUp() (endpoint public, clé
--     anon), de inviteUserByEmail() et de generateLink(). CONTRÔLÉ PAR
--     L'ATTAQUANT dès lors que l'inscription publique est ouverte.
--   • raw_app_meta_data   ← uniquement `app_metadata` de l'API admin
--     (createUser / updateUserById), qui exige la clé service_role.
--     CONTRÔLÉ PAR LE SERVEUR.
--
-- D'où la règle appliquée ci-dessous :
--   1. raw_app_meta_data->>'role' fait autorité (canal serveur) ;
--   2. raw_user_meta_data->>'role' n'est accepté que s'il figure dans une
--      ALLOWLIST explicite de rôles SANS privilège ;
--   3. sinon → rôle par défaut de moindre privilège ;
--   4. is_active ne vient JAMAIS du canal client — seulement de
--      raw_app_meta_data, sinon FALSE.
--
-- VÉRIFIÉ CONTRE LE SDK RÉELLEMENT INSTALLÉ (@supabase/auth-js 2.98.0)
-- ────────────────────────────────────────────────────────────────────
-- Le canal app_metadata n'est PAS atteignable depuis tous les appels admin, ce
-- qui interdit un correctif « app_metadata uniquement » :
--   • createUser(AdminUserAttributes) — `app_metadata?: object` EXISTE
--     (node_modules/@supabase/auth-js/dist/module/lib/types.d.ts l.423).
--   • inviteUserByEmail(email, options) — la signature n'expose que
--     { data, redirectTo } et l'implémentation ne poste que
--     `body: { email, data: options.data }` (GoTrueAdminApi.js l.66-73) :
--     app_metadata INATTEIGNABLE.
--   • generateLink(params) — options typées
--     `Pick<GenerateLinkOptions, 'data' | 'redirectTo'>` (types.d.ts l.742-746),
--     et GenerateLinkOptions.data est documenté « maps to the
--     auth.users.raw_user_meta_data column » : app_metadata INATTEIGNABLE.
--
-- C'est donc l'ALLOWLIST (règle 2) qui porte le correctif pour le seul chemin
-- légitime qui dépende vraiment du trigger : voir ci-dessous.
--
-- TOUS LES CHEMINS DE CRÉATION D'UN auth.users, ET CE QU'ILS POSENT
-- ─────────────────────────────────────────────────────────────────
-- (grep -rn "signUp\|admin.createUser\|generateLink\|inviteUserByEmail" frontend/src)
-- Sept des huit font, APRÈS la création, un upsert EXPLICITE de public.profiles
-- via un client service_role (lib/supabase/tenant.ts) : pour eux le rôle semé
-- par ce trigger est transitoire et immédiatement corrigé. Ils sont donc
-- insensibles à cette migration — l'état final est identique, l'état
-- intermédiaire strictement moins privilégié.
--
--   1. actions/registerShipowner.ts (self-service maritime) — invite SANS
--      metadata, puis upsert {SHIPOWNER, is_active:true}.
--   2. actions/registerAirOperator.ts (self-service aérien) — idem.
--   3. actions/approveShipownerRegistration.ts — invite sans metadata, puis
--      upsert {SHIPOWNER, is_active:true}.
--   4. actions/inviteShipowner.ts — data {full_name, role:'SHIPOWNER'}, puis
--      upsert {SHIPOWNER, is_active:true}.
--   5. actions/inviteStaff.ts — data {full_name, role:<rôle staff>}, puis
--      upsert {<rôle staff>, is_active:true}. Le rôle staff passé en
--      user_metadata est désormais IGNORÉ par le trigger (non allowlisté) ;
--      l'upsert service_role le repose. Aucune régression.
--   6. app/api/admin/invite-armateur/route.ts — createUser user_metadata
--      {role:'SHIPPING_AGENT'}, puis upsert {SHIPPING_AGENT, is_active:true}.
--   7. app/api/auth/setup-admin/route.ts (bootstrap) — createUser
--      user_metadata {role:'SUPERADMIN', is_active:true}, puis upsert
--      {SUPERADMIN, is_active:true}. Le bootstrap reste fonctionnel par
--      l'upsert ; c'est aussi le call site qui POURRAIT passer app_metadata
--      (createUser le supporte) si on voulait un jour supprimer l'upsert.
--   8. app/auth/sl/route.ts — generateLink sans metadata, PAS d'upsert : ne
--      sert qu'à ouvrir une session pour un compte existant. Si l'e-mail
--      n'existe pas, GoTrue crée le compte : il naissait PORT_OFFICER, il naît
--      désormais SHIPOWNER. Durcissement net.
--
-- LE SEUL CHEMIN QUI DÉPEND VRAIMENT DU TRIGGER
-- ─────────────────────────────────────────────
--   actions/requestVesselAccessCode.ts — generateLink({type:'magiclink'},
--   data:{role:'SHIPOWNER', is_active:true}). Il n'a AUCUN upsert de profiles :
--   le rôle du compte auto-rattaché est celui que CE trigger sème. C'est
--   voulu et documenté sur place : sans le role, le trigger stampait
--   PORT_OFFICER, ce qui ouvrait à un armateur auto-rattaché la lecture des
--   audit_logs non tagués de TOUTE la plateforme (policy « Users see relevant
--   audit logs », mig 100 : PORT_OFFICER + jurisdiction_id IS NULL). Cette
--   régression a déjà été trouvée et corrigée sur cette branche ; l'allowlist
--   ci-dessous la garde fermée : 'SHIPOWNER' y figure, donc ce chemin continue
--   de produire un profil SHIPOWNER.
--
--   Son `is_active:true` n'est en revanche PLUS honoré ici (règle 4). Il est
--   reposé côté application, juste après generateLink, par un UPDATE
--   service_role filtré `.eq('role','SHIPOWNER')` — filtre qui rend l'écriture
--   incapable de rétrograder ou d'activer un compte staff préexistant portant
--   la même adresse. État final du parcours inchangé.
--
-- POURQUOI 'SHIPOWNER' COMME DÉFAUT (et non PORT_OFFICER)
-- ──────────────────────────────────────────────────────
-- PORT_OFFICER n'est pas un rôle neutre : c'est un rôle STAFF, cité
-- nommément par les policies de lecture des mig 004, 021 (« Admins can read
-- all profiles »), 022 et 100 (audit_logs, y compris les révélations d'IBAN
-- sur les lignes non taguées). En faire le repli d'un rôle ABSENT ou
-- INCONNU, c'est faire échouer le système vers le privilège.
--
-- SHIPOWNER est le libellé de moindre privilège de l'enum : AUCUNE policy ne
-- lui accorde quoi que ce soit sur le seul libellé. Toutes les policies
-- SHIPOWNER (mig 033, 039, 101) sont conjointes à
-- `shipowners.profile_id = auth.uid()` — mig 033 l.4 : « A shipowner with a
-- portal account (profile.role = SHIPOWNER AND shipowners.profile_id =
-- auth.uid()) ». Un profil SHIPOWNER sans ligne shipowners qui le pointe ne
-- lit donc rien d'autre que son propre profil. C'est exactement la propriété
-- attendue d'un défaut de moindre privilège.
--
-- EFFET DE BORD CORRIGÉ AU PASSAGE (déni de service sur l'inscription)
-- ───────────────────────────────────────────────────────────────────
-- L'ancien `(NEW.raw_user_meta_data->>'role')::public.user_role` levait
-- invalid_text_representation (22P02) sur n'importe quel texte hors enum. Ce
-- trigger étant AFTER INSERT sur auth.users, l'exception faisait échouer
-- l'INSERT lui-même : un simple `options.data = { role: 'x' }` suffisait à
-- faire retourner 500 à /auth/v1/signup. Les deux canaux sont désormais
-- validés par appartenance à enum_range() — plus aucun cast sur du texte
-- arbitraire.
--
-- CE QUE CETTE MIGRATION NE CHANGE PAS
-- ────────────────────────────────────
-- full_name (non porteur de privilège) garde sa résolution d'origine, et
-- `ON CONFLICT (id) DO NOTHING` est conservé tel quel. Le trigger
-- on_auth_user_created (mig 001) n'est pas recréé : CREATE OR REPLACE
-- FUNCTION suffit, le trigger pointe sur la fonction par son nom.
--
-- DOWN (restaure la version mig 001 — RÉOUVRE LA FAILLE, ne pas jouer) :
--   voir supabase/migrations/001_create_profiles.sql l.64-83.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    -- Allowlist des rôles acceptés depuis le canal CLIENT (raw_user_meta_data).
    -- Critère d'admission : le libellé seul n'accorde aucune lecture — toute
    -- policy qui le cite est conjointe à une appartenance (shipowners.profile_id
    -- = auth.uid()). Y ajouter un rôle staff rouvrirait la faille.
    c_client_allowed_roles CONSTANT TEXT[] := ARRAY['SHIPOWNER'];

    -- Repli de moindre privilège : rôle absent, vide, inconnu de l'enum, ou
    -- privilégié mais présenté par le canal client.
    c_least_privileged     CONSTANT public.user_role := 'SHIPOWNER';

    v_app_role  TEXT := NULLIF(NEW.raw_app_meta_data->>'role', '');
    v_meta_role TEXT := NULLIF(NEW.raw_user_meta_data->>'role', '');
    v_role      public.user_role;
    v_is_active BOOLEAN;
BEGIN
    -- ── 1. Canal SERVEUR : raw_app_meta_data fait autorité ───────────────────
    -- Seule l'API admin (clé service_role) peut écrire cette colonne ; un
    -- appelant capable de la poser peut déjà tout faire dans la base. On y
    -- accepte donc n'importe quel rôle de l'enum — mais on vérifie tout de
    -- même l'appartenance à enum_range() plutôt que de caster : un libellé
    -- hors enum ferait autrement échouer la création du compte (22P02).
    IF v_app_role IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(enum_range(NULL::public.user_role)) AS r
        WHERE r::TEXT = v_app_role
    ) THEN
        v_role := v_app_role::public.user_role;

    -- ── 2. Canal CLIENT : allowlist stricte ──────────────────────────────────
    -- raw_user_meta_data vient de `options.data` du signup public. On n'en
    -- accepte QUE des rôles sans privilège. `role:'SUPERADMIN'` y tombe donc
    -- dans le repli ci-dessous, pas dans cette branche.
    ELSIF v_meta_role = ANY (c_client_allowed_roles) THEN
        v_role := v_meta_role::public.user_role;

    -- ── 3. Repli de moindre privilège ────────────────────────────────────────
    ELSE
        v_role := c_least_privileged;
    END IF;

    -- ── 4. is_active : canal SERVEUR exclusivement ───────────────────────────
    -- Aucune valeur du canal client ne peut activer un compte — c'est le
    -- contournement de l'approbation staff décrit par la mig 001. Comparaison
    -- textuelle plutôt que ::boolean : `->>` rend le booléen JSON true sous la
    -- forme 'true', et un texte arbitraire ne peut ici lever aucune exception.
    v_is_active := COALESCE(NULLIF(NEW.raw_app_meta_data->>'is_active', '') = 'true', FALSE);

    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
        v_role,
        v_is_active
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.handle_new_user() IS
'Mig 120 : sème public.profiles à la création d''un auth.users sans jamais
dériver de privilège du canal client. Le rôle vient de raw_app_meta_data
(API admin / service_role uniquement) ; raw_user_meta_data (options.data du
signup PUBLIC) n''est accepté que pour une allowlist de rôles sans privilège
(SHIPOWNER). Tout le reste retombe sur SHIPOWNER, libellé de moindre
privilège. is_active ne vient que de raw_app_meta_data. Complète la mig 119,
qui ferme la moitié MISE À JOUR de la même élévation de privilège.';
