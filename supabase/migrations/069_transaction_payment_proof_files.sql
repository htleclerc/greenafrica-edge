-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 069: Legacy payment-proof files on transactions
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The legacy /dashboard/invoices wire-transfer flow has no `payments` row, so it
-- cannot use the v7 `payment_proofs` table. This adds a JSONB array column to
-- hold uploaded proof files directly on the transaction. Each element:
--   { "path": "...", "mime_type": "...", "size_bytes": 123, "uploaded_at": "ISO" }
-- Files live in the existing `payment-proofs` Storage bucket under legacy/<txId>/.
-- Admin validates via the existing mark-paid flow; uploading a proof never
-- changes the transaction status.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS payment_proof_files JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.transactions.payment_proof_files IS
    'Legacy wire-transfer proof files: array of {path, mime_type, size_bytes, uploaded_at}. v7 payments use payment_proofs table instead.';

-- DOWN: ALTER TABLE public.transactions DROP COLUMN IF EXISTS payment_proof_files;
