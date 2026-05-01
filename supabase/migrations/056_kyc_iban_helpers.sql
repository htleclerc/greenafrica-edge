-- Migration 056: KYC IBAN encryption helpers via Supabase Vault or pgsodium
-- Provides detection and encryption/decryption functions for IBAN storage.
-- Strategy: Vault path (live); pgsodium fallback (not in local).
-- Tests: supabase/tests/migrations/056_kyc_iban_helpers.test.sql

-- Detect which encryption extension is available.
CREATE OR REPLACE FUNCTION public.pg_extension_lookup_kyc()
RETURNS TEXT[] AS $$
  SELECT array_agg(extname::TEXT) FROM pg_extension
   WHERE extname IN ('supabase_vault','pgsodium');
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

COMMENT ON FUNCTION public.pg_extension_lookup_kyc IS
'Detects available encryption extensions for KYC IBAN storage. Returns array of extension names.';

-- Vault path: Store IBAN as a secret, return its UUID.
CREATE OR REPLACE FUNCTION public.kyc_vault_store(p_value TEXT)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'supabase_vault extension not available';
  END IF;
  EXECUTE 'SELECT vault.create_secret($1)' INTO v_id USING p_value;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.kyc_vault_store IS
'Stores plaintext IBAN into Supabase Vault and returns the secret UUID. Requires supabase_vault extension.';

-- Vault path: Retrieve IBAN from vault using UUID.
CREATE OR REPLACE FUNCTION public.kyc_vault_retrieve(p_id UUID)
RETURNS TEXT AS $$
DECLARE
  v TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'supabase_vault extension not available';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1'
    INTO v USING p_id;
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.kyc_vault_retrieve IS
'Retrieves plaintext IBAN from Supabase Vault using its UUID. Requires supabase_vault extension.';

-- pgsodium placeholder: encrypt using base64 encoding (NOT a real cipher; Phase B.1 hardens for self-hosted).
CREATE OR REPLACE FUNCTION public.kyc_pgsodium_encrypt(p_value TEXT)
RETURNS TEXT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgsodium') THEN
    RAISE EXCEPTION 'pgsodium extension not available';
  END IF;
  RETURN encode(p_value::bytea, 'base64');
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.kyc_pgsodium_encrypt IS
'Placeholder for pgsodium-based IBAN encryption (base64 fallback). Not used in MVP (Vault is default).';

-- pgsodium placeholder: decrypt using base64 decoding.
CREATE OR REPLACE FUNCTION public.kyc_pgsodium_decrypt(p_ct TEXT)
RETURNS TEXT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgsodium') THEN
    RAISE EXCEPTION 'pgsodium extension not available';
  END IF;
  RETURN convert_from(decode(p_ct, 'base64'), 'UTF-8');
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.kyc_pgsodium_decrypt IS
'Placeholder for pgsodium-based IBAN decryption (base64 fallback). Not used in MVP (Vault is default).';
