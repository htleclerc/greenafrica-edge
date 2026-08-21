-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 127 : open_count sur v_armateur_recouvrement.
--
-- Round de correction 1 (Tache 13) : le dialogue de confirmation du
-- recapitulatif consolide dans ReglementsDashboard.tsx n'avait a sa
-- disposition que overdue_count (mig 121) pour annoncer le nombre de
-- factures concernees par l'envoi. Or sendConsolidatedRecap couvre TOUTES
-- les factures PENDING/OVERDUE/PARTIALLY_PAID, sans condition de date
-- d'echeance — overdue_count (qui ajoute due_date < now()) est strictement
-- plus restrictif et sous-annonce la portee reelle de l'envoi sur toute
-- facture ouverte pas encore echue. open_count reprend exactement le meme
-- calcul que overdue_count, moins cette condition de date.
--
-- CREATE OR REPLACE VIEW n'autorise que l'ajout de colonnes EN FIN : les
-- colonnes existantes sont recopiees a l'identique, dans le meme ordre
-- (mig 121), open_count est ajoutee apres la derniere (latest_response_type).
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
  -- ── nouvelle colonne (mig 127) ────────────────────────────────────────────
  -- Meme filtre que overdue_count ci-dessus, SANS `AND t.due_date < now()` :
  -- c'est la portee reelle de sendConsolidatedRecap (composeOwnerStatement),
  -- pas seulement sa fraction deja en retard.
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
  )                                                                     AS open_count
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

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- DOWN: restaurer v_armateur_recouvrement dans sa forme mig 121 (retirer open_count).
