-- 137 — La page Sécurité dit la vérité
--
-- L'écran affirmait « MFA activée — configurée le 01/03/2025 » sur un compte
-- qui n'a aucun facteur, et listait quatre sessions aux adresses IP inventées.
-- Une page de sécurité qui ment est pire que pas de page du tout : elle
-- dissuade d'aller vérifier.
--
-- Cette migration apporte ce qui manquait côté base pour la rendre vraie :
-- les faits auditables, et un accès borné aux sessions de GoTrue.

-- ── 1. Faits de sécurité auditables ─────────────────────────────────────────
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'MFA_ENROLLED';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'MFA_UNENROLLED';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SESSION_REVOKED';

-- ── 2. Les sessions de l'appelant, et rien d'autre ──────────────────────────
--
-- `auth.sessions` n'est pas exposée par PostgREST et ne doit pas l'être : elle
-- porte de quoi rejouer un jeton (`refresh_token_hmac_key`). On en sort ici la
-- stricte matière d'un écran — appareil, adresse, dates, niveau
-- d'authentification — pour les seules lignes de l'appelant.
--
-- `SET search_path = ''` n'est pas décoratif : sans lui, un schéma en tête de
-- chemin pourrait fournir sa propre `auth.uid()` à une fonction qui s'exécute
-- avec les droits du propriétaire.
CREATE OR REPLACE FUNCTION public.current_user_sessions()
RETURNS TABLE (
    id           UUID,
    created_at   TIMESTAMPTZ,
    refreshed_at TIMESTAMPTZ,
    not_after    TIMESTAMPTZ,
    user_agent   TEXT,
    ip           TEXT,
    aal          TEXT,
    is_current   BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.id,
           s.created_at,
           s.refreshed_at::TIMESTAMPTZ,
           s.not_after,
           s.user_agent,
           HOST(s.ip),
           s.aal::TEXT,
           s.id::TEXT = (auth.jwt() ->> 'session_id')
      FROM auth.sessions s
     WHERE s.user_id = auth.uid()
     ORDER BY COALESCE(s.refreshed_at::TIMESTAMPTZ, s.created_at) DESC;
$$;

-- `FROM anon` explicitement, en plus de PUBLIC : Supabase pose un droit par
-- défaut sur toute nouvelle fonction du schema public pour anon, et révoquer
-- PUBLIC ne defait pas ce don nomme. Sans cette ligne, un visiteur non
-- connecté pourrait appeler la fonction (auth.uid() serait nul, donc sans
-- résultat -- mais la surface n'a pas à exister).
REVOKE ALL ON FUNCTION public.current_user_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_sessions() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_sessions() TO authenticated;

-- ── 3. Fermer une session ───────────────────────────────────────────────────
--
-- Supprimer la ligne invalide le jeton de rafraîchissement : l'appareil retombe
-- sur l'écran de connexion au prochain renouvellement. Le filtre sur
-- `auth.uid()` est ce qui empêche de fermer la session d'autrui en forgeant un
-- identifiant ; il est dans le WHERE, pas dans un contrôle applicatif.
--
-- Rend VRAI si une ligne a été supprimée, FAUX si l'identifiant n'appartenait
-- pas à l'appelant ou n'existait plus — l'appelant ne peut donc pas distinguer
-- les deux, et n'apprend rien sur les sessions des autres.
CREATE OR REPLACE FUNCTION public.revoke_user_session(p_session_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deleted INT;
BEGIN
    -- La session courante est exclue ici, pas seulement dans l'action serveur :
    -- se la fermer à soi-même ferait disparaître l'écran sous les doigts, et le
    -- geste attendu (se déconnecter) existe ailleurs.
    DELETE FROM auth.sessions
     WHERE id = p_session_id
       AND user_id = auth.uid()
       AND id::TEXT IS DISTINCT FROM (auth.jwt() ->> 'session_id');
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_user_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_user_session(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_user_session(UUID) TO authenticated;

-- DOWN:
-- DROP FUNCTION IF EXISTS public.revoke_user_session(UUID);
-- DROP FUNCTION IF EXISTS public.current_user_sessions();
-- Les valeurs ajoutées à audit_action restent : Postgres ne sait pas retirer
-- une valeur d'un type énuméré, et une valeur inutilisée est inoffensive.
