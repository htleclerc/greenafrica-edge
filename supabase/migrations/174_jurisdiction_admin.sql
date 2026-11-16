-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 174 : l'administrateur d'un pays
--
-- Deux niveaux d'administration (décision du 2026-11-13, précisée le 15) :
--
--   • l'administrateur GÉNÉRAL (rôle SUPERADMIN) : aucun rattachement, tous les
--     pays. Inchangé ;
--   • l'administrateur D'UN PAYS : un membre du personnel à qui l'administrateur
--     général a donné ce droit, pays par pays. Dans son pays, il invite et
--     retire du personnel, et modifie les réglages et les tarifs.
--
-- Ce n'est pas un nouveau rôle. Le droit est porté par le rattachement
-- (`user_jurisdictions.is_admin`) : la même personne peut administrer un pays
-- et n'être qu'agent dans un autre, et son rôle métier ne change pas.
--
-- Ce qu'un administrateur de pays ne peut PAS faire :
--   • se donner, donner ou retirer le droit d'administrer — seul
--     l'administrateur général le fait. Un compte compromis ne se multiplie
--     donc pas ;
--   • retirer un autre administrateur du pays, ni se retirer lui-même ;
--   • toucher à un autre pays ;
--   • ouvrir ou couper un mode, changer le partage des recettes : cela relève
--     du contrat avec l'État, donc de l'administrateur général (migs 172, 071).
--
-- Rejouable.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.user_jurisdictions
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_jurisdictions.is_admin IS
  'Administrateur de ce pays : invite et retire du personnel, modifie réglages et tarifs. Donné et retiré par l''administrateur général seulement.';

-- Les pays que l'appelant administre. Compte inactif ou rôle hors personnel :
-- aucun, quoi que dise la ligne de rattachement.
CREATE OR REPLACE FUNCTION public.admin_jurisdiction_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(uj.jurisdiction_id), ARRAY[]::uuid[])
    FROM public.user_jurisdictions uj
    JOIN public.profiles p ON p.id = uj.user_id
   WHERE uj.user_id = auth.uid()
     AND uj.is_admin
     AND p.is_active
     AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER');
$$;
REVOKE ALL ON FUNCTION public.admin_jurisdiction_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_jurisdiction_ids() TO authenticated, service_role;

-- Un rattachement ne se donne qu'à du personnel : ni à un armateur, ni à un
-- agent maritime, ni à l'administrateur général (qui n'en a pas besoin).
CREATE OR REPLACE FUNCTION public.is_country_staff(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_user_id
       AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER')
  );
$$;
REVOKE ALL ON FUNCTION public.is_country_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_country_staff(UUID) TO authenticated, service_role;

-- ── Rattachements : l'administrateur d'un pays, pour son pays seulement ──────
-- La règle de l'administrateur général (mig 172) reste en place. Celles-ci
-- s'y ajoutent. Pas de règle UPDATE : `is_admin` ne se modifie donc pas par ici.
DROP POLICY IF EXISTS "country admin adds staff" ON public.user_jurisdictions;
CREATE POLICY "country admin adds staff" ON public.user_jurisdictions
  FOR INSERT TO authenticated
  WITH CHECK (
    jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[])
    AND NOT is_admin
    AND public.is_country_staff(user_id)
  );

DROP POLICY IF EXISTS "country admin removes staff" ON public.user_jurisdictions;
CREATE POLICY "country admin removes staff" ON public.user_jurisdictions
  FOR DELETE TO authenticated
  USING (
    jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[])
    AND NOT is_admin
    AND user_id <> (SELECT auth.uid())
  );

-- ── Lecture des rattachements ────────────────────────────────────────────────
-- Depuis la mig 071, tout le personnel lisait TOUS les rattachements, de tous
-- les pays. Avec `is_admin`, cela donnait à chacun la liste de qui administre
-- quel pays. Désormais : ses propres lignes ; celles des pays qu'on administre ;
-- tout, pour l'administrateur général. L'application lit le reste avec la clé
-- de service, après ses propres contrôles.
DROP POLICY IF EXISTS "user reads own memberships" ON public.user_jurisdictions;
CREATE POLICY "user reads own memberships" ON public.user_jurisdictions
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.get_user_role()) = 'SUPERADMIN'
    OR jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[])
  );

-- ── Tarifs : les finances du pays, ou son administrateur ─────────────────────
DROP POLICY IF EXISTS "finance admins write tariffs" ON public.tariffs;
CREATE POLICY "finance admins write tariffs" ON public.tariffs
  FOR ALL TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = (SELECT auth.uid()) AND p.is_active
                AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN'))
     AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
    OR jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[])
  )
  WITH CHECK (
    (EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = (SELECT auth.uid()) AND p.is_active
                AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN'))
     AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
    OR jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[])
  );

-- ── Profil d'émetteur : idem. La ligne sans pays reste à l'administrateur
-- général (mig 172).
DROP POLICY IF EXISTS issuer_profile_write_finance ON public.jurisdiction_issuer_profile;
CREATE POLICY issuer_profile_write_finance ON public.jurisdiction_issuer_profile
  FOR ALL TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = (SELECT auth.uid()) AND p.is_active
                AND p.role IN ('SUPERADMIN', 'FINANCE_ADMIN'))
     AND (
       (jurisdiction_id IS NOT NULL
         AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
       OR (jurisdiction_id IS NULL AND (SELECT public.get_user_role()) = 'SUPERADMIN')
     ))
    OR (jurisdiction_id IS NOT NULL
        AND jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[]))
  )
  WITH CHECK (
    (EXISTS (SELECT 1 FROM public.profiles p
              WHERE p.id = (SELECT auth.uid()) AND p.is_active
                AND p.role IN ('SUPERADMIN', 'FINANCE_ADMIN'))
     AND (
       (jurisdiction_id IS NOT NULL
         AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
       OR (jurisdiction_id IS NULL AND (SELECT public.get_user_role()) = 'SUPERADMIN')
     ))
    OR (jurisdiction_id IS NOT NULL
        AND jurisdiction_id = ANY ((SELECT public.admin_jurisdiction_ids())::uuid[]))
  );

-- ── Nouvelle version d'un tarif : l'administrateur du pays y a droit ─────────
-- Seul le contrôle d'entrée change (mig 084/088) ; le reste est repris tel quel.
-- La fonction reste réservée à la clé de service : l'application l'appelle
-- après ses propres contrôles, et `p_actor` y est la personne connectée.
CREATE OR REPLACE FUNCTION public.create_tariff_version(
  p_jurisdiction_id UUID,
  p_mode public.transport_mode,
  p_asset_category TEXT,
  p_rate NUMERIC,
  p_effective_from DATE,
  p_decree_ref TEXT,
  p_actor UUID
)
RETURNS TABLE (new_id UUID, closed_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_open public.tariffs%ROWTYPE;
BEGIN
  -- Defense in depth: finance roles, or the administrator of THIS country.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor
                   AND p.is_active AND p.role IN ('FINANCE_ADMIN','SUPERADMIN'))
     AND NOT EXISTS (SELECT 1 FROM public.user_jurisdictions uj
                       JOIN public.profiles p ON p.id = uj.user_id
                      WHERE uj.user_id = p_actor
                        AND uj.jurisdiction_id = p_jurisdiction_id
                        AND uj.is_admin
                        AND p.is_active
                        AND p.role IN ('PORT_OFFICER','FINANCE_ADMIN','MANAGER')) THEN
    RAISE EXCEPTION 'create_tariff_version: forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'create_tariff_version: rate must be positive';
  END IF;
  IF p_effective_from <= CURRENT_DATE THEN
    -- Strictly future: same-day versioning would re-price proformas already
    -- issued today (as_of pinning is day-granular).
    RAISE EXCEPTION 'create_tariff_version: effective_from must be strictly future' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_open FROM public.tariffs t
   WHERE t.jurisdiction_id = p_jurisdiction_id AND t.mode = p_mode
     AND t.asset_category IS NOT DISTINCT FROM p_asset_category
     AND t.status = 'ACTIVE' AND t.effective_to IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF v_open.effective_from >= p_effective_from THEN
      RAISE EXCEPTION 'create_tariff_version: an open version starting % already exists at/after %',
        v_open.effective_from, p_effective_from USING ERRCODE = 'exclusion_violation';
    END IF;
    UPDATE public.tariffs SET effective_to = p_effective_from WHERE id = v_open.id;
    closed_id := v_open.id;
  END IF;

  INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, currency,
                              effective_from, status, decree_ref, created_by)
  VALUES (p_jurisdiction_id, p_mode, p_asset_category, p_rate, 'USD',
          p_effective_from, 'ACTIVE', p_decree_ref, p_actor)
  RETURNING id INTO new_id;
  RETURN NEXT;
END $function$;

-- DOWN : retirer les deux règles « country admin … », rétablir les règles de
-- tarifs (mig 087/088) et de profil d'émetteur (mig 172), la fonction
-- create_tariff_version de la mig 088, puis supprimer les deux fonctions et la
-- colonne is_admin.
