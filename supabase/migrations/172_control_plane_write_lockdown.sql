-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 172 : seul l'administrateur général écrit ce qui définit les pays
--
-- Depuis la mig 071, les règles d'écriture de plusieurs tables de pilotage
-- disaient « tout le personnel » (is_admin_or_officer : SUPERADMIN, PORT_OFFICER,
-- FINANCE_ADMIN, MANAGER). Avec son propre jeton, un agent pouvait donc :
--
--   • se rattacher lui-même à un autre pays (user_jurisdictions) — et lire
--     ensuite tout ce pays, puisque la cloison par pays se lit dans cette table ;
--   • modifier ou supprimer un pays (jurisdictions), ce qui supprime en cascade
--     les rattachements des autres ;
--   • activer ou couper un mode dans n'importe quel pays ;
--   • réécrire les méthodes et les facteurs d'émission communs à tous.
--
-- Toute la séparation par pays reposait donc sur le fait que personne n'appelle
-- l'API directement. L'application, elle, écrit ces tables avec la clé de
-- service après ses propres contrôles (inviteStaff, toggleJurisdictionMode…) :
-- elle n'est pas touchée.
--
-- Deux niveaux d'administration :
--   • l'administrateur GÉNÉRAL (SUPERADMIN) : aucun rattachement, tous les pays.
--     Lui seul écrit ce qui définit un pays ou vaut pour tous ;
--   • le personnel d'un pays : n'écrit que les réglages de SES pays.
--
-- Les règles de lecture ne changent pas. Rejouable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Réservé à l'administrateur général ───────────────────────────────────────
-- Qui a accès à quel pays.
DROP POLICY IF EXISTS "admins write memberships" ON public.user_jurisdictions;
DROP POLICY IF EXISTS "general admin writes memberships" ON public.user_jurisdictions;
CREATE POLICY "general admin writes memberships" ON public.user_jurisdictions
  FOR ALL TO authenticated
  USING ((SELECT public.get_user_role()) = 'SUPERADMIN')
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');

-- Les pays eux-mêmes.
DROP POLICY IF EXISTS "admins write jurisdictions" ON public.jurisdictions;
DROP POLICY IF EXISTS "general admin writes jurisdictions" ON public.jurisdictions;
CREATE POLICY "general admin writes jurisdictions" ON public.jurisdictions
  FOR ALL TO authenticated
  USING ((SELECT public.get_user_role()) = 'SUPERADMIN')
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');

-- Quels modes (maritime, aérien) sont ouverts dans quel pays.
DROP POLICY IF EXISTS "admins write mode config" ON public.jurisdiction_mode_config;
DROP POLICY IF EXISTS "general admin writes mode config" ON public.jurisdiction_mode_config;
CREATE POLICY "general admin writes mode config" ON public.jurisdiction_mode_config
  FOR ALL TO authenticated
  USING ((SELECT public.get_user_role()) = 'SUPERADMIN')
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');

-- Référentiels communs à tous les pays.
DROP POLICY IF EXISTS "admins write methodologies" ON public.methodologies;
DROP POLICY IF EXISTS "general admin writes methodologies" ON public.methodologies;
CREATE POLICY "general admin writes methodologies" ON public.methodologies
  FOR ALL TO authenticated
  USING ((SELECT public.get_user_role()) = 'SUPERADMIN')
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');

DROP POLICY IF EXISTS "admins write air emission factors" ON public.air_emission_factors;
DROP POLICY IF EXISTS "general admin writes air emission factors" ON public.air_emission_factors;
CREATE POLICY "general admin writes air emission factors" ON public.air_emission_factors
  FOR ALL TO authenticated
  USING ((SELECT public.get_user_role()) = 'SUPERADMIN')
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');

DROP POLICY IF EXISTS "admins write factors" ON public.emission_factors;
DROP POLICY IF EXISTS "admins update factors" ON public.emission_factors;
DROP POLICY IF EXISTS "general admin inserts factors" ON public.emission_factors;
DROP POLICY IF EXISTS "general admin updates factors" ON public.emission_factors;
CREATE POLICY "general admin inserts factors" ON public.emission_factors
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');
CREATE POLICY "general admin updates factors" ON public.emission_factors
  FOR UPDATE TO authenticated
  USING ((SELECT public.get_user_role()) = 'SUPERADMIN')
  WITH CHECK ((SELECT public.get_user_role()) = 'SUPERADMIN');

-- ── Réglages d'un pays : son personnel, pour ses pays seulement ──────────────
-- Copies de facturation. La règle ne regardait que le rôle.
DROP POLICY IF EXISTS "staff manage jurisdiction billing cc" ON public.jurisdiction_billing_cc;
CREATE POLICY "staff manage jurisdiction billing cc" ON public.jurisdiction_billing_cc
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_officer())
         AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
  WITH CHECK ((SELECT public.is_admin_or_officer())
         AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]));

-- Profil d'émetteur. La ligne sans pays est le défaut de la plateforme : elle
-- vaut pour tous, donc elle revient à l'administrateur général.
DROP POLICY IF EXISTS issuer_profile_write_finance ON public.jurisdiction_issuer_profile;
CREATE POLICY issuer_profile_write_finance ON public.jurisdiction_issuer_profile
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = (SELECT auth.uid()) AND p.is_active
               AND p.role IN ('SUPERADMIN', 'FINANCE_ADMIN'))
    AND (
      (jurisdiction_id IS NOT NULL
        AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
      OR (jurisdiction_id IS NULL AND (SELECT public.get_user_role()) = 'SUPERADMIN')
    )
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = (SELECT auth.uid()) AND p.is_active
               AND p.role IN ('SUPERADMIN', 'FINANCE_ADMIN'))
    AND (
      (jurisdiction_id IS NOT NULL
        AND jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))
      OR (jurisdiction_id IS NULL AND (SELECT public.get_user_role()) = 'SUPERADMIN')
    )
  );

-- DOWN : rétablir les règles d'origine — migs 071 (user_jurisdictions,
-- jurisdictions, jurisdiction_mode_config, methodologies), 025 et 074
-- (facteurs), 109 (jurisdiction_billing_cc), 131 (jurisdiction_issuer_profile).
