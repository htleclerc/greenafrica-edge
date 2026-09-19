-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 163: constrain the shipowner-kyc bucket (mig 055 created it with no
-- size/MIME limits). Mirrors payment-proofs (mig 059): 10 MB cap + MIME allowlist.
-- Closes the anonymous unbounded-upload vector on the anon 'pending/*' policy.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE storage.buckets
   SET file_size_limit    = 10485760,  -- 10 MB, same as payment-proofs
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 WHERE id = 'shipowner-kyc';

-- DOWN:
-- UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
--  WHERE id = 'shipowner-kyc';
