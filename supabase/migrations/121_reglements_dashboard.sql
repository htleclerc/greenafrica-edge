-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 121 : tableau de bord des règlements + enrichissement du cockpit
--
-- v_reglements_dashboard : une ligne par juridiction, fenêtres calendaires UTC.
-- v_armateur_recouvrement : +5 colonnes (retard, échéance, dernière relance).
-- Les deux en security_invoker → héritent de la RLS de transactions/payments/
-- shipowners. Aucune policy à écrire.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_reglements_dashboard
WITH (security_invoker = true) AS
SELECT
  j.id AS jurisdiction_id,

  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('day', now()))                   AS invoiced_today_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('day', now()))                   AS invoiced_today_count,
  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('week', now()))                  AS invoiced_week_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('week', now()))                  AS invoiced_week_count,
  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('month', now()))                 AS invoiced_month_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('month', now()))                 AS invoiced_month_count,

  -- Encaissé = créances éteintes. Les alimentations de wallet non affectées à une
  -- facture (payments.transaction_id IS NULL) sont volontairement hors périmètre.
  -- Les règlements par wallet, eux, produisent bien une ligne payments (mig 059).
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('day', now()))                 AS collected_today_usd,
  (SELECT COUNT(*) FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('day', now()))                 AS collected_today_count,
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('week', now()))                AS collected_week_usd,
  (SELECT COUNT(*) FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('week', now()))                AS collected_week_count,
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('month', now()))               AS collected_month_usd,
  (SELECT COUNT(*) FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('month', now()))               AS collected_month_count,

  (SELECT COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)), 0)
     FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID'))         AS total_outstanding_usd,
  (SELECT COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)), 0)
     FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                         AS overdue_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                         AS overdue_count
FROM public.jurisdictions j;

COMMENT ON VIEW public.v_reglements_dashboard IS
  'Tableau de bord recouvrement maritime : facturé/encaissé par fenêtre calendaire UTC + encours. security_invoker.';

GRANT SELECT ON public.v_reglements_dashboard TO authenticated, service_role;

-- ── v_armateur_recouvrement : +5 colonnes EN FIN (mig 095 recopiée à l'identique)
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
  ), 0)                                                                 AS total_outstanding_usd,
  -- ── nouvelles colonnes (mig 121) ──────────────────────────────────────────
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
  r.latest_response_type
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
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

COMMENT ON VIEW public.v_armateur_recouvrement IS
  'Cockpit admin armateurs : agrégats facturé/payé/dû + état de relance (mig 121). security_invoker.';

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_reglements_dashboard;
-- (restaurer v_armateur_recouvrement dans sa forme mig 095)
