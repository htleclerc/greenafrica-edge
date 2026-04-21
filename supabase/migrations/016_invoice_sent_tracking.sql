-- Migration 016: Track the moment a pro-forma is formally dispatched to the
-- armateur by email. "Print & Send" in the UI triggers the following:
--   * stamp transactions.proforma_sent_at = now()        (only when mode=proforma)
--   * insert audit_logs with action='INVOICE_SENT'       (always, regardless of
--     whether the Resend/SMTP delivery actually succeeded — this preserves an
--     audit trail showing the operator's intent)
--
-- Existing pro_forma_generated flag on vessels stays as-is; it marks that a
-- PDF has been produced. proforma_sent_at is a distinct, stronger state —
-- the document has been delivered to the recipient.

BEGIN;

-- 1. Extend the audit_action enum with INVOICE_SENT
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'INVOICE_SENT';

-- 2. Track the dispatch timestamp on transactions
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS proforma_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_txn_proforma_sent
    ON public.transactions(proforma_sent_at)
    WHERE proforma_sent_at IS NOT NULL;

COMMIT;
