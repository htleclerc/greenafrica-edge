-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 126 : usages du palier MANUAL.
--
-- L'unicité (transaction_id, tier) porte l'idempotence du cron : elle reste
-- entière sur les paliers automatiques et ne s'applique pas aux relances
-- manuelles, répétables par nature.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_creminders_txn_tier;
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_txn_tier
  ON public.collection_reminders(transaction_id, tier)
  WHERE tier <> 'MANUAL';

CREATE INDEX IF NOT EXISTS idx_creminders_manual
  ON public.collection_reminders(transaction_id, sent_at DESC)
  WHERE tier = 'MANUAL';

-- v_collection_admin v2 : latest_tier redevient le dernier palier LÉGAL.
-- Sans ce filtre, une relance manuelle du jour afficherait « MANUAL » à la
-- place de « J15 » et masquerait où en est réellement la rampe.
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
  cr.latest_response_at,
  cr.manual_count,
  cr.last_manual_at
FROM public.transactions t
JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE r.tier <> 'MANUAL')                                    AS reminder_count,
    (array_agg(r.tier ORDER BY r.sent_at DESC)
       FILTER (WHERE r.tier <> 'MANUAL'))[1]                                      AS latest_tier,
    max(r.sent_at) FILTER (WHERE r.tier <> 'MANUAL')                              AS latest_sent_at,
    (array_agg(r.debtor_response_type ORDER BY r.debtor_response_at DESC NULLS LAST)
       FILTER (WHERE r.debtor_response_type <> 'SILENT'))[1]                      AS latest_response_type,
    (array_agg(r.debtor_response_at   ORDER BY r.debtor_response_at DESC NULLS LAST)
       FILTER (WHERE r.debtor_response_type <> 'SILENT'))[1]                      AS latest_response_at,
    count(*) FILTER (WHERE r.tier = 'MANUAL')                                     AS manual_count,
    max(r.sent_at) FILTER (WHERE r.tier = 'MANUAL')                               AS last_manual_at
  FROM public.collection_reminders r
  WHERE r.transaction_id = t.id
) cr ON cr.reminder_count > 0 OR cr.manual_count > 0
LEFT JOIN public.shipowners   s ON s.id = t.shipowner_id
LEFT JOIN public.jurisdictions j ON j.id = t.jurisdiction_id;

GRANT SELECT ON public.v_collection_admin TO authenticated, service_role;

-- DOWN: restaurer v_collection_admin dans sa forme mig 111 et recréer
-- idx_creminders_txn_tier sans clause WHERE.
