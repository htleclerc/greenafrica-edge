-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 060: Multi-active providers + rail routing
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mig 013 added a partial unique index `payment_config_single_active` that
-- forbade more than one provider being is_active=true at the same time. Plan
-- 7C-2 lifts that lock: with v7 rails (mig 048), each provider serves a SUBSET
-- of rails, so multiple providers can coexist (e.g. Flutterwave for
-- MOBILE_MONEY in NGN/KES, Wave for MOBILE_MONEY in XOF, Wire for everything
-- else). Routing happens in TS via selectProvidersForRail(rail, currency).

-- 1. Drop the single-active invariant
DROP INDEX IF EXISTS public.payment_config_single_active;

-- 2. Declare which v7 rails each provider can serve
ALTER TABLE public.payment_config
    ADD COLUMN IF NOT EXISTS routes_rail TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.payment_config.routes_rail IS
    'Subset of payment_method enum values this provider can process. Read by paymentService.selectProvidersForRail().';

-- 3. Seed the rails per provider (idempotent — only sets if currently empty)
UPDATE public.payment_config SET routes_rail = ARRAY['STRIPE']::TEXT[]
    WHERE provider = 'stripe' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['STRIPE','MOBILE_MONEY']::TEXT[]
    WHERE provider = 'paystack' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['STRIPE','MOBILE_MONEY']::TEXT[]
    WHERE provider = 'flutterwave' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['MOBILE_MONEY']::TEXT[]
    WHERE provider = 'wave' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['THIRD_PARTY']::TEXT[]
    WHERE provider = 'payoneer' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['WIRE_TRANSFER']::TEXT[]
    WHERE provider = 'wire_transfer' AND cardinality(routes_rail) = 0;
