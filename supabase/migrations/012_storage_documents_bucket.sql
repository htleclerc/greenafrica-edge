-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — Storage: documents bucket + RLS policies
-- Migration 012 : Bucket for invoice PDFs, audit reports, etc.
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'documents',
    'documents',
    true,
    10485760, -- 10 MB
    ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- ── RLS Policies ────────────────────────────────────────────────────────────

-- Allow authenticated users to read any document
DROP POLICY IF EXISTS "documents_read_authenticated" ON storage.objects;
CREATE POLICY "documents_read_authenticated"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'documents');

-- Allow public read (since the bucket is marked public, invoices have shareable URLs)
DROP POLICY IF EXISTS "documents_read_public" ON storage.objects;
CREATE POLICY "documents_read_public"
    ON storage.objects FOR SELECT
    TO anon
    USING (bucket_id = 'documents');

-- Allow authenticated users to upload documents
DROP POLICY IF EXISTS "documents_insert_authenticated" ON storage.objects;
CREATE POLICY "documents_insert_authenticated"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'documents');

-- Allow authenticated users to update their own uploads (upsert support)
DROP POLICY IF EXISTS "documents_update_authenticated" ON storage.objects;
CREATE POLICY "documents_update_authenticated"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'documents')
    WITH CHECK (bucket_id = 'documents');

-- Allow port officers and finance admins to delete documents
DROP POLICY IF EXISTS "documents_delete_staff" ON storage.objects;
CREATE POLICY "documents_delete_staff"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'documents'
        AND EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
        )
    );
