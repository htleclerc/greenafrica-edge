-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 048: Payments polymorphic table for Plan 7 v1 (10 rails)
-- Renames shipowner_payment_intents → payments, adds rail enum + JSONB details
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enums
CREATE TYPE public.payment_rail AS ENUM (
  'STRIPE',           -- 1 carte / Apple Pay / SEPA via Stripe
  'WIRE_TRANSFER',    -- 2 virement SWIFT/SEPA out-of-band
  'CASH',             -- 3 cash au guichet port
  'CHEQUE',           -- 4 chèque
  'LETTER_OF_CREDIT', -- 5 LC
  'NETTING',          -- 6 compensation/netting (SUPERADMIN)
  'THIRD_PARTY',      -- 7 paiement par tiers
  'MOBILE_MONEY',     -- 8 EVC Plus / Zaad / autre (manuel en v1)
  'BANK_GUARANTEE',   -- 9 standby LC / garantie (SUPERADMIN)
  'WALLET'            -- imputation depuis wallet
);

CREATE TYPE public.payment_status_v7 AS ENUM (
  'INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED'
);

-- 2. Create new payments table
CREATE TABLE public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id),
  declared_by     UUID REFERENCES public.profiles(id),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        TEXT   NOT NULL CHECK (length(currency) = 3),
  amount_usd_minor BIGINT NOT NULL,
  fx_rate         NUMERIC(18,8),
  fx_rate_source  TEXT,
  fx_rate_locked_at TIMESTAMPTZ,
  rail            public.payment_rail NOT NULL,
  rail_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_reference TEXT,
  status          public.payment_status_v7 NOT NULL DEFAULT 'INITIATED',
  rejected_reason TEXT,
  confirmed_by    UUID REFERENCES public.profiles(id),
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payments_currency_amount_consistent CHECK (
    (currency = 'USD' AND amount_minor = amount_usd_minor AND fx_rate IS NULL)
    OR (currency <> 'USD' AND fx_rate IS NOT NULL AND fx_rate > 0)
  ),
  CONSTRAINT payments_confirmed_audit CHECK (
    (status <> 'CONFIRMED') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT payments_stripe_external_ref CHECK (
    NOT (rail = 'STRIPE' AND status IN ('PROCESSING','CONFIRMED','REFUNDED')
         AND external_reference IS NULL)
  )
);

CREATE INDEX idx_payments_owner_status ON public.payments(shipowner_id, status);
CREATE INDEX idx_payments_txn ON public.payments(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_payments_external_ref ON public.payments(external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX idx_payments_pending_admin ON public.payments(rail, status)
  WHERE status IN ('INITIATED','PROCESSING');

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Phase A keeps the legacy table coexisting.
--    Plan 6 v0 frontend (paymentIntentService, declarePaymentIntent,
--    resolvePaymentIntent, /owner/invoices) still writes to
--    shipowner_payment_intents. Phase C of Plan 7 will:
--      a) cut frontend over to public.payments,
--      b) backfill legacy → payments,
--      c) DROP TABLE shipowner_payment_intents.
--    Until then BOTH tables exist; the new one is empty / used by Phase 7B+.

-- 4. Enable RLS (policies added in Phase B/C; Phase A creates structure only)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payments IS
  'Plan 7 v1: polymorphic payment row, one row per attempt. Rail-specific data in rail_details JSONB. Coexists with shipowner_payment_intents (Plan 6 v0) until Phase C cuts the frontend over.';

-- DOWN:
-- DROP TABLE public.payments CASCADE;       -- cascades to payment_proofs (mig 049)
-- DROP TYPE public.payment_status_v7;
-- DROP TYPE public.payment_rail;
-- NB: legacy public.shipowner_payment_intents is intentionally NOT touched in this migration.
