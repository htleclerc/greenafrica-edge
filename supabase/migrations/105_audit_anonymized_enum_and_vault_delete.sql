-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 105 : valeur d'audit dédiée SHIPOWNER_ANONYMIZED + suppression Vault
--
-- (1) Ajoute la valeur d'enum audit_action 'SHIPOWNER_ANONYMIZED' (taxonomie
--     d'audit propre pour l'effacement Art. 17, au lieu de réutiliser
--     'TRANSACTION_UPDATED'). Pattern mig 016/092.
-- (2) Ajoute kyc_vault_delete(p_id) : supprime le secret IBAN de Supabase Vault,
--     pour un effacement RGPD complet à l'anonymisation (auparavant seule la
--     référence applicative était mise à null, le secret Vault restait).
-- ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SHIPOWNER_ANONYMIZED';

-- Vault path : supprime définitivement un secret IBAN (create_secret → vault.secrets).
CREATE OR REPLACE FUNCTION public.kyc_vault_delete(p_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'supabase_vault extension not available';
  END IF;
  DELETE FROM vault.secrets WHERE id = p_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.kyc_vault_delete IS
  'Supprime définitivement un secret IBAN de Supabase Vault (effacement RGPD Art. 17). Requiert supabase_vault.';

-- DOWN:
-- DROP FUNCTION IF EXISTS public.kyc_vault_delete(UUID);
-- (la valeur d'enum ajoutée ne peut pas être retirée proprement — no-op au rollback)
