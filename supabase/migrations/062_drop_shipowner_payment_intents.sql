-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 062: Drop legacy v0 shipowner_payment_intents table
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Plan 7C-5 cutover: the v7 `payments` polymorphic table (mig 048) +
-- its full UI surface (Plans 7C-1 through 7C-4) replaces the v0 payment
-- intent flow shipped in mig 039. The legacy `paymentIntentService`,
-- `declarePaymentIntent`/`resolvePaymentIntent` actions, `PayProformaDialog`,
-- and `PendingIntentsPanel` are all deleted in this PR. The DB table goes
-- with them.
--
-- Pre-push inventory step (Plan 7C-5 Task 1) must confirm zero
-- `status='DECLARED'` rows on hosted before applying. RESOLVED rows
-- (CONFIRMED/REJECTED) are historical and are lost; the v7 `payments`
-- table is the new source of truth for payment history. If audit
-- continuity matters, snapshot the legacy table contents to a CSV
-- before dropping. The mig 048 comment block explicitly anticipates
-- this drop in "Phase C of Plan 7".

DROP TABLE IF EXISTS public.shipowner_payment_intents CASCADE;

-- The trigger function from mig 039 was specific to this table — also
-- gone, but check for orphans:
-- DROP FUNCTION IF EXISTS public.handle_shipowner_payment_intents_updated_at();
-- (No-op if not defined; mig 039 used the shared updated_at trigger.)
