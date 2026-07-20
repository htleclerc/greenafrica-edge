-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 097: vue v_compagnie_recouvrement — cockpit admin compagnies aviation
--
-- Miroir aérien de v_armateur_recouvrement (mig 095) : agrège par compagnie
-- aviation (shipowners.iata_code IS NOT NULL) les montants des pro-formas
-- aériennes (transactions document_type='PROFORMA', mode='AIR').
-- security_invoker=true : hérite des RLS de shipowners/transactions.
-- Numéro 097 (et non 096) pour éviter la collision develop avec la mig 096
-- (sous-projet 3, liste des factures).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_compagnie_recouvrement
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
  s.iata_code,
  s.icao_code,
  s.hub_code,
  s.aoc_number,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  )                                                                     AS proforma_count,
  COALESCE(SUM(t.tax_amount_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_invoiced_usd,
  COALESCE(SUM(t.partial_paid_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_paid_usd,
  COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_outstanding_usd
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
WHERE s.iata_code IS NOT NULL
GROUP BY s.id;

COMMENT ON VIEW public.v_compagnie_recouvrement IS
  'Cockpit admin compagnies aviation (Sprint 2) : agrégats facturé/payé/dû par compagnie aérienne. security_invoker hérite des RLS sous-jacentes.';

GRANT SELECT ON public.v_compagnie_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_compagnie_recouvrement;
