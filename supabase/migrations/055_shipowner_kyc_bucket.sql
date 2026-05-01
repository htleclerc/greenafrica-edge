-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 055: Storage bucket for shipowner KYC proof uploads
-- Plan 7B Task 4 — anon can upload to pending/* during signup;
-- service_role has full access for admin operations.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
  VALUES ('shipowner-kyc', 'shipowner-kyc', false)
  ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon insert pending kyc" ON storage.objects;
CREATE POLICY "anon insert pending kyc" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'shipowner-kyc' AND (storage.foldername(name))[1] = 'pending');

DROP POLICY IF EXISTS "service_role full kyc" ON storage.objects;
CREATE POLICY "service_role full kyc" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'shipowner-kyc')
  WITH CHECK (bucket_id = 'shipowner-kyc');

-- DOWN:
-- DROP POLICY "anon insert pending kyc" ON storage.objects;
-- DROP POLICY "service_role full kyc" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'shipowner-kyc';
