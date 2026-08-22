-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 132 : le reste dû se lit dans les paiements, plus dans une colonne
--                 morte.
--
-- CONSTAT. Toutes les vues d'encours calculent
-- `tax_amount_usd - COALESCE(partial_paid_usd, 0)`. Or cette colonne N'EST
-- JAMAIS ÉCRITE :
--   · mig 022 l'a créée et remplie une seule fois (les factures déjà PAID en
--     mars 2025) ;
--   · mig 051 `recompute_transaction_status` passe bien le statut à
--     PARTIALLY_PAID, mais ne touche pas la colonne ;
--   · mig 089 la classe FROZEN, en constatant justement qu'« aucun chemin
--     d'écriture de production n'existe ».
-- Elle vaut donc zéro sur toute facture en cours, et l'encours affiché est le
-- montant PLEIN d'une facture déjà réglée en partie.
--
-- En production au 2026-08-22, trois pro-formas maritimes portaient
-- 12 055,57 USD d'encaissements confirmés, réclamés en totalité par le relevé,
-- le tableau de bord recouvrement, les cockpits et les lettres de relance.
--
-- L'alarme prévue pour ça (`v_transaction_payment_drift`, mig 067/068) ne les
-- voyait pas : mig 068 lui a ajouté un plancher `created_at >= 2026-05-01`
-- pour taire quatre faux positifs hérités, et les trois factures concernées
-- sont antérieures. L'invariant que cette alarme énonce —
-- « partial_paid_usd = SUM(paiements CONFIRMED) » — dit bien où est la vérité :
-- dans `payments`.
--
-- CORRECTION. Une vue unique, `v_transaction_outstanding`, calcule le montant
-- encaissé et le reste dû par facture depuis les paiements CONFIRMED. Les cinq
-- vues d'encours la consomment au lieu de lire la colonne. `partial_paid_usd`
-- reste gelée et sans lecteur : la corriger par un trigger aurait recréé un
-- agrégat dénormalisé, c'est-à-dire la dérive que mig 067 surveille déjà.
--
-- security_invoker = true sur la vue partagée : sans cela, les vues appelantes
-- (toutes en invoker) délégueraient la lecture de `transactions` et `payments`
-- au propriétaire de la vue, et un agent d'une juridiction verrait l'encours
-- d'une autre.
--
-- DEUX CHANGEMENTS DE PÉRIMÈTRE, assumés, dans les cockpits armateur et
-- compagnie :
--   1. les pro-formas ANNULÉES (VOID) sortent de `proforma_count`,
--      `total_invoiced_usd` et `total_outstanding_usd`. Elles y entraient
--      jusqu'ici : après la rebascule du livre maritime, 86 lignes annulées du
--      seed auraient gonflé la dette de dossiers qui ne doivent rien.
--   2. `total_invoiced_usd - total_paid_usd = total_outstanding_usd` devient
--      vrai. Les trois colonnes portent désormais le même périmètre, alors que
--      `total_outstanding_usd` n'avait aucun filtre de statut et comptait une
--      facture soldée à son montant plein.
-- EXEMPT et CREDIT_NOTE_ISSUED sont traités comme VOID : rien n'est dû.
-- DISPUTED reste dû — une contestation est une demande, pas une extinction.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Vue partagée : montant encaissé et reste dû, par facture ────────────────
CREATE OR REPLACE VIEW public.v_transaction_outstanding
WITH (security_invoker = true) AS
SELECT
  t.id                                       AS transaction_id,
  t.shipowner_id,
  t.jurisdiction_id,
  t.document_type,
  t.mode,
  t.status,
  t.due_date,
  t.tax_amount_usd,
  -- Encaissement réel, NON borné au montant de la facture : un trop-perçu doit
  -- rester visible pour être remboursé, pas être silencieusement absorbé.
  COALESCE(p.paid_usd, 0)                    AS paid_usd,
  CASE
    WHEN t.status IN ('VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED') THEN 0
    ELSE GREATEST(t.tax_amount_usd - COALESCE(p.paid_usd, 0), 0)
  END                                        AS outstanding_usd,
  (t.status NOT IN ('VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED')) AS is_claimable
FROM public.transactions t
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(pm.amount_usd_minor), 0) / 100.0 AS paid_usd
  FROM public.payments pm
  WHERE pm.transaction_id = t.id
    AND pm.status = 'CONFIRMED'
) p ON TRUE;

COMMENT ON VIEW public.v_transaction_outstanding IS
  'Mig 132 : montant encaissé (paiements CONFIRMED) et reste dû par facture. Source unique de l''encours — ne jamais recalculer depuis transactions.partial_paid_usd, colonne gelée et jamais écrite (mig 089).';

GRANT SELECT ON public.v_transaction_outstanding TO authenticated, service_role;

-- ── Cockpit armateurs (mig 127 recopiée, encours corrigé) ───────────────────
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
  )                                                                     AS open_count
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

-- ── Cockpit compagnies aériennes (mig 097 recopiée, encours corrigé) ────────
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
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR' AND o.is_claimable
  )                                                                     AS proforma_count,
  COALESCE(SUM(t.tax_amount_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR' AND o.is_claimable
  ), 0)                                                                 AS total_invoiced_usd,
  COALESCE(SUM(o.paid_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR' AND o.is_claimable
  ), 0)                                                                 AS total_paid_usd,
  COALESCE(SUM(o.outstanding_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_outstanding_usd
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
LEFT JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
WHERE s.iata_code IS NOT NULL
GROUP BY s.id;

GRANT SELECT ON public.v_compagnie_recouvrement TO authenticated, service_role;

-- ── Tableau de bord règlements (mig 121 recopiée, encours corrigé) ──────────
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

  (SELECT COALESCE(SUM(o.outstanding_usd), 0)
     FROM public.v_transaction_outstanding o
    WHERE o.jurisdiction_id = j.id AND o.document_type = 'PROFORMA' AND o.mode = 'MARITIME'
      AND o.status IN ('PENDING','OVERDUE','PARTIALLY_PAID'))         AS total_outstanding_usd,
  (SELECT COALESCE(SUM(o.outstanding_usd), 0)
     FROM public.v_transaction_outstanding o
    WHERE o.jurisdiction_id = j.id AND o.document_type = 'PROFORMA' AND o.mode = 'MARITIME'
      AND o.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND o.due_date < now())                                         AS overdue_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                         AS overdue_count
FROM public.jurisdictions j;

GRANT SELECT ON public.v_reglements_dashboard TO authenticated, service_role;

-- ── Écran recouvrement staff (mig 126 recopiée, encours corrigé) ────────────
CREATE OR REPLACE VIEW public.v_collection_admin WITH (security_invoker = true) AS
SELECT
  t.id                       AS transaction_id,
  t.invoice_ref,
  t.status,
  t.tax_amount_usd,
  o.outstanding_usd,
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
JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN public.shipowners   s ON s.id = t.shipowner_id
LEFT JOIN public.jurisdictions j ON j.id = t.jurisdiction_id;

GRANT SELECT ON public.v_collection_admin TO authenticated, service_role;

-- ── Liste des factures staff (mig 096 recopiée, encours corrigé) ────────────
-- `partial_paid_usd` reste exposée telle quelle : la colonne existe encore et
-- des consommateurs la lisent. Elle vaut zéro, et c'est désormais
-- `outstanding_usd` qui porte la vérité.
CREATE OR REPLACE VIEW public.v_invoice_admin
WITH (security_invoker = true) AS
SELECT
    t.id,
    t.invoice_ref,
    t.content_hash,
    t.verify_signature,
    t.document_type,
    t.mode,
    t.status,
    t.tax_amount_usd,
    t.partial_paid_usd,
    o.outstanding_usd,
    t.created_at,
    t.due_date,
    t.paid_at,
    t.vessel_name,
    t.vessel_imo,
    t.shipowner_id,
    s.name          AS debtor_name,
    s.country_code  AS flag_country,
    t.jurisdiction_id,
    j.code          AS jurisdiction_code,
    j.name          AS jurisdiction_name,
    (t.mode = 'AIR' OR s.iata_code IS NOT NULL) AS is_aviation
FROM public.transactions t
JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN public.shipowners s   ON t.shipowner_id = s.id
LEFT JOIN public.jurisdictions j ON t.jurisdiction_id = j.id
WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND');

GRANT SELECT ON public.v_invoice_admin TO authenticated, service_role;

-- DOWN : restaurer les définitions des migrations 096, 097, 121, 126 et 127,
-- puis DROP VIEW public.v_transaction_outstanding. L'encours redeviendrait
-- alors le montant plein de toute facture réglée en partie.
