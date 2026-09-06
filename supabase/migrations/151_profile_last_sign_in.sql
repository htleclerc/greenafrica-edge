-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 151 : dernière connexion des profils, pour l'annuaire staff
--
-- `auth.users.last_sign_in_at` n'est pas lisible depuis PostgREST. L'annuaire
-- `/admin/users` doit pourtant dire quand une personne s'est connectée pour la
-- dernière fois — c'est ce qui distingue un accès vivant d'un compte dormant.
--
-- Fonction SECURITY DEFINER, bornée :
--   — au staff (SUPERADMIN, FINANCE_ADMIN, PORT_OFFICER, MANAGER) : tout autre
--     appelant reçoit une exception, pas une liste vide ;
--   — aux identifiants demandés, que l'appelant a déjà obtenus par la RLS.
-- Elle ne rend que la date : ni adresse, ni métadonnées d'auth.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.profile_last_sign_in(profile_ids UUID[])
RETURNS TABLE (profile_id UUID, last_sign_in_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role IN ('SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER', 'MANAGER')
  ) THEN
    RAISE EXCEPTION 'profile_last_sign_in: staff only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.last_sign_in_at
      FROM auth.users u
     WHERE u.id = ANY (profile_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.profile_last_sign_in(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_last_sign_in(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.profile_last_sign_in(UUID[]) IS
  'Mig 151 : dernière connexion (auth.users) des profils demandés, réservée au staff. Annuaire /admin/users.';

-- DOWN:
-- DROP FUNCTION IF EXISTS public.profile_last_sign_in(UUID[]);
