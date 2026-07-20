-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 098: pièce justificative bancaire KYC-C
-- Ajoute à shipowners le document justificatif de l'étape bancaire (KYC-C),
-- distinct du proof_doc_* du KYC-B (identité, inscription). ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS billing_proof_doc_url  text;
ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS billing_proof_doc_type text;

COMMENT ON COLUMN public.shipowners.billing_proof_doc_url  IS 'Chemin storage (bucket shipowner-kyc) de la pièce bancaire KYC-C (ex. RIB/attestation).';
COMMENT ON COLUMN public.shipowners.billing_proof_doc_type IS 'Type de la pièce bancaire KYC-C.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_proof_doc_url;
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_proof_doc_type;
