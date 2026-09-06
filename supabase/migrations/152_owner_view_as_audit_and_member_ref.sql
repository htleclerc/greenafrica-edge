-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 152 : « voir comme l'armateur » tracé, et référence publique des membres
--
-- 1. OWNER_VIEW_AS dans audit_action. Un membre du staff qui ouvre le portail
--    d'un armateur en lecture seule consulte des données personnelles et
--    financières : chaque ouverture s'inscrit dans audit_logs (acteur, compte,
--    navire éventuel, page). Sans valeur d'enum, l'insert échouait en silence.
--
-- 2. owner_members.public_ref (`mbr_` + 12 hex). Même règle que les mig 144 et
--    147 : l'annuaire et la vue « voir comme ce membre » désignent une
--    appartenance dans l'URL, jamais par son UUID ni par l'adresse e-mail.
--
-- 3. v_navire_recouvrement porte `vessel_public_ref` (mig 147) en fin de liste,
--    pour que la liste des navires lie « voir comme ce navire » sans UUID.
--    CREATE OR REPLACE VIEW n'autorise que l'ajout EN FIN : définition de la
--    mig 145 recopiée à l'identique, plus la colonne.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'OWNER_VIEW_AS';

ALTER TABLE public.owner_members
  ADD COLUMN IF NOT EXISTS public_ref TEXT;

UPDATE public.owner_members
   SET public_ref = 'mbr_' || encode(gen_random_bytes(6), 'hex')
 WHERE public_ref IS NULL;

ALTER TABLE public.owner_members
  ALTER COLUMN public_ref SET NOT NULL,
  ALTER COLUMN public_ref SET DEFAULT 'mbr_' || encode(gen_random_bytes(6), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS owner_members_public_ref_unique
  ON public.owner_members(public_ref);

COMMENT ON COLUMN public.owner_members.public_ref IS
  'Mig 152 : référence opaque d''une appartenance, exposée dans les URL admin à la place de l''UUID. Tirée au hasard.';

-- ── Encours par navire (mig 145 recopiée, + vessel_public_ref) ──────────────
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
  s.public_ref                                                          AS shipowner_public_ref,
  -- ── nouvelle colonne (mig 152) ────────────────────────────────────────────
  v.public_ref                                                          AS vessel_public_ref
FROM public.vessels v
LEFT JOIN public.transactions t ON t.vessel_id = v.id
LEFT JOIN public.v_transaction_outstanding o ON o.transaction_id = t.id
LEFT JOIN public.shipowners s ON s.id = v.shipowner_id
GROUP BY v.id, s.name, s.is_ofac_sdn, s.is_un_prohibited, s.public_ref;

-- DOWN:
-- (v_navire_recouvrement : rejouer la définition de la mig 145)
-- DROP INDEX IF EXISTS public.owner_members_public_ref_unique;
-- ALTER TABLE public.owner_members DROP COLUMN IF EXISTS public_ref;
-- (une valeur d'enum ne se retire pas)
