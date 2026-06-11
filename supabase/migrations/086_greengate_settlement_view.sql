-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 086: GreenGate v8 Wedge 3 — settlement reporting on collected revenue
--
-- Read-only aggregate view: concessionaire vs sovereign split on PAID transactions.
-- Grouped by (jurisdiction, month, mode) — the natural reporting grain for
-- ministerial reporting and operational dashboards.
--
-- Disbursement is deferred (escrow pending Ministry of Finance agreement).
-- This view is the read surface for T5 (UI disclosure) and future settlement workflows.
--
-- Gross revenue reporting: executed refunds are NOT netted (v1 documented choice).
-- date_trunc month bucketing is UTC (Supabase/PostgreSQL server timezone).
--
-- Bucket semantics:
--   ATTRIBUTED  — split_rule_id IS NOT NULL AND rule.jurisdiction_id = tx.jurisdiction_id
--                 → concessionaire_usd / sovereign_usd reflect the contracted split.
--   UNATTRIBUTED — split_rule_id IS NULL (pre-rule issuance: no rule covered the
--                 issuance date, or the tx predates activation). Amounts are included
--                 in total_usd but excluded from the split sums.
--   MISMATCHED   — split_rule_id IS NOT NULL BUT rule.jurisdiction_id ≠ tx.jurisdiction_id
--                 (snapshot from another jurisdiction — the explicit-override surface in
--                 mig 085). Also excluded from split sums; surfaced for audit / remediation.
--
-- Reconciliation identity (modulo NULLs treated as 0):
--   total_usd = concessionaire_usd + sovereign_usd + unattributed_usd + mismatched_usd
-- (there is no leakage bucket — every PAID dollar lands in exactly one category).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_revenue_split_settlement AS
SELECT j.id   AS jurisdiction_id,
       j.code AS jurisdiction_code,
       date_trunc('month', t.created_at)::date AS month,
       t.mode,
       count(*)                              AS tx_count,
       sum(t.tax_amount_usd)                 AS total_usd,
       -- Split amounts only over ATTRIBUTED, same-jurisdiction rows; the buckets
       -- below surface what is excluded so totals always reconcile.
       sum(t.tax_amount_usd * r.concessionaire_pct / 100.0)
         FILTER (WHERE r.id IS NOT NULL AND r.jurisdiction_id = t.jurisdiction_id) AS concessionaire_usd,
       sum(t.tax_amount_usd * r.sovereign_pct / 100.0)
         FILTER (WHERE r.id IS NOT NULL AND r.jurisdiction_id = t.jurisdiction_id) AS sovereign_usd,
       count(*) FILTER (WHERE t.split_rule_id IS NULL)                             AS unattributed_count,
       sum(t.tax_amount_usd) FILTER (WHERE t.split_rule_id IS NULL)                AS unattributed_usd,
       count(*) FILTER (WHERE r.id IS NOT NULL AND r.jurisdiction_id <> t.jurisdiction_id) AS mismatched_count,
       sum(t.tax_amount_usd) FILTER (WHERE r.id IS NOT NULL AND r.jurisdiction_id <> t.jurisdiction_id) AS mismatched_usd
  FROM public.transactions t
  JOIN public.jurisdictions j ON j.id = t.jurisdiction_id
  LEFT JOIN public.revenue_split_rule r ON r.id = t.split_rule_id
 WHERE t.status = 'PAID'
   -- reconcile bookkeeping FINALs (full amount, no cash behind them) would double-count
   -- the voyage's PAID proforma; ordinary FINALs (related_transaction_id NULL) remain.
   AND NOT (t.document_type = 'FINAL' AND t.related_transaction_id IS NOT NULL)
 GROUP BY j.id, j.code, date_trunc('month', t.created_at), t.mode;

COMMENT ON VIEW public.v_revenue_split_settlement IS
  'Wedge 3 (mig 086): monthly concessionaire/sovereign revenue split on PAID transactions. '
  'Buckets: attributed (split rule matched + same jurisdiction), unattributed (no rule at issuance), '
  'mismatched (rule from another jurisdiction — explicit-override anomaly). '
  'Gross revenue: executed refunds not netted (v1 documented choice). '
  'Disbursement deferred — escrow pending Ministry of Finance agreement.';

GRANT SELECT ON public.v_revenue_split_settlement TO service_role;
-- fiscal aggregates: service-role only (Supabase default-privileges would expose the view via PostgREST).
REVOKE ALL ON public.v_revenue_split_settlement FROM anon, authenticated;

-- DOWN: DROP VIEW IF EXISTS public.v_revenue_split_settlement;
