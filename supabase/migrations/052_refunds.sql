-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 052: Refunds (admin-driven, multi-rail)
-- Resolves wallet_ledger.refund_id forward declaration from 050
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.refund_status AS ENUM
  ('REQUESTED', 'APPROVED', 'EXECUTED', 'REJECTED');

CREATE TABLE public.refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES public.transactions(id),
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id),
  amount_usd_minor BIGINT NOT NULL CHECK (amount_usd_minor > 0),
  refund_rail     public.payment_rail NOT NULL,
  rail_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          public.refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by    UUID REFERENCES public.profiles(id),
  approved_by     UUID REFERENCES public.profiles(id),
  executed_by     UUID REFERENCES public.profiles(id),
  executed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refunds_executed_audit CHECK (
    (status <> 'EXECUTED') OR (executed_by IS NOT NULL AND executed_at IS NOT NULL)
  ),
  CONSTRAINT refunds_approved_audit CHECK (
    (status NOT IN ('APPROVED','EXECUTED')) OR (approved_by IS NOT NULL)
  )
);

CREATE INDEX idx_refunds_owner ON public.refunds(shipowner_id, status);
CREATE INDEX idx_refunds_txn ON public.refunds(transaction_id);

CREATE TRIGGER refunds_updated_at
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Resolve forward declaration on wallet_ledger.refund_id
ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT fk_ledger_refund
  FOREIGN KEY (refund_id) REFERENCES public.refunds(id);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- DOWN:
-- ALTER TABLE public.wallet_ledger DROP CONSTRAINT fk_ledger_refund;
-- DROP TABLE public.refunds;
-- DROP TYPE public.refund_status;
