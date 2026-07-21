-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 100 : scoping juridiction de audit_logs (quick win)
--
-- Durcissement RGPD/sécurité (audit 2026-07-21, finding C3b). La policy SELECT de
-- audit_logs (mig 004) laissait tout staff lire les logs de TOUTES les juridictions
-- (y compris les révélations d'IBAN). audit_logs n'a pas de jurisdiction_id et son
-- entity_id est polymorphe.
--
-- Approche « quick win » (fail-tolérante) :
--   1. Ajout d'une colonne jurisdiction_id NULLABLE (le trigger append-only mig 018
--      ne se déclenche que sur UPDATE/DELETE — ADD COLUMN et INSERT non affectés ;
--      les inserts existants qui n'envoient pas la colonne restent valides = NULL).
--   2. Backfill best-effort depuis les entités à juridiction déterministe
--      (Shipowner/Transaction/Refund/Payment). Les logs cross-tenant légitimes
--      (Jurisdiction/SettlementReport/Tariff/Profile) restent NULL.
--   3. Policy tolérante : un log NULL reste visible au staff (compat), un log tagué
--      est scopé par juridiction. Les writers sensibles (révélation IBAN, KYC,
--      paiements) sont mis à jour pour renseigner jurisdiction_id → leurs logs sont
--      donc scopés. SUPERADMIN voit tout (current_jurisdiction_ids() mig 071).
-- Le tag des ~25 autres writers reste un chantier de fond (cf. audit).
-- ADDITIVE (colonne nullable + backfill + remplacement de policy).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID REFERENCES public.jurisdictions(id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_jurisdiction
  ON public.audit_logs(jurisdiction_id);

-- Backfill best-effort (entités à juridiction déterministe).
-- audit_logs est append-only : le trigger BEFORE UPDATE `audit_logs_no_update`
-- (mig 018) bloque les UPDATE. On le désactive UNIQUEMENT le temps du backfill de
-- données puis on le rétablit — ciblé (le guard DELETE `audit_logs_no_delete`
-- reste actif) et idempotent (re-jouable). Transactionnel sous `supabase db push`.
ALTER TABLE public.audit_logs DISABLE TRIGGER audit_logs_no_update;

UPDATE public.audit_logs a SET jurisdiction_id = s.jurisdiction_id
  FROM public.shipowners s
  WHERE a.entity_type = 'Shipowner' AND a.entity_id = s.id::text AND a.jurisdiction_id IS NULL;
UPDATE public.audit_logs a SET jurisdiction_id = t.jurisdiction_id
  FROM public.transactions t
  WHERE a.entity_type = 'Transaction' AND a.entity_id = t.id::text AND a.jurisdiction_id IS NULL;
UPDATE public.audit_logs a SET jurisdiction_id = r.jurisdiction_id
  FROM public.refunds r
  WHERE a.entity_type = 'Refund' AND a.entity_id = r.id::text AND a.jurisdiction_id IS NULL;
UPDATE public.audit_logs a SET jurisdiction_id = p.jurisdiction_id
  FROM public.payments p
  WHERE a.entity_type = 'Payment' AND a.entity_id = p.id::text AND a.jurisdiction_id IS NULL;

ALTER TABLE public.audit_logs ENABLE TRIGGER audit_logs_no_update;

-- Policy SELECT scopée (tolérante au NULL) — remplace mig 004:147-152.
DROP POLICY IF EXISTS "Users see relevant audit logs" ON public.audit_logs;
CREATE POLICY "Users see relevant audit logs"
    ON public.audit_logs FOR SELECT
    USING (
        (
            public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
            AND (jurisdiction_id IS NULL OR jurisdiction_id = ANY(public.current_jurisdiction_ids()))
        )
        OR user_id = auth.uid()
    );

-- DOWN:
-- DROP POLICY IF EXISTS "Users see relevant audit logs" ON public.audit_logs;
-- CREATE POLICY "Users see relevant audit logs"
--     ON public.audit_logs FOR SELECT
--     USING (
--         public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
--         OR user_id = auth.uid()
--     );
-- DROP INDEX IF EXISTS public.idx_audit_logs_jurisdiction;
-- ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS jurisdiction_id;
