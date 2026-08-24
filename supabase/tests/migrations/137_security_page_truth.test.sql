BEGIN;

-- 1. Les faits de sécurité sont auditables
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) = 4
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'audit_action'
       AND e.enumlabel IN ('MFA_ENROLLED','MFA_UNENROLLED','PASSWORD_CHANGED','SESSION_REVOKED')
  ), 'the four security audit actions must exist';
END $$;

-- 2. Les deux fonctions existent, en SECURITY DEFINER, chemin de recherche figé
-- Sans `search_path` vide, un schéma en tête de chemin pourrait fournir sa
-- propre auth.uid() à une fonction qui tourne avec les droits du propriétaire.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('current_user_sessions','revoke_user_session')
  LOOP
    ASSERT r.prosecdef, format('%s must be SECURITY DEFINER', r.proname);
    ASSERT array_to_string(r.proconfig, ',') LIKE 'search_path=%',
      format('%s must pin its search_path', r.proname);
    ASSERT replace(array_to_string(r.proconfig, ','), 'search_path=', '') IN ('""', ''''''),
      format('%s must pin an EMPTY search_path', r.proname);
  END LOOP;

  ASSERT (
    SELECT COUNT(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('current_user_sessions','revoke_user_session')
  ), 'both session functions must exist';
END $$;

-- 3. La portée vient du WHERE, pas d'un contrôle applicatif
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='current_user_sessions';
  ASSERT src LIKE '%user_id = auth.uid()%', 'listing must filter on auth.uid()';

  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='revoke_user_session';
  ASSERT src LIKE '%user_id = auth.uid()%', 'revocation must filter on auth.uid()';
END $$;

-- 4. Rien de rejouable ne sort de auth.sessions
-- La table porte de quoi rejouer un jeton ; la fonction ne doit en exposer
-- que la matière d'un écran.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='current_user_sessions';
  ASSERT src NOT LIKE '%refresh_token%', 'the refresh token material must never leave auth.sessions';
  ASSERT src NOT LIKE '%s.*%',           'select the columns explicitly, never *';
END $$;

-- 5. anon n'a pas le droit d'appeler
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.current_user_sessions()', 'EXECUTE'),
    'anon must not list sessions';
  ASSERT NOT has_function_privilege('anon', 'public.revoke_user_session(uuid)', 'EXECUTE'),
    'anon must not revoke sessions';
  ASSERT has_function_privilege('authenticated', 'public.current_user_sessions()', 'EXECUTE'),
    'authenticated must list its own sessions';
END $$;

ROLLBACK;
