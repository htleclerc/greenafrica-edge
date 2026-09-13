-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 160 : le mode d'activité devient le référentiel
--
-- Constat. Les six opérateurs aériens de production portent tous
-- `applicable_modes = {MARITIME}`. Ils ont 556 pro-formas AIR, sept aéronefs,
-- zéro navire et zéro transaction maritime : la colonne dit le contraire de ce
-- que disent les faits. Le portail opérateur filtre sur cette colonne — il leur
-- servirait un shell maritime.
--
-- Cause. Ces lignes viennent de l'import d'onboarding, qui ne renseigne pas
-- `applicable_modes` : elles ont hérité du défaut `{MARITIME}` posé par la
-- mig 071. La détection ADS-B, seul chemin qui pose `{AIR}`, n'a jamais rien
-- ingéré en production.
--
-- Trois discriminants coexistaient pour la même question « est-ce de
-- l'aviation ? » : `iata_code` dans les cockpits, `applicable_modes` au
-- portail, et `t.mode = 'AIR' OR iata_code IS NOT NULL` dans la vue des
-- factures. Le code IATA n'a jamais été un discriminant de mode — c'est une
-- immatriculation commerciale, et un opérateur peut légitimement ne pas en
-- avoir. « Charter divers (multiples opérateurs) » est dans ce cas : 25
-- pro-formas aériennes, absente du cockpit compagnies, comptée à tort parmi
-- les armateurs maritimes.
--
-- Cette migration fait de `applicable_modes` la source unique, aligne les
-- trois vues dessus, et empêche le mode vide qui ferait disparaître une ligne
-- des deux cockpits à la fois.
--
-- Le sens de `@>` est délibéré : un opérateur réellement mixte apparaît dans
-- les DEUX cockpits, ce qu'aucun des deux discriminants précédents ne savait
-- exprimer.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Redressement des lignes déjà en base ────────────────────────────────
-- Faisceau d'indices aviation : un code IATA, un aéronef, ou une transaction
-- AIR. On ne retire `MARITIME` que si RIEN ne rattache l'opérateur à la mer
-- (ni navire, ni transaction maritime) — sinon on ajoute `AIR` sans rien
-- perdre. Sur la production d'aujourd'hui la seconde branche ne concerne
-- personne, mais elle évite qu'un futur opérateur mixte soit amputé.
UPDATE public.shipowners s
SET applicable_modes = CASE
      WHEN EXISTS (SELECT 1 FROM public.vessels v WHERE v.shipowner_id = s.id)
        OR EXISTS (SELECT 1 FROM public.transactions t
                    WHERE t.shipowner_id = s.id AND t.mode = 'MARITIME')
      THEN (
        SELECT array_agg(DISTINCT m ORDER BY m)
        FROM unnest(s.applicable_modes || ARRAY['AIR']::public.transport_mode[]) m
      )
      ELSE ARRAY['AIR']::public.transport_mode[]
    END
WHERE NOT (s.applicable_modes @> ARRAY['AIR']::public.transport_mode[])
  AND (
    s.iata_code IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.aircraft a WHERE a.operator_id = s.id)
    OR EXISTS (SELECT 1 FROM public.transactions t
                WHERE t.shipowner_id = s.id AND t.mode = 'AIR')
  );

-- ── 2. Le mode vide devient impossible ─────────────────────────────────────
-- Les vues filtrent désormais par appartenance : un tableau vide ferait
-- disparaître l'opérateur du cockpit maritime ET du cockpit aviation, sans
-- message d'erreur. C'est exactement le défaut que cette migration corrige —
-- autant fermer la porte.
ALTER TABLE public.shipowners
  DROP CONSTRAINT IF EXISTS shipowners_applicable_modes_not_empty;
ALTER TABLE public.shipowners
  ADD CONSTRAINT shipowners_applicable_modes_not_empty
  CHECK (cardinality(applicable_modes) >= 1);

COMMENT ON COLUMN public.shipowners.applicable_modes IS
  'Mode(s) d''activité de l''opérateur. SOURCE UNIQUE du mode : les cockpits '
  'armateurs/compagnies, la vue des factures et le portail opérateur filtrent '
  'tous dessus (mig 160). Ne PAS se servir de iata_code pour déduire un mode — '
  'c''est une immatriculation commerciale, facultative.';

-- ── 3. Cockpit armateurs (mig 145 recopiée, filtre par mode) ──────────────
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
WHERE s.applicable_modes @> ARRAY['MARITIME']::public.transport_mode[]
GROUP BY s.id, r.last_auto_tier, r.last_reminder_at, r.latest_response_type;

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- ── 4. Cockpit compagnies aériennes (mig 132 recopiée, filtre par mode) ───
-- « Charter divers » entre ici sans code IATA : la colonne reste exposée,
-- l'écran l'affiche déjà « — » quand elle est nulle.
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
WHERE s.applicable_modes @> ARRAY['AIR']::public.transport_mode[]
GROUP BY s.id;

GRANT SELECT ON public.v_compagnie_recouvrement TO authenticated, service_role;

-- ── 5. Liste des factures staff (mig 132 recopiée, is_aviation par mode) ──
-- COALESCE : le LEFT JOIN rend NULL pour une transaction sans opérateur,
-- et NULL n'est pas « pas de l'aviation ».
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
    COALESCE(t.mode = 'AIR' OR s.applicable_modes @> ARRAY['AIR']::public.transport_mode[], false) AS is_aviation
FROM public.transactions t
JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN public.shipowners s   ON t.shipowner_id = s.id
LEFT JOIN public.jurisdictions j ON t.jurisdiction_id = j.id
WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND');

GRANT SELECT ON public.v_invoice_admin TO authenticated, service_role;

-- DOWN:
-- ALTER TABLE public.shipowners DROP CONSTRAINT IF EXISTS shipowners_applicable_modes_not_empty;
-- puis restaurer les définitions des migrations 145 (v_armateur_recouvrement)
-- et 132 (v_compagnie_recouvrement, v_invoice_admin).
-- Le redressement des données n'est pas réversible automatiquement : il faudrait
-- reposer {MARITIME} sur les opérateurs aériens, c'est-à-dire réintroduire le
-- défaut faux.
