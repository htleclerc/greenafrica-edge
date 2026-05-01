-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 047: Shipowner KYC extensions for Plan 7 v1 portal
-- Adds 3 new account states + KYC level B (signup) + KYC level C (billing)
-- ─────────────────────────────────────────────────────────────────────────────

-- New enum values for the lifecycle:
--   GHOST → INVITED | PENDING_REVIEW → ACTIVE → (SUSPENDED | REJECTED)
ALTER TYPE public.shipowner_account_state
  ADD VALUE IF NOT EXISTS 'PENDING_REVIEW' BEFORE 'INVITED';
ALTER TYPE public.shipowner_account_state
  ADD VALUE IF NOT EXISTS 'REJECTED' AFTER 'ACTIVE';
ALTER TYPE public.shipowner_account_state
  ADD VALUE IF NOT EXISTS 'SUSPENDED' AFTER 'REJECTED';

-- KYC level B (signup obligatoire) + level C (avant 1er paiement)
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS imo_company_no_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proof_imo_vessel_imo TEXT,
  ADD COLUMN IF NOT EXISTS proof_doc_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_doc_type TEXT
    CHECK (proof_doc_type IN ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER')),
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en','fr','ar','pt','sw')),
  ADD COLUMN IF NOT EXISTS billing_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS billing_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS billing_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS billing_city TEXT,
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS billing_country_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_number TEXT,
  ADD COLUMN IF NOT EXISTS iban TEXT,
  ADD COLUMN IF NOT EXISTS swift_bic TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS kyc_level_b_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_level_c_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN public.shipowners.iban IS
  'Stored encrypted via pgsodium or Supabase Vault — see Plan 7B implementation.';
COMMENT ON COLUMN public.shipowners.preferred_language IS
  'ISO 639-1: en/fr/ar/pt/sw — drives email template + UI default.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS rejection_reason, ... ;
-- (enum values cannot be removed in Postgres without recreating the enum)
