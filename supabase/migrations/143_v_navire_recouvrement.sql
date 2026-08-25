-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 143 : encours par NAVIRE
--
-- Le poste de recouvrement raisonne par armateur (mig 132) et par facture
-- (mig 111). Il lui manque l'angle navire : « quel bateau doit combien, et
-- lequel est en retard ». C'est l'angle qu'un exploitant portuaire utilise
-- quand un navire se présente et qu'il faut savoir, en une requête, si la
-- coque devant lui traîne une créance.
--
-- L'encours vient de `v_transaction_outstanding` (mig 132) et n'est JAMAIS
-- recalculé : `transactions.partial_paid_usd` est gelée depuis la mig 089 et
-- vaut zéro sur toute facture en cours, ce qui faisait réclamer le montant
-- plein de factures déjà réglées en partie.
--
-- Filtres `is_claimable` calqués sur `v_armateur_recouvrement` : ils portent
-- sur le facturé, le payé et le compte, mais PAS sur l'encours — la vue 132
-- rend déjà zéro pour VOID / EXEMPT / CREDIT_NOTE_ISSUED, et l'y filtrer une
-- seconde fois masquerait un trop-perçu au lieu de le laisser voir.
--
-- security_invoker : hérite de la RLS de transactions / vessels / shipowners,
-- donc le cloisonnement par juridiction est automatique. Aucune policy ici.
--
-- Portée : maritime uniquement, pro-formas uniquement — comme tout le rail de
-- recouvrement. Une créance sans navire rattaché est donc ABSENTE de cette
-- vue ; l'écran affiche le nombre de créances couvertes pour que l'écart se
-- voie au lieu de se taire.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_navire_recouvrement
WITH (security_invoker = true) AS
SELECT
  v.id,
  v.name,
  v.imo_number,
  v.flag_code,
  v.category,
  v.gross_tonnage_dwt,
  v.compliance_status,
  v.shipowner_id,
  s.name                                                                AS shipowner_name,
  (s.is_ofac_sdn OR s.is_un_prohibited)                                 AS shipowner_sanctioned,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME' AND o.is_claimable
  )                                                                     AS proforma_count,
  COALESCE(SUM(t.tax_amount_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME' AND o.is_claimable
  ), 0)                                                                 AS total_invoiced_usd,
  COALESCE(SUM(o.paid_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME' AND o.is_claimable
  ), 0)                                                                 AS total_paid_usd,
  COALESCE(SUM(o.outstanding_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_outstanding_usd,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
  )                                                                     AS open_count,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID') AND t.due_date < now()
  )                                                                     AS overdue_count,
  MIN(t.due_date) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
  )                                                                     AS next_due_date,
  MAX(t.created_at) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  )                                                                     AS last_invoiced_at
FROM public.vessels v
LEFT JOIN public.transactions t ON t.vessel_id = v.id
LEFT JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN public.shipowners s ON s.id = v.shipowner_id
GROUP BY v.id, s.name, s.is_ofac_sdn, s.is_un_prohibited;

COMMENT ON VIEW public.v_navire_recouvrement IS
  'Mig 143 : encours de recouvrement par navire (pro-formas maritimes). Encours issu de v_transaction_outstanding — ne jamais recalculer depuis partial_paid_usd. Une créance sans vessel_id n''y figure pas.';

GRANT SELECT ON public.v_navire_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_navire_recouvrement;
