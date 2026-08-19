-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 099 : scoping juridiction de la policy staff de collection_reminders
--
-- Durcissement RGPD/sécurité (audit 2026-07-21, finding C3). La policy staff de
-- collection_reminders (mig 094) revendiquait en commentaire le « pattern mig
-- 073/074 » mais n'appliquait que `is_admin_or_officer()` (rôle seul), sans filtre
-- de juridiction → un officier d'une juridiction pouvait lire/gérer les relances
-- (données débiteur) de TOUTES les juridictions.
--
-- collection_reminders n'a pas de colonne jurisdiction_id propre : on scope par
-- jointure structurelle transaction_id → transactions.jurisdiction_id (colonne
-- posée en mig 071). Aucun changement de schéma, aucun backfill.
-- current_jurisdiction_ids() (mig 071) renvoie déjà TOUTES les juridictions pour
-- un SUPERADMIN → le filtre est transparent pour lui (pas de cas spécial).
-- ADDITIVE (remplacement de policy, pas de DDL de table).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "staff manage collection reminders" ON public.collection_reminders;
CREATE POLICY "staff manage collection reminders"
  ON public.collection_reminders FOR ALL
  USING (
    public.is_admin_or_officer() AND EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = collection_reminders.transaction_id
        AND t.jurisdiction_id = ANY(public.current_jurisdiction_ids())
    )
  )
  WITH CHECK (
    public.is_admin_or_officer() AND EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = collection_reminders.transaction_id
        AND t.jurisdiction_id = ANY(public.current_jurisdiction_ids())
    )
  );

-- DOWN:
-- DROP POLICY IF EXISTS "staff manage collection reminders" ON public.collection_reminders;
-- CREATE POLICY "staff manage collection reminders"
--   ON public.collection_reminders FOR ALL
--   USING (public.is_admin_or_officer())
--   WITH CHECK (public.is_admin_or_officer());
