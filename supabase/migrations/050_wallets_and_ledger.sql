-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 050: Wallets (1 per shipowner) + double-entry ledger
-- Invariant: SUM(wallet_ledger.amount_signed) = wallets.balance (per wallet)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.wallets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id             UUID NOT NULL UNIQUE REFERENCES public.shipowners(id),
  balance_usd_minor        BIGINT NOT NULL DEFAULT 0,
  auto_apply_to_proforma   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_balance_non_negative CHECK (balance_usd_minor >= 0)
);

CREATE TRIGGER wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TYPE public.ledger_entry_kind AS ENUM (
  'TOPUP', 'OVERPAYMENT_CREDIT', 'REFUND_CREDIT',
  'PROFORMA_APPLY', 'ADMIN_ADJUSTMENT', 'FX_DIFFERENCE'
);

CREATE TABLE public.wallet_ledger (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id                UUID NOT NULL REFERENCES public.wallets(id),
  amount_signed_usd_minor  BIGINT NOT NULL,
  kind                     public.ledger_entry_kind NOT NULL,
  payment_id               UUID REFERENCES public.payments(id),
  transaction_id           UUID REFERENCES public.transactions(id),
  refund_id                UUID,                       -- forward decl. → 052
  created_by               UUID NOT NULL REFERENCES public.profiles(id),
  justification            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_amount_nonzero CHECK (amount_signed_usd_minor <> 0),
  CONSTRAINT ledger_admin_adjustment_justified
    CHECK (kind <> 'ADMIN_ADJUSTMENT' OR justification IS NOT NULL)
);

CREATE INDEX idx_ledger_wallet_created
  ON public.wallet_ledger(wallet_id, created_at DESC);

-- Trigger to maintain wallets.balance = SUM(ledger). Uses FOR UPDATE to serialize concurrent writes.
CREATE FUNCTION public.apply_ledger_to_wallet() RETURNS TRIGGER AS $$
DECLARE
  current_balance BIGINT;
  new_balance BIGINT;
BEGIN
  -- Lock the wallet row to prevent race conditions
  SELECT balance_usd_minor INTO current_balance
    FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
  new_balance := current_balance + NEW.amount_signed_usd_minor;

  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Wallet balance would go negative: % + % = %',
      current_balance, NEW.amount_signed_usd_minor, new_balance
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.wallets
     SET balance_usd_minor = new_balance,
         updated_at = NOW()
   WHERE id = NEW.wallet_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_apply
  AFTER INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.apply_ledger_to_wallet();

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallets IS
  'Plan 7 v1: one wallet per shipowner, USD only. Balance maintained by trigger from wallet_ledger.';
COMMENT ON TABLE public.wallet_ledger IS
  'Plan 7 v1: append-only double-entry ledger. INVARIANT: SUM(amount_signed) per wallet_id = wallets.balance_usd_minor.';

-- DOWN:
-- DROP TRIGGER trg_ledger_apply ON public.wallet_ledger;
-- DROP FUNCTION public.apply_ledger_to_wallet;
-- DROP TABLE public.wallet_ledger;
-- DROP TYPE public.ledger_entry_kind;
-- DROP TABLE public.wallets;
