-- Test 108 : la récursion RLS profiles ↔ shipowners est cassée.
--   a) le helper public.profile_visible_in_jurisdictions existe et est SECURITY DEFINER
--   b) la policy "Admins can read all profiles" ne référence plus shipowners en direct
--      (la source de récursion — désormais encapsulée dans le helper DEFINER)
BEGIN;

DO $$
DECLARE
  v_secdef BOOLEAN;
  v_qual   TEXT;
BEGIN
  -- a) helper présent + SECURITY DEFINER
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'profile_visible_in_jurisdictions';

  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: fonction public.profile_visible_in_jurisdictions absente';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'TEST FAILED: profile_visible_in_jurisdictions doit être SECURITY DEFINER';
  END IF;

  -- b) la policy profiles ne lit plus shipowners directement (récursion supprimée)
  SELECT qual INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles'
     AND policyname = 'Admins can read all profiles';

  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: policy "Admins can read all profiles" absente';
  END IF;
  IF position('shipowners' IN v_qual) > 0 THEN
    RAISE EXCEPTION 'TEST FAILED: la policy référence encore shipowners en direct (récursion) : %', v_qual;
  END IF;
  IF position('profile_visible_in_jurisdictions' IN v_qual) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED: la policy devrait déléguer au helper DEFINER : %', v_qual;
  END IF;
END $$;

SELECT '108 fix RLS recursion: helper DEFINER + policy sans shipowners direct: PASS' AS test_result;

ROLLBACK;
SELECT '108 fix_profiles_shipowners_rls_recursion: PASS' AS test_result;
