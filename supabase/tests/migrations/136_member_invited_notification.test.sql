BEGIN;

-- La valeur doit exister, sinon l'émission côté application échoue à
-- l'insertion avec une erreur de type illisible pour l'appelant.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'owner_notification_kind'
       AND e.enumlabel IN ('MEMBER_INVITED', 'MEMBER_REVOKED')
     GROUP BY t.typname
    HAVING COUNT(*) = 2
  ), 'MEMBER_INVITED and MEMBER_REVOKED must both exist';
END $$;

-- Les valeurs existantes ne bougent pas : une notification déjà écrite ne doit
-- pas devenir illisible parce qu'on a étendu le type.
DO $$
BEGIN
  ASSERT (
    SELECT COUNT(*) = 17
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'owner_notification_kind'
       AND e.enumlabel NOT IN ('MEMBER_INVITED', 'MEMBER_REVOKED')
  ), 'the seventeen pre-existing kinds must survive the extension';
END $$;

ROLLBACK;
