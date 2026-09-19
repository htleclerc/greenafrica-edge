-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 164: pin search_path on every SECURITY DEFINER function in public
-- that isn't already pinned. Unpinned SECURITY DEFINER functions let a caller
-- shadow unqualified references via a schema earlier in the search_path — a
-- privilege-escalation vector. ALTER FUNCTION only sets the config; it does not
-- rewrite the body, so behavior is unchanged. Idempotent: re-running skips
-- functions that already carry a search_path.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef                                   -- SECURITY DEFINER only
       AND NOT EXISTS (
             SELECT 1
               FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
              WHERE c LIKE 'search_path=%'
           )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    RAISE NOTICE 'pinned search_path on %', r.sig;
  END LOOP;
END $$;

-- DOWN:
-- No automatic rollback. Pinning search_path is a safe hardening; un-pinning
-- would also strip functions that were pinned before this migration. To revert a
-- specific function: ALTER FUNCTION public.<name>(<args>) RESET search_path;
