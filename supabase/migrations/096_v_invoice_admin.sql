-- ============================================================================
-- 096_v_invoice_admin.sql
-- Vue de lecture pour la liste admin globale des factures (Sprint 2, ss-projet 3).
-- Agrège à plat les transactions "facture" (PROFORMA/FINAL/COMPLEMENT/REFUND),
-- maritime + aviation, jointes au débiteur (shipowners) et à la juridiction
-- émettrice (jurisdictions). security_invoker => hérite des RLS sous-jacentes.
-- ADDITIVE. Lecture seule.
-- ============================================================================

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
    (t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) AS outstanding_usd,
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
LEFT JOIN public.shipowners s   ON t.shipowner_id = s.id
LEFT JOIN public.jurisdictions j ON t.jurisdiction_id = j.id
WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND');

GRANT SELECT ON public.v_invoice_admin TO authenticated, service_role;

-- DOWN: DROP VIEW IF EXISTS public.v_invoice_admin;
