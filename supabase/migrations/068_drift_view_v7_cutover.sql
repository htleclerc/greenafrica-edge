-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 068: Filter v_transaction_payment_drift to v7-era transactions only
--
-- Plan 7H-3 mig 067 shipped v_transaction_payment_drift as a money-correctness
-- alarm: SUM(payments confirmed) ≠ transactions.partial_paid_usd. On the
-- hosted DB it immediately returned 4 rows — all `PAID` transactions from
-- March 2025, paid under the legacy v0 payment flow before Plan 7 existed
-- (the v7 `payments` table started empty at Plan 7A — mig 048 — so
-- computed_paid_usd is 0 while reported_paid_usd > 0 for any pre-v7 paid
-- transaction). The runbook treats > 0 as an IMMEDIATE alarm — with 4
-- permanent legacy false-positives, the alarm is always-on and masks real
-- future drift.
--
-- Fix: add a v7-cutover date floor (2026-05-01, master spec launch date).
-- Pre-v7 transactions are explicitly out of scope for this invariant — they
-- never went through the v7 `payments` flow and can't be reconciled against it.
--
-- The other 3 invariant views from mig 067 don't need this filter:
--   - v_payments_initiated_overdue: payments table is v7-only (mig 048+)
--   - v_stripe_webhook_failures: same, plus filters on `rail='STRIPE'`
--   - v_wallet_balance_drift: wallets table is v7-only (mig 050+)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_transaction_payment_drift AS
SELECT
    t.id AS transaction_id,
    t.invoice_ref,
    t.shipowner_id,
    s.name AS shipowner_name,
    t.tax_amount_usd,
    t.partial_paid_usd AS reported_paid_usd,
    COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0 AS computed_paid_usd,
    t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0) AS drift_usd
FROM public.transactions t
LEFT JOIN public.payments p ON p.transaction_id = t.id
LEFT JOIN public.shipowners s ON s.id = t.shipowner_id
WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT')
  -- Plan 7 launch date — pre-v7 transactions paid under the legacy v0 flow
  -- are intentionally excluded (see migration header).
  AND t.created_at >= TIMESTAMPTZ '2026-05-01 00:00:00+00'
GROUP BY t.id, t.invoice_ref, t.shipowner_id, s.name, t.tax_amount_usd, t.partial_paid_usd
HAVING ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) > 0.01
ORDER BY ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) DESC;

COMMENT ON VIEW public.v_transaction_payment_drift IS
  'Plan 7H-3 + mig 068 (master spec §12.4): v7-era transaction.partial_paid_usd vs SUM(confirmed payments). IMMEDIATE-ALARM signal: COUNT > 0 = money correctness breach. Filters created_at >= 2026-05-01 to exclude pre-v7 legacy transactions paid under the v0 flow.';

GRANT SELECT ON public.v_transaction_payment_drift TO service_role;

-- DOWN:
-- -- Restore mig 067's version without the date filter (legacy rows would re-appear)
-- CREATE OR REPLACE VIEW public.v_transaction_payment_drift AS
-- SELECT
--     t.id AS transaction_id,
--     t.invoice_ref,
--     t.shipowner_id,
--     s.name AS shipowner_name,
--     t.tax_amount_usd,
--     t.partial_paid_usd AS reported_paid_usd,
--     COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0 AS computed_paid_usd,
--     t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0) AS drift_usd
-- FROM public.transactions t
-- LEFT JOIN public.payments p ON p.transaction_id = t.id
-- LEFT JOIN public.shipowners s ON s.id = t.shipowner_id
-- WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT')
-- GROUP BY t.id, t.invoice_ref, t.shipowner_id, s.name, t.tax_amount_usd, t.partial_paid_usd
-- HAVING ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) > 0.01
-- ORDER BY ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) DESC;
-- GRANT SELECT ON public.v_transaction_payment_drift TO service_role;
