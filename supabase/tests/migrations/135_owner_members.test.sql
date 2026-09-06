BEGIN;

-- 1. La table et ses drapeaux
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='owner_members'
  ), 'owner_members table missing';

  -- Les quatre sous-permissions, toutes NOT NULL. Trois sont FAUSSES par
  -- défaut : un membre invité voit le compte, il n'agit que sur décision
  -- explicite. `can_pay` est VRAIE par défaut depuis la mig 148 (décision PO
  -- du 2026-09-05) : payer est ouvert à tout membre, seul le titulaire le
  -- retire.
  ASSERT (
    SELECT COUNT(*) = 3 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='owner_members'
       AND column_name IN ('can_dispute','can_manage_vessels','can_invite')
       AND is_nullable='NO' AND column_default='false'
  ), 'can_dispute, can_manage_vessels and can_invite must exist, be NOT NULL and default to false';
  ASSERT (
    SELECT column_default = 'true' AND is_nullable = 'NO' FROM information_schema.columns
     WHERE table_schema='public' AND table_name='owner_members' AND column_name='can_pay'
  ), 'can_pay must be NOT NULL and default to true (mig 148)';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='owner_members' AND column_name='invited_by'
  ), 'invited_by missing — transitive delegation must stay traceable';
END $$;

-- 2. Une seule appartenance ACTIVE par personne
-- Sans cela current_shipowner_id() (LIMIT 1) deviendrait non déterministe : la
-- même personne verrait un dossier ou l'autre selon le plan d'exécution.
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND tablename='owner_members'
       AND indexdef LIKE '%UNIQUE%'
       AND indexdef LIKE '%(profile_id)%'
       AND indexdef LIKE '%WHERE active%'
  ), 'a partial unique index on (profile_id) WHERE active is required';
END $$;

-- 3. La propriété l'emporte sur l'appartenance
-- Accepter une invitation ne doit jamais faire changer de compte au titulaire.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='current_shipowner_id';

  ASSERT src LIKE '%owner_members%', 'current_shipowner_id must consult owner_members';
  ASSERT position('shipowners' in src) < position('owner_members' in src),
    'ownership must be resolved BEFORE membership (COALESCE order)';
END $$;

-- 4. Le titulaire a toutes les sous-permissions sans ligne owner_members
-- Exiger qu'il s'invite lui-même serait un piège à comptes verrouillés.
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='owner_privileges';

  ASSERT src IS NOT NULL, 'owner_privileges() missing';
  ASSERT src LIKE '%shipowners%', 'owner_privileges must grant everything to the account holder';
  ASSERT src LIKE '%SECURITY DEFINER%', 'owner_privileges must be SECURITY DEFINER';
END $$;

-- 5. Personne ne s'octroie ses propres privilèges
-- C'est la raison d'être de cette table plutôt que de colonnes sur `profiles` :
-- là-bas, seule l'inscription au verrou de la mig 119 protège, et ce verrou ne
-- couvre pas ce qu'on oublie d'y ajouter. Ici, l'absence de policy suffit.
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='owner_members'
       AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
  ), 'owner_members must have no write policy — invitations go through server actions';

  ASSERT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='owner_members' AND cmd='SELECT'
  ), 'owner_members select policy missing';
END $$;

-- 6. Plus aucune policy armateur ne teste shipowners.profile_id en clair
-- C'est le garde de non-régression du chantier : une policy ajoutée plus tard
-- sur l'ancienne forme oublierait les membres en silence — ils verraient les
-- paiements mais pas les factures, ce qui est pire que pas d'accès du tout.
DO $$
DECLARE offenders TEXT;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO offenders
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'shipowners','vessels','transactions','arrival_alerts','collection_reminders',
       'owner_statements','aircraft','aircraft_positions','disputes','payments'
     )
     AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%shipowners%profile_id = auth.uid()%';

  ASSERT offenders IS NULL,
    format('owner policies must route through current_shipowner_id(); still inline: %s', offenders);
END $$;

-- 7. Agir exige la sous-permission, lire ne l'exige pas
-- Les actions serveur vérifient déjà ; sans ce filet, un appel PostgREST direct
-- contournerait le contrôle.
DO $$
DECLARE dispute_check TEXT; intent_check TEXT;
BEGIN
  SELECT with_check INTO dispute_check FROM pg_policies
   WHERE schemaname='public' AND tablename='disputes' AND policyname='disputes_insert_own';
  ASSERT dispute_check LIKE '%can_dispute%',
    'opening a dispute must require can_dispute';

  -- `shipowner_payment_intents` a ete retirée par la mig 062 : déclarer un
  -- paiement passe désormais par `payments` (table polymorphe, mig 048).
  SELECT with_check INTO intent_check FROM pg_policies
   WHERE schemaname='public' AND tablename='payments'
     AND policyname='payments_owner_insert';
  ASSERT intent_check LIKE '%can_pay%',
    'declaring a payment must require can_pay';
END $$;

-- 8. Cohérence de la révocation
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_members_revoked_iff_inactive'
  ), 'an active membership must have no revoked_at, and vice versa';
END $$;

ROLLBACK;
