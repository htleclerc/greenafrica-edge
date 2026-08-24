BEGIN;

-- 1. Les champs que le profil porte en propre
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) = 3 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name IN ('phone','bio','notification_prefs')
  ), 'phone, bio and notification_prefs must exist';

  -- Les préférences ne sont jamais nulles : une absence de ligne se lit comme
  -- « aucune préférence », pas comme un état à tester partout.
  ASSERT (
    SELECT is_nullable = 'NO' FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='notification_prefs'
  ), 'notification_prefs must be NOT NULL';
END $$;

-- 2. Le verrou est une liste BLANCHE
-- C'est le fond du correctif : une liste noire ne protège que ce qu'on a pensé
-- à y mettre, et huit colonnes sensibles y manquaient.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='profiles_privileged_column_guard';

  ASSERT src LIKE '%self_editable%', 'the guard must name what IS editable, not what is not';
  ASSERT src LIKE '%NOT (n.key = ANY (self_editable))%',
    'anything outside the allow-list must be refused';

  -- Les colonnes qui laissaient passer une auto-élévation ne doivent surtout
  -- pas figurer dans la liste blanche.
  FOR src IN SELECT unnest(ARRAY[
      'can_record_cash','can_settle_payments','credit_limit_usd',
      'operational_site','eez_suspended','is_demo','country_code','role','is_active'
  ]) LOOP
    ASSERT NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='profiles_privileged_column_guard'
         AND pg_get_functiondef(p.oid) LIKE '%''' || src || '''%'
    ), format('%s must never be self-editable', src);
  END LOOP;
END $$;

-- 3. Les trois portes de sortie restent ouvertes
-- Sans elles, les migrations, les crons et le chemin de promotion SUPERADMIN
-- se retrouveraient bloqués par leur propre verrou.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='profiles_privileged_column_guard';

  ASSERT src LIKE '%auth.uid() IS NULL%',      'SQL fixtures must still pass';
  ASSERT src LIKE '%service_role%',            'service_role must still pass';
  ASSERT src LIKE '%SUPERADMIN%',              'the promotion path must still pass';
END $$;

-- 4. Le déclencheur est toujours branché
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'profiles_privileged_column_guard'
       AND tgrelid = 'public.profiles'::regclass
       AND NOT tgisinternal
  ), 'the guard trigger must stay attached to profiles';
END $$;

ROLLBACK;
