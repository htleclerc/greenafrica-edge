-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — sous-permission « valider les encaissements »
-- Migration 130
--
-- BESOIN
-- Un MANAGER doit pouvoir valider les preuves de virement sans devenir
-- FINANCE_ADMIN — il perdrait son vision board (réservé MANAGER/SUPERADMIN) et
-- l'arbitrage recouvrement avait tranché : le découpage se fait par
-- sous-permission, jamais en élargissant un rôle ni en en créant un nouveau.
--
-- `profiles.role` est une colonne enum UNIQUE : un compte ne peut pas cumuler
-- MANAGER et FINANCE_ADMIN. D'où un drapeau additif, orthogonal au rôle.
--
-- SÉMANTIQUE
-- Le rail monétaire s'ouvre à : role ∈ {SUPERADMIN, FINANCE_ADMIN}  OU
-- can_settle_payments = true. Le drapeau n'enlève jamais rien — cocher la case
-- d'un FINANCE_ADMIN est un no-op, la décocher ne lui retire pas son accès.
--
-- SÉCURITÉ — pourquoi la colonne rejoint le verrou de la mig 119
-- La policy « Users can update own profile » (mig 001) autorise tout
-- utilisateur authentifié à modifier SA ligne, sans restriction de colonne ;
-- seul le trigger `profiles_privileged_column_guard` (mig 119) empêche
-- l'auto-élévation, colonne par colonne. Une colonne porteuse de privilège
-- ajoutée SANS y être inscrite est auto-attribuable par un simple
--   PATCH /rest/v1/profiles?id=eq.<self>  { "can_settle_payments": true }
-- depuis n'importe quel compte issu du /signup public. C'est exactement la
-- faille que 119 a fermée pour role/is_active — elle se rouvrirait ici.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Action d'audit dédiée ─────────────────────────────────────────────────
-- Déléguer le droit de valider un encaissement doit se relire dans le journal :
-- c'est la première chose qu'on cherche quand on remonte « qui a pu confirmer
-- ce paiement ». Aucune valeur existante ne dit ça (USER_CREATED ne couvre que
-- la création), d'où une valeur propre.
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SETTLEMENT_RIGHTS_UPDATED';

-- ── 1. La colonne ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_settle_payments BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.can_settle_payments IS
  'mig 130 : sous-permission additive « valider/rejeter les encaissements ». S''ajoute au rôle (SUPERADMIN et FINANCE_ADMIN passent par leur rôle, sans drapeau). Colonne privilégiée : verrouillée contre l''auto-mise à jour par le trigger de la mig 119.';

-- ── 2. Le verrou anti-auto-élévation (mig 119 étendue) ───────────────────────
-- Corps identique à la mig 119, plus le cas can_settle_payments. Les trois
-- portes de sortie anticipée (auth.uid() NULL, service_role, SUPERADMIN) sont
-- inchangées : ce sont les chemins staff prouvés par l'inventaire de la 119.
CREATE OR REPLACE FUNCTION public.profiles_privileged_column_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Session sans JWT (migrations, fixtures SQL) : personne à qui refuser un
  -- privilège, et RLS n'accorderait pas l'écriture avec auth.uid() NULL.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- service_role : routes admin, crons, scripts. Déjà RLS-bypass.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- SUPERADMIN : chemin de promotion/rétrogradation, y compris sur autrui.
  IF public.get_user_role()::text = 'SUPERADMIN' THEN
    RETURN NEW;
  END IF;

  -- Reste l'auto-mise à jour : verrouiller les colonnes de privilège.
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

  -- Nouveau (mig 130) : le drapeau ouvre le rail monétaire, il vaut privilège.
  IF NEW.can_settle_payments IS DISTINCT FROM OLD.can_settle_payments THEN
    RAISE EXCEPTION 'profiles: can_settle_payments cannot be self-updated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_privileged_column_guard() IS
'Mig 130 : can_settle_payments rejoint le verrou. Mig 119 : bloque l''auto-élévation sur profiles (role/is_active/id/email) — la policy RLS "Users can update own profile" (mig 001) autorise auth.uid() = id sans restriction de colonne. service_role et SUPERADMIN bypassent.';

-- ── 3. Garde SQL réutilisable ────────────────────────────────────────────────
-- Les politiques RLS et vues futures doivent parler la même règle que
-- l'applicatif ; une seconde définition divergerait au premier changement.
CREATE OR REPLACE FUNCTION public.can_settle_payments(p_profile_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT p.is_active
        AND (p.role IN ('SUPERADMIN'::public.user_role, 'FINANCE_ADMIN'::public.user_role)
             OR p.can_settle_payments)
       FROM public.profiles p
      WHERE p.id = p_profile_id),
    FALSE
  );
$$;

COMMENT ON FUNCTION public.can_settle_payments IS
  'mig 130 : droit de valider/rejeter un encaissement — rôle SUPERADMIN/FINANCE_ADMIN, ou sous-permission profiles.can_settle_payments. Un compte inactif ne l''a jamais.';

GRANT EXECUTE ON FUNCTION public.can_settle_payments(UUID) TO authenticated, service_role;
