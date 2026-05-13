-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 067: Invariant monitoring views (read-only, ops-facing)
-- Master spec §12.4 — Plan 7H-3.
--
-- Four read-only views surface the operational invariants ops should monitor
-- daily during the canary rollout (and weekly post-J+21):
--   1. v_payments_initiated_overdue — INITIATED payments older than 24h
--      (admin review backlog signal)
--   2. v_stripe_webhook_failures    — STRIPE rail rejections in the last 7d
--      (integration health signal)
--   3. v_wallet_balance_drift       — SUM(ledger) ≠ wallets.balance_usd_minor
--      (CRITICAL money invariant — immediate alarm)
--   4. v_transaction_payment_drift  — SUM(confirmed payments in $) ≠ partial_paid_usd
--      (CRITICAL money invariant — immediate alarm)
--
-- Shipping as views (not RPCs/procs) keeps them queryable from Supabase Studio
-- with no extra primitives, gives Grafana / external dashboards a stable
-- surface, and lets us evolve them without breaking external consumers.
-- ─────────────────────────────────────────────────────────────────────────────

-- View 1: Payments stuck in INITIATED state for more than 24 hours.
-- Operational signal: admin review backlog growing.
CREATE OR REPLACE VIEW public.v_payments_initiated_overdue AS
SELECT
    p.id,
    p.shipowner_id,
    s.name AS shipowner_name,
    p.transaction_id,
    p.amount_usd_minor,
    p.rail,
    p.created_at,
    EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 AS age_hours
FROM public.payments p
LEFT JOIN public.shipowners s ON s.id = p.shipowner_id
WHERE p.status = 'INITIATED'
  AND p.created_at < NOW() - INTERVAL '24 hours'
ORDER BY p.created_at ASC;

COMMENT ON VIEW public.v_payments_initiated_overdue IS
  'Plan 7H-3 (master spec §12.4): payments left INITIATED >24h. Alarm threshold: COUNT > 5.';

-- View 2: Stripe webhook failures (rail=STRIPE payments rejected via webhook).
-- Operational signal: Stripe integration health / chargeback patterns.
-- Filter on rejected_reason prefix 'Stripe:' isolates webhook-driven rejections
-- from admin-driven ones (which use free-form text per Plan 7C-3).
CREATE OR REPLACE VIEW public.v_stripe_webhook_failures AS
SELECT
    p.id,
    p.shipowner_id,
    s.name AS shipowner_name,
    p.transaction_id,
    p.amount_usd_minor,
    p.rejected_reason,
    p.external_reference AS stripe_payment_intent_id,
    p.created_at,
    p.updated_at AS rejected_at
FROM public.payments p
LEFT JOIN public.shipowners s ON s.id = p.shipowner_id
WHERE p.rail = 'STRIPE'
  AND p.status = 'REJECTED'
  AND p.rejected_reason LIKE 'Stripe:%'
  AND p.updated_at > NOW() - INTERVAL '7 days'
ORDER BY p.updated_at DESC;

COMMENT ON VIEW public.v_stripe_webhook_failures IS
  'Plan 7H-3 (master spec §12.4): Stripe rail rejections in last 7d. Alarm threshold: COUNT > 0.';

-- View 3: Wallet balance drift (SUM(ledger) ≠ wallet.balance_usd_minor).
-- CRITICAL invariant — immediate alarm per master spec §12.4.
-- The append-only ledger (mig 050 prevent_ledger_mutation) is the source of
-- truth; any divergence indicates a code path that bypassed the
-- apply_ledger_to_wallet trigger.
CREATE OR REPLACE VIEW public.v_wallet_balance_drift AS
SELECT
    w.id AS wallet_id,
    w.shipowner_id,
    s.name AS shipowner_name,
    w.balance_usd_minor AS reported_balance,
    COALESCE(SUM(l.amount_signed_usd_minor), 0) AS computed_balance,
    w.balance_usd_minor - COALESCE(SUM(l.amount_signed_usd_minor), 0) AS drift_minor
FROM public.wallets w
LEFT JOIN public.wallet_ledger l ON l.wallet_id = w.id
LEFT JOIN public.shipowners s ON s.id = w.shipowner_id
GROUP BY w.id, w.shipowner_id, s.name, w.balance_usd_minor
HAVING w.balance_usd_minor != COALESCE(SUM(l.amount_signed_usd_minor), 0)
ORDER BY ABS(w.balance_usd_minor - COALESCE(SUM(l.amount_signed_usd_minor), 0)) DESC;

COMMENT ON VIEW public.v_wallet_balance_drift IS
  'Plan 7H-3 (master spec §12.4): wallet ledger drift. IMMEDIATE-ALARM signal: COUNT > 0 = money correctness breach.';

-- View 4: Transaction payment drift.
-- (SUM(payments confirmed) in dollars ≠ transactions.partial_paid_usd)
-- CRITICAL invariant — immediate alarm per master spec §12.4.
-- Note: payments.amount_usd_minor is BIGINT minor units; transactions.partial_paid_usd
-- is NUMERIC dollars (memory gotcha — schema diverges from a single unit). Convert
-- payments to dollars via /100.0 (numeric domain — no integer truncation).
-- Tolerance of 0.01 cents absorbs FP rounding from the divide.
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
GROUP BY t.id, t.invoice_ref, t.shipowner_id, s.name, t.tax_amount_usd, t.partial_paid_usd
HAVING ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) > 0.01
ORDER BY ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) DESC;

COMMENT ON VIEW public.v_transaction_payment_drift IS
  'Plan 7H-3 (master spec §12.4): transaction.partial_paid_usd vs SUM(confirmed payments). IMMEDIATE-ALARM signal: COUNT > 0 = money correctness breach.';

-- Grant SELECT to service_role for admin dashboard / Grafana use.
-- Views inherit row-level security from base tables when accessed via authenticated
-- roles; service_role bypasses RLS, which is required for ops-wide aggregates.
GRANT SELECT ON public.v_payments_initiated_overdue TO service_role;
GRANT SELECT ON public.v_stripe_webhook_failures   TO service_role;
GRANT SELECT ON public.v_wallet_balance_drift      TO service_role;
GRANT SELECT ON public.v_transaction_payment_drift TO service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_payments_initiated_overdue;
-- DROP VIEW IF EXISTS public.v_stripe_webhook_failures;
-- DROP VIEW IF EXISTS public.v_wallet_balance_drift;
-- DROP VIEW IF EXISTS public.v_transaction_payment_drift;
