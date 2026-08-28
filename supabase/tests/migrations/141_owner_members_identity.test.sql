BEGIN;

-- 1. La fonction existe, bornée et sans paramètre
-- Sans paramètre : il n'y a rien à falsifier pour lire les membres d'autrui.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='owner_members_with_identity';

  ASSERT src IS NOT NULL, 'owner_members_with_identity missing';
  ASSERT src LIKE '%SECURITY DEFINER%', 'must be SECURITY DEFINER';
  ASSERT src LIKE '%current_shipowner_id()%', 'scope must come from the session';
  ASSERT (
    SELECT pronargs = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='owner_members_with_identity'
  ), 'must take no argument';
END $$;

-- 2. Seules deux colonnes de profiles en sortent
-- Une policy élargie aurait exposé rôle, plafond de crédit et site
-- opérationnel du membre ; la fonction n'en laisse passer que l'identité.
DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO cols
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN LATERAL unnest(p.proargnames) WITH ORDINALITY AS a(attname, attnum) ON TRUE
   WHERE n.nspname='public' AND p.proname='owner_members_with_identity';

  ASSERT cols LIKE '%email%' AND cols LIKE '%full_name%', 'identity must come out';
  ASSERT cols NOT LIKE '%role%',              'the role must never leave profiles';
  ASSERT cols NOT LIKE '%credit_limit%',      'the credit limit must never leave profiles';
  ASSERT cols NOT LIKE '%operational_site%',  'the site must never leave profiles';
  ASSERT cols NOT LIKE '%can_settle%',        'settlement rights must never leave profiles';
END $$;

-- 3. anon n'appelle pas
DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.owner_members_with_identity()', 'EXECUTE'),
    'anon must not read account members';
  ASSERT has_function_privilege('authenticated', 'public.owner_members_with_identity()', 'EXECUTE'),
    'authenticated must read its own account members';
END $$;

ROLLBACK;
