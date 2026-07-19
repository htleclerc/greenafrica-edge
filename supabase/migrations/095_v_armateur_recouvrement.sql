-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 095: vue v_armateur_recouvrement — cockpit admin armateurs
--
-- Agrège par armateur maritime (shipowners.iata_code IS NULL) les montants issus
-- des pro-formas maritimes (transactions document_type='PROFORMA', mode='MARITIME').
-- partial_paid_usd est maintenu par le trigger recompute_transaction_status
-- (mig 051) à partir de la somme des paiements → c'est le "payé" faisant foi.
-- security_invoker=true : la vue hérite des RLS de shipowners/transactions
-- (le staff les lit déjà ; pas de fuite de données cross-tenant).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_armateur_recouvrement
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.name,
  s.country_code,
  s.account_state,
  s.is_ofac_sdn,
  s.is_un_prohibited,
  (s.is_ofac_sdn OR s.is_un_prohibited)                                 AS sanctioned,
  s.official_email,
  s.imo_company_no,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  )                                                                     AS proforma_count,
  COALESCE(SUM(t.tax_amount_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_invoiced_usd,
  COALESCE(SUM(t.partial_paid_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_paid_usd,
  COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_outstanding_usd
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
WHERE s.iata_code IS NULL
GROUP BY s.id;

COMMENT ON VIEW public.v_armateur_recouvrement IS
  'Cockpit admin armateurs (Sprint 2) : agrégats facturé/payé/dû par armateur maritime. security_invoker hérite des RLS sous-jacentes.';

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_armateur_recouvrement;
