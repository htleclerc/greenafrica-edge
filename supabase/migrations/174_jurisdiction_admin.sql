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
--     Il n'invite que des personnes qui n'ont pas encore de compte, et ne
--     touche pas aux comptes de paiement.
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

-- ── Rattachements : l'administrateur d'un pays, pour son pays seulement ──────
-- La règle de l'administrateur général (mig 172) reste en place. Celle-ci s'y
-- ajoute, pour le retrait seulement.
--
-- Pas de règle INSERT : un administrateur de pays n'invite que des personnes
-- qui n'ont pas encore de compte, et c'est l'application qui crée alors le
-- compte et son rattachement. Rattacher quelqu'un qui a déjà un compte — donc,
-- peut-être, un agent d'un autre État — revient à l'administrateur général.
-- Une règle INSERT ici rouvrirait ce cas par l'API, avec un simple identifiant.
-- Pas de règle UPDATE non plus : `is_admin` ne se modifie pas par ici.
DROP POLICY IF EXISTS "country admin adds staff" ON public.user_jurisdictions;
DROP FUNCTION IF EXISTS public.is_country_staff(UUID);
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

-- ── Tarifs ───────────────────────────────────────────────────────────────────
-- La règle d’écriture directe sur `tariffs` ne change pas (finances du pays,
-- mig 087). L’administrateur d’un pays passe par create_tariff_version, plus
-- bas : c’est elle qui ferme la version en cours et ouvre la suivante. Lui
-- ouvrir la table elle-même lui laisserait modifier ou supprimer une ligne
-- hors de ce versionnage.

-- ── Profil d'émetteur et comptes de paiement ─────────────────────────────────
-- Règle (PO, 2026-11-16) : les comptes de paiement sont GÉNÉRAUX par défaut.
-- Un pays n'a ses propres comptes que par distinction particulière.
--
-- Jusqu'ici la colonne était obligatoire : dès qu'un pays avait une ligne, il
-- portait une copie des comptes, figée, qui ne suivait plus les comptes
-- généraux. Elle devient facultative : vide = « les comptes généraux »
-- (la ligne sans pays), que l'application lit alors à la place.
--
-- La règle d'écriture directe ne change pas (mig 172 : finances du pays et
-- administrateur général). L'administrateur d'un pays modifie le reste du
-- profil par l'application, qui ne lui laisse jamais toucher aux comptes : lui
-- ouvrir la table elle-même lui donnerait l'IBAN imprimé sur les factures.
ALTER TABLE public.jurisdiction_issuer_profile
  ALTER COLUMN bank_accounts DROP NOT NULL;

COMMENT ON COLUMN public.jurisdiction_issuer_profile.bank_accounts IS
  'Comptes de collecte. Vide sur la ligne d''un pays = les comptes généraux (ligne sans pays). Renseigné = distinction particulière de ce pays.';

-- La ligne sans pays, elle, porte toujours des comptes : c'est elle le défaut.
ALTER TABLE public.jurisdiction_issuer_profile
  DROP CONSTRAINT IF EXISTS issuer_profile_default_has_accounts;
ALTER TABLE public.jurisdiction_issuer_profile
  ADD CONSTRAINT issuer_profile_default_has_accounts
  CHECK (jurisdiction_id IS NOT NULL OR bank_accounts IS NOT NULL);

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

-- DOWN : retirer la règle « country admin removes staff », rétablir la règle de
-- lecture des rattachements (mig 071) et la fonction create_tariff_version de la
-- mig 088, supprimer admin_jurisdiction_ids() et la colonne is_admin. Pour les
-- comptes : retirer la contrainte issuer_profile_default_has_accounts, recopier
-- les comptes généraux dans les lignes de pays vides, puis remettre NOT NULL.
