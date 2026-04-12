-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014: Add receipt_pdf_url to transactions
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The transactions table already has invoice_pdf_url which holds the
-- pro-forma/tax-invoice PDF (the bill). When a payment is recorded, we now
-- generate a separate "Official Receipt" PDF as proof of payment, with the
-- payment method, bank reference, and confirmed-by signature embedded.
--
-- Keeping the two URLs separate preserves the audit trail:
--   invoice_pdf_url  → the bill (pro-forma or tax invoice)
--   receipt_pdf_url  → the proof of payment (official receipt)
--
-- This is also a legal requirement in most jurisdictions: the bill and the
-- receipt are distinct documents, both must be retained.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS receipt_pdf_url TEXT;

COMMENT ON COLUMN public.transactions.receipt_pdf_url IS
    'URL to the official receipt PDF generated when payment was recorded. NULL until paid. Stored in Supabase Storage documents/receipts/.';
