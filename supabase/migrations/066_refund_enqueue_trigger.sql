-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 066: Auto-enqueue refunds on REFUND transaction creation +
-- relax refund_rail to nullable (admin picks rail at approve time per spec §7.7)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.refunds
  ALTER COLUMN refund_rail DROP NOT NULL;

-- Add a partial CHECK so non-REQUESTED rows still require a rail (defensive)
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_rail_required_after_request CHECK (
    status = 'REQUESTED' OR refund_rail IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.enqueue_refund_on_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Idempotency: skip if a refunds row already exists for this transaction
  IF EXISTS (SELECT 1 FROM public.refunds WHERE transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- shipowner_id required to insert; transactions without an owner stay in
  -- limbo (admin can hand-create a refund row via /admin/refunds if needed)
  IF NEW.shipowner_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.refunds (
    transaction_id,
    shipowner_id,
    amount_usd_minor,
    refund_rail,
    status
  ) VALUES (
    NEW.id,
    NEW.shipowner_id,
    -- transactions.tax_amount_usd is NUMERIC dollars (memory: gotchas).
    -- Refund is positive magnitude (mig 022 forbids negative); accounting
    -- direction is on breakdown_json.refundDirection.
    (NEW.tax_amount_usd * 100)::BIGINT,
    NULL,            -- admin sets at APPROVE time
    'REQUESTED'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refund_enqueue
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.document_type = 'REFUND')
  EXECUTE FUNCTION public.enqueue_refund_on_transaction();

-- DOWN:
-- DROP TRIGGER trg_refund_enqueue ON public.transactions;
-- DROP FUNCTION public.enqueue_refund_on_transaction();
-- ALTER TABLE public.refunds DROP CONSTRAINT refunds_rail_required_after_request;
-- ALTER TABLE public.refunds ALTER COLUMN refund_rail SET NOT NULL;
