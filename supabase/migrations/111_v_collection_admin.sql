-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 111: v_collection_admin — une ligne par créance ayant ≥1 relance
--
-- Alimente l'écran staff admin/collections (B2). Agrège l'historique
-- collection_reminders (mig 094/099/110) par transaction : nombre de relances,
-- dernier palier, dernière réponse débiteur. security_invoker = true → hérite
-- de la RLS de collection_reminders/transactions (staff par juridiction, mig 099).
-- Miroir du patron v_invoice_admin (mig 096).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_collection_admin WITH (security_invoker = true) AS
SELECT
  t.id                       AS transaction_id,
  t.invoice_ref,
  t.status,
  t.tax_amount_usd,
  (t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) AS outstanding_usd,
  t.created_at,
  t.shipowner_id,
  s.name                     AS debtor_name,
  s.country_code             AS flag_country,
  t.jurisdiction_id,
  j.code                     AS jurisdiction_code,
  j.name                     AS jurisdiction_name,
  cr.reminder_count,
  cr.latest_tier,
  cr.latest_sent_at,
  cr.latest_response_type,
  cr.latest_response_at
FROM public.transactions t
JOIN LATERAL (
  SELECT
    count(*)                                                          AS reminder_count,
    (array_agg(r.tier                 ORDER BY r.sent_at DESC))[1]    AS latest_tier,
    max(r.sent_at)                                                    AS latest_sent_at,
    (array_agg(r.debtor_response_type ORDER BY r.sent_at DESC))[1]    AS latest_response_type,
    (array_agg(r.debtor_response_at   ORDER BY r.sent_at DESC))[1]    AS latest_response_at
  FROM public.collection_reminders r
  WHERE r.transaction_id = t.id
) cr ON cr.reminder_count > 0
LEFT JOIN public.shipowners   s ON s.id = t.shipowner_id
LEFT JOIN public.jurisdictions j ON j.id = t.jurisdiction_id;

GRANT SELECT ON public.v_collection_admin TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_collection_admin;
