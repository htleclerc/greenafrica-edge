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

-- 3. Migrate existing rows from shipowner_payment_intents (Plan 6 v0)
-- (likely empty in prod, but executed for safety)
INSERT INTO public.payments (
  id, transaction_id, shipowner_id, declared_by,
  amount_minor, currency, amount_usd_minor,
  rail, rail_details, status, created_at, updated_at
)
SELECT
  pi.id,
  pi.transaction_id,
  -- pi.declared_by is the profile that declared the intent; resolve to its shipowner
  (SELECT s.id FROM public.shipowners s WHERE s.profile_id = pi.declared_by LIMIT 1),
  pi.declared_by,
  COALESCE((t.tax_amount_usd * 100)::BIGINT, 0),
  'USD',
  COALESCE((t.tax_amount_usd * 100)::BIGINT, 0),
  'WIRE_TRANSFER'::public.payment_rail,
  jsonb_build_object('legacy_v0', true, 'reference', pi.reference),
  CASE pi.status::TEXT
    WHEN 'DECLARED'  THEN 'INITIATED'::public.payment_status_v7
    WHEN 'CONFIRMED' THEN 'CONFIRMED'::public.payment_status_v7
    WHEN 'REJECTED'  THEN 'REJECTED'::public.payment_status_v7
  END,
  pi.declared_at,
  pi.updated_at
FROM public.shipowner_payment_intents pi
LEFT JOIN public.transactions t ON t.id = pi.transaction_id
WHERE EXISTS (SELECT 1 FROM public.shipowners s WHERE s.profile_id = pi.declared_by);

-- 4. Drop legacy table (data migrated above)
DROP TABLE IF EXISTS public.shipowner_payment_intents CASCADE;
DROP TYPE IF EXISTS public.shipowner_payment_intent_status;

-- 5. Enable RLS (policies added in Phase B/C; Phase A creates structure only)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payments IS
  'Plan 7 v1: polymorphic payment row, one row per attempt. Rail-specific data in rail_details JSONB.';

-- DOWN:
-- DROP TABLE public.payments CASCADE;
-- DROP TYPE public.payment_status_v7;
-- DROP TYPE public.payment_rail;
