-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 145 : la référence publique remonte jusqu'aux écrans
--
-- La mig 144 a posé `shipowners.public_ref`. Pour que les listes construisent
-- des liens sans UUID, la référence doit voyager avec les lignes qu'elles
-- affichent. Les deux vues de recouvrement la portent donc en fin de liste.
--
-- CREATE OR REPLACE VIEW n'autorise que l'ajout de colonnes EN FIN : les
-- définitions ci-dessous sont celles des migrations 132 et 143, recopiées à
-- l'identique, avec `public_ref` ajoutée après la dernière colonne existante.
--
-- Les vues du rail financier (v_invoice_admin, v_collection_admin,
-- v_compagnie_recouvrement) ne sont VOLONTAIREMENT pas touchées : leurs écrans
-- résolvent la référence à la page. Réécrire trois vues d'encours pour un
-- confort d'URL serait un mauvais échange.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Cockpit armateurs (mig 132 recopiée, + public_ref) ─────────────────────
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
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID') AND t.due_date < now()
  )                                                                     AS overdue_count,
  MIN(t.due_date) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
  )                                                                     AS next_due_date,
  r.last_auto_tier,
  r.last_reminder_at,
  r.latest_response_type,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
  )                                                                     AS open_count,
  -- ── nouvelle colonne (mig 145) ────────────────────────────────────────────
  s.public_ref
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
LEFT JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN LATERAL (
  SELECT
    (array_agg(cr.tier ORDER BY cr.sent_at DESC)
       FILTER (WHERE cr.tier::text IN ('J3','J7','J15','J30','J45','BAILIFF','JUDICIAL')))[1] AS last_auto_tier,
    max(cr.sent_at)                                                                            AS last_reminder_at,
    (array_agg(cr.debtor_response_type ORDER BY cr.debtor_response_at DESC NULLS LAST)
       FILTER (WHERE cr.debtor_response_type <> 'SILENT'))[1]                                  AS latest_response_type
  FROM public.collection_reminders cr
  JOIN public.transactions t2 ON t2.id = cr.transaction_id
  WHERE t2.shipowner_id = s.id AND t2.document_type = 'PROFORMA' AND t2.mode = 'MARITIME'
) r ON TRUE
WHERE s.iata_code IS NULL
GROUP BY s.id, r.last_auto_tier, r.last_reminder_at, r.latest_response_type;

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- ── Encours par navire (mig 143 recopiée, + shipowner_public_ref) ───────────
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
  )                                                                     AS last_invoiced_at,
  -- ── nouvelle colonne (mig 145) ────────────────────────────────────────────
  s.public_ref                                                          AS shipowner_public_ref
FROM public.vessels v
LEFT JOIN public.transactions t ON t.vessel_id = v.id
LEFT JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN public.shipowners s ON s.id = v.shipowner_id
GROUP BY v.id, s.name, s.is_ofac_sdn, s.is_un_prohibited, s.public_ref;

GRANT SELECT ON public.v_navire_recouvrement TO authenticated, service_role;

-- DOWN:
-- restaurer v_armateur_recouvrement (mig 132) et v_navire_recouvrement (mig 143).
