-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015: Add Payoneer provider + make Flutterwave the active default
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Two changes:
-- 1. Insert a `payoneer` row into payment_config so the admin panel exposes it.
-- 2. Switch the active provider from `wire_transfer` to `flutterwave`.
--    Flutterwave is the broadest-coverage online provider in our matrix
--    (Africa + EU + US, multi-currency, hosted checkout) so it's the
--    pragmatic default for production. Wire stays available as a manual
--    fallback for institutional payments.
--
-- The single-active partial unique index from migration 013 means we MUST
-- deactivate the current row before activating a new one — otherwise the
-- INSERT/UPDATE will fail. We do it in one statement using a CTE so the
-- index sees a consistent state at commit time.

-- 1) Add Payoneer (idempotent — ON CONFLICT DO NOTHING)
INSERT INTO public.payment_config
    (provider, display_name, is_enabled, is_active, test_mode, display_order)
VALUES
    ('payoneer', 'Payoneer (B2B Cross-Border)', false, false, true, 5)
ON CONFLICT (provider) DO NOTHING;

-- Bump wire_transfer's display order so Payoneer slots in before it
UPDATE public.payment_config SET display_order = 6 WHERE provider = 'wire_transfer';

-- 2) Switch active provider to flutterwave atomically.
--    Wrap in a transaction so the partial unique index never sees two
--    is_active=true rows simultaneously.
BEGIN;
    -- Clear all is_active flags first
    UPDATE public.payment_config SET is_active = false WHERE is_active = true;
    -- Activate Flutterwave (also enable it — admin can disable in UI later)
    UPDATE public.payment_config
       SET is_active  = true,
           is_enabled = true,
           updated_at = now()
     WHERE provider = 'flutterwave';
COMMIT;
