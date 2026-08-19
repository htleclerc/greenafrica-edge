-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 108 : corrige la récursion RLS infinie profiles ↔ shipowners
--
-- Régression introduite par la mig 101 (RGPD hardening #98) : sa policy
-- "Admins can read all profiles" sur public.profiles ajoute un
-- `EXISTS (SELECT FROM public.shipowners …)` évalué AVEC la RLS de shipowners.
-- Or la policy "agents read shipowners" (mig 031) fait un
-- `EXISTS (SELECT FROM public.profiles …)` évalué AVEC la RLS de profiles.
--   lire profiles → policy profiles lit shipowners → policy shipowners lit
--   profiles → … → « infinite recursion detected in policy » dès qu'un
--   PORT_OFFICER/MANAGER (pas SUPERADMIN, qui court-circuite) touche l'une
--   ou l'autre table. Cassait 4 tests pg (058/073/074/076) et le gate
--   deploy-staging depuis #98.
--
-- Fix (même pattern que get_user_role() — mig 001/021) : déplacer les
-- sous-requêtes cross-table dans une fonction SECURITY DEFINER. Étant DEFINER
-- (propriétaire = postgres), ses lectures de shipowners/user_jurisdictions
-- ne déclenchent PAS la RLS de ces tables → la boucle est rompue. Sémantique
-- de la mig 101 strictement préservée (SUPERADMIN inconditionnel ; PORT_OFFICER
-- /MANAGER limités à leur juridiction via user_jurisdictions OU shipowners).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.profile_visible_in_jurisdictions(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_jurisdictions uj
        WHERE uj.user_id = p_profile_id
          AND uj.jurisdiction_id = ANY (public.current_jurisdiction_ids())
    ) OR EXISTS (
        SELECT 1 FROM public.shipowners so
        WHERE so.profile_id = p_profile_id
          AND so.jurisdiction_id = ANY (public.current_jurisdiction_ids())
    );
$$;

COMMENT ON FUNCTION public.profile_visible_in_jurisdictions(uuid) IS
  'Mig 108 : la juridiction d''un profil est-elle dans celles de l''appelant ? '
  'SECURITY DEFINER pour que les lectures de shipowners/user_jurisdictions '
  'bypassent la RLS et cassent la récursion profiles ↔ shipowners (mig 101).';

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
    ON public.profiles
    FOR SELECT
    USING (
        public.get_user_role()::text = 'SUPERADMIN'
        OR (
            public.get_user_role()::text IN ('PORT_OFFICER', 'MANAGER')
            AND public.profile_visible_in_jurisdictions(profiles.id)
        )
    );

-- DOWN:
-- DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
-- CREATE POLICY "Admins can read all profiles"
--     ON public.profiles FOR SELECT
--     USING (
--         public.get_user_role()::text = 'SUPERADMIN'
--         OR (
--             public.get_user_role()::text IN ('PORT_OFFICER', 'MANAGER')
--             AND (
--                 EXISTS (SELECT 1 FROM public.user_jurisdictions uj
--                         WHERE uj.user_id = profiles.id
--                           AND uj.jurisdiction_id = ANY (public.current_jurisdiction_ids()))
--                 OR EXISTS (SELECT 1 FROM public.shipowners so
--                            WHERE so.profile_id = profiles.id
--                              AND so.jurisdiction_id = ANY (public.current_jurisdiction_ids()))
--             )
--         )
--     );
-- DROP FUNCTION IF EXISTS public.profile_visible_in_jurisdictions(uuid);
