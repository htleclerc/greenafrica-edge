-- Migration 017: Harden invoice verification against fraud.
--
-- Fixes identified by the fraud audit:
--   C1  — 4-hex refs are trivially enumerable. We introduce a persistent,
--         long, unique invoice_ref built server-side and looked up by
--         equality instead of an ILIKE prefix on the tx id.
--   C3  — parseInvoiceRef/verify lookup mismatch. invoice_ref column with
--         UNIQUE constraint removes the ambiguity entirely.
--   C4  — documents bucket was public, meaning every PDF was downloadable
--         by anyone who could guess a path. We flip it to private and drop
--         the documents_read_public policy; downloads now go through a
--         server route that validates the HMAC signature before minting a
--         time-limited signed URL.
--   C5/M3 — no content integrity tie between the printed PDF and the verify
--         page. content_hash stores a SHA-256 of the canonical invoice
--         payload so the QR can carry it (inside the URL) and /verify can
--         display the authoritative fields the scanner must compare to.
--   H2  — verify_signature stores the HMAC so we can reject forged URLs at
--         the edge without hitting the DB at all, killing ref-enumeration.

BEGIN;

-- 1. Persistent invoice reference (source of truth for verification lookup)
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS invoice_ref        TEXT,
    ADD COLUMN IF NOT EXISTS content_hash       TEXT,
    ADD COLUMN IF NOT EXISTS verify_signature   TEXT;

-- Unique index — equality lookup from /verify, no ILIKE required.
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_invoice_ref
    ON public.transactions(invoice_ref)
    WHERE invoice_ref IS NOT NULL;

-- 2. Flip the documents bucket to private. The public read policy is
--    dropped; SELECT from the bucket now requires either:
--      (a) a signed URL (used by the /api/invoices/[ref]/download route,
--          which validates the HMAC before asking Supabase to mint one), or
--      (b) the service_role key (server-side PDF generation + admin ops).
UPDATE storage.buckets
    SET public = false
    WHERE id = 'documents';

DROP POLICY IF EXISTS documents_read_public ON storage.objects;

-- Authenticated staff can still list/read documents server-side via the
-- existing documents_read_staff / documents_write_staff / documents_delete_staff
-- policies from migration 012. Those are preserved intentionally — the only
-- thing we remove is the anon read-through that was exposing every PDF
-- under a guessable URL.

COMMIT;
