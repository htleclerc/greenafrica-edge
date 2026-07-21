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
-- SET search_path = '' : durcissement anti-hijack sur SECURITY DEFINER (objets qualifiés).
CREATE OR REPLACE FUNCTION public.kyc_vault_delete(p_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'supabase_vault extension not available';
  END IF;
  DELETE FROM vault.secrets WHERE id = p_id;
END $$;

COMMENT ON FUNCTION public.kyc_vault_delete IS
  'Supprime définitivement un secret IBAN de Supabase Vault (effacement RGPD Art. 17). Requiert supabase_vault. service_role uniquement.';

-- ── Durcissement autorisation des RPC Vault (analyse sécurité 2026-07-21) ──
-- Ces fonctions SECURITY DEFINER manipulent des secrets IBAN (store/retrieve = accès
-- au clair, delete = destruction). Par défaut elles sont exécutables par PUBLIC via
-- PostgREST (n'importe quel utilisateur authentifié pourrait déchiffrer/supprimer un
-- IBAN via /rpc). L'application les appelle en service_role (createPlatformClient) →
-- on retire l'accès public et on réserve à service_role. (store/retrieve : faille
-- pré-existante mig 056, corrigée ici.)
REVOKE ALL ON FUNCTION public.kyc_vault_delete(UUID)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kyc_vault_store(TEXT)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.kyc_vault_retrieve(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kyc_vault_delete(UUID)   TO service_role;
GRANT EXECUTE ON FUNCTION public.kyc_vault_store(TEXT)    TO service_role;
GRANT EXECUTE ON FUNCTION public.kyc_vault_retrieve(UUID) TO service_role;

-- DOWN:
-- DROP FUNCTION IF EXISTS public.kyc_vault_delete(UUID);
-- (la valeur d'enum ajoutée ne peut pas être retirée proprement — no-op au rollback)
