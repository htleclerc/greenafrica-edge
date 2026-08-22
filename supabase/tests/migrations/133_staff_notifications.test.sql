BEGIN;

-- 1. Les deux tables existent, avec les colonnes qui portent le modèle
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='staff_notifications'
  ), 'staff_notifications table missing';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='staff_notification_reads'
  ), 'staff_notification_reads table missing';

  -- L'audience est un TABLEAU de rôles : un même fait vise souvent deux rôles.
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='staff_notifications'
       AND column_name='audience_roles' AND data_type='ARRAY' AND is_nullable='NO'
  ), 'audience_roles missing, nullable, or not an array';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='staff_notifications'
       AND column_name='jurisdiction_id' AND is_nullable='NO'
  ), 'jurisdiction_id missing or nullable';

  -- L'état de lecture ne doit JAMAIS vivre sur le fait : c'est ce qui distingue
  -- une notification d'équipe d'une notification d'armateur.
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='staff_notifications'
       AND column_name='read_at'
  ), 'read_at must not live on staff_notifications — reads are per profile';
END $$;

-- 2. L'enum porte les six types
DO $$
DECLARE
  expected TEXT[] := ARRAY['VALIDATION_PENDING','REGISTRATION_SUBMITTED','COLLECTION_ESCALATED',
                           'DEBTOR_RESPONDED','CASH_PAYMENT_RECORDED','DISPUTE_OPENED'];
  label TEXT;
BEGIN
  FOREACH label IN ARRAY expected LOOP
    ASSERT EXISTS (
      SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname='staff_notification_kind' AND e.enumlabel=label
    ), format('staff_notification_kind missing %s', label);
  END LOOP;
END $$;

-- 3. La clé primaire des lectures est (notification, profil) — une marque par personne
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) = 2 FROM information_schema.key_column_usage
     WHERE table_schema='public' AND table_name='staff_notification_reads'
       AND constraint_name = (
         SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_schema='public' AND table_name='staff_notification_reads'
            AND constraint_type='PRIMARY KEY')
  ), 'staff_notification_reads primary key must be (notification_id, profile_id)';
END $$;

-- 4. RLS active sur les deux tables, et AUCUNE écriture sur les faits
DO $$
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE relname='staff_notifications'),
    'RLS not enabled on staff_notifications';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE relname='staff_notification_reads'),
    'RLS not enabled on staff_notification_reads';

  -- Un agent qui pourrait s'écrire une notification pourrait s'en fabriquer une
  -- au nom d'un autre rôle : l'émission reste au service-role.
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='staff_notifications'
       AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ), 'staff_notifications must have no write policy for authenticated users';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='staff_notifications' AND cmd='SELECT'
  ), 'staff_notifications select policy missing';
END $$;

-- 5. Les marques de lecture sont bornées à soi, en lecture ET en écriture
DO $$
DECLARE insert_check TEXT;
BEGIN
  SELECT with_check INTO insert_check FROM pg_policies
   WHERE schemaname='public' AND tablename='staff_notification_reads' AND cmd='INSERT';

  ASSERT insert_check IS NOT NULL AND insert_check LIKE '%auth.uid()%',
    'insert policy must pin profile_id to auth.uid() — otherwise one agent marks read for another';
END $$;

-- 6. La vue existe et s'exécute avec les droits de l'appelant
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema='public' AND table_name='v_staff_notifications'
  ), 'v_staff_notifications view missing';

  -- Sans security_invoker la vue contournerait les policies et rendrait les
  -- notifications de toutes les juridictions.
  ASSERT (
    SELECT COALESCE(
      (SELECT option_value FROM pg_options_to_table(c.reloptions)
        WHERE option_name = 'security_invoker'), 'false')
      FROM pg_class c WHERE c.relname = 'v_staff_notifications'
  ) = 'true', 'v_staff_notifications must be security_invoker';
END $$;

-- 7. La dédup est unique par (juridiction, type, clé) et n'entrave pas les NULL
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='staff_notifications'
       AND indexname='idx_staff_notif_dedup'
       AND indexdef LIKE '%UNIQUE%'
       AND indexdef LIKE '%dedup_key IS NOT NULL%'
  ), 'dedup index must be unique and partial on dedup_key IS NOT NULL';
END $$;

ROLLBACK;
