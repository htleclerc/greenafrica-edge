-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 051: Transactions partial payment support
-- Adds PARTIALLY_PAID status + view + recompute function + trigger on payments
-- NOTE: existing transactions.tax_amount_usd is NUMERIC (dollars), so we
--       convert via (t.tax_amount_usd * 100)::BIGINT to get cents (_minor).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID' AFTER 'PENDING';

-- Aggregated view: paid amount per transaction (only CONFIRMED payments count)
CREATE OR REPLACE VIEW public.transaction_paid_summary AS
  SELECT
    t.id AS transaction_id,
    (t.tax_amount_usd * 100)::BIGINT AS due_usd_minor,
    COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0)::BIGINT AS paid_usd_minor,
    ((t.tax_amount_usd * 100)::BIGINT
      - COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0))::BIGINT AS remaining_usd_minor
  FROM public.transactions t
  LEFT JOIN public.payments p ON p.transaction_id = t.id
  GROUP BY t.id;

COMMENT ON VIEW public.transaction_paid_summary IS
  'Plan 7 v1: per-transaction aggregate of confirmed payments. Converts tax_amount_usd (dollars) to BIGINT cents for consistency with payments.amount_usd_minor.';

-- Function to recompute transaction.status based on summary
-- NOTE: Sets both status AND collections_status to maintain invariant
CREATE OR REPLACE FUNCTION public.recompute_transaction_status(p_txn_id UUID)
RETURNS VOID AS $$
DECLARE
  s RECORD;
  new_status public.transaction_status;
  curr_collections_status TEXT;
BEGIN
  SELECT * INTO s FROM public.transaction_paid_summary WHERE transaction_id = p_txn_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Compute new status
  new_status := CASE
    WHEN s.paid_usd_minor >= s.due_usd_minor THEN 'PAID'::public.transaction_status
    WHEN s.paid_usd_minor > 0                THEN 'PARTIALLY_PAID'::public.transaction_status
    ELSE                                          'PENDING'::public.transaction_status
  END;

  -- Read current collections_status to handle transitions
  SELECT collections_status INTO curr_collections_status
    FROM public.transactions WHERE id = p_txn_id;

  UPDATE public.transactions SET
    status = new_status,
    -- If transitioning TO PAID, set collections_status to PAID.
    -- If transitioning FROM PAID (was PAID but now isn't), reset to CURRENT.
    -- Otherwise keep collections_status unchanged.
    collections_status = CASE
      WHEN new_status = 'PAID'::public.transaction_status THEN 'PAID'
      WHEN curr_collections_status = 'PAID' AND new_status <> 'PAID'::public.transaction_status THEN 'CURRENT'
      ELSE curr_collections_status
    END,
    settlement_effective_at = CASE WHEN new_status = 'PAID'::public.transaction_status AND settlement_effective_at IS NULL THEN NOW() ELSE settlement_effective_at END
  WHERE id = p_txn_id;
END $$ LANGUAGE plpgsql;

-- Trigger on payments: recompute transaction status on any status transition
CREATE OR REPLACE FUNCTION public.payments_recompute_txn_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only recompute on transitions involving CONFIRMED (or coming from CONFIRMED)
  IF (TG_OP = 'INSERT' AND NEW.status = 'CONFIRMED')
    OR (TG_OP = 'UPDATE' AND (NEW.status <> OLD.status))
  THEN
    PERFORM public.recompute_transaction_status(NEW.transaction_id);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_recompute_txn_status
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_recompute_txn_status();

-- DOWN:
-- DROP TRIGGER trg_payments_recompute_txn_status ON public.payments;
-- DROP FUNCTION public.payments_recompute_txn_status;
-- DROP FUNCTION public.recompute_transaction_status;
-- DROP VIEW public.transaction_paid_summary;
-- (PARTIALLY_PAID enum value cannot be removed)
