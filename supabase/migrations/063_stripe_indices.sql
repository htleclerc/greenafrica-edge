-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 063: Indices supporting the STRIPE rail (Plan 7D)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The Stripe webhook handler looks up the corresponding payments row by
-- external_reference (= stripe_payment_intent_id). A partial index keeps
-- the lookup fast without bloating the index for non-Stripe rails.

CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi
    ON public.payments (external_reference)
    WHERE rail = 'STRIPE' AND external_reference IS NOT NULL;

COMMENT ON INDEX public.idx_payments_stripe_pi IS
    'Plan 7D: fast webhook lookup by stripe_payment_intent_id. Partial: only Stripe payments.';
