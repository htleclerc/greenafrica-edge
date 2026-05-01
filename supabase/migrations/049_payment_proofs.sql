-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 049: Payment proofs (1 payment → N uploaded proof files)
-- Storage bucket 'payment-proofs' RLS handled at app layer + Supabase Storage rules
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.payment_proofs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INT  NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5*1024*1024),
  uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description     TEXT
);
CREATE INDEX idx_proofs_payment ON public.payment_proofs(payment_id);

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payment_proofs IS
  'Plan 7 v1: uploaded proof files for a payment. Files in Supabase Storage payment-proofs bucket.';

-- DOWN: DROP TABLE public.payment_proofs CASCADE;
