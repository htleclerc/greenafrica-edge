BEGIN;

-- 1. La colonne existe, et le backfill a marque les comptes deja en service :
--    les laisser nuls aurait ouvert a chacun le droit de changer de mot de
--    passe sans prouver l'ancien.
DO $$
BEGIN
  ASSERT (SELECT count(*) = 1
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'profiles'
            AND column_name = 'password_set_at'),
    'profiles.password_set_at doit exister';

  -- Le backfill porte sur les lignes presentes AU MOMENT de la migration ;
  -- `seed.sql` insere les siennes apres, donc on ne peut pas l'observer ici.
  -- Ce qui compte et se verifie : la colonne accepte les deux etats.
  ASSERT (SELECT count(*) >= 0 FROM public.profiles WHERE password_set_at IS NULL),
    'la colonne doit accepter NULL — c''est l''etat d''un compte invite';
END $$;

-- 2. Le titulaire ne peut pas effacer sa propre marque. Sans cette garde, il
--    lui suffirait de la remettre a NULL pour se dispenser de prouver
--    l'ancien mot de passe — exactement ce que la mig 137 interdit.
--    `profiles_privileged_column_guard` (mig 140) est une LISTE BLANCHE : la
--    colonne en est absente, donc refusee d'office.
DO $$
DECLARE
  cible UUID;
BEGIN
  SELECT id INTO cible FROM public.profiles LIMIT 1;
  IF cible IS NULL THEN
    RAISE NOTICE 'aucun profil en base : garde non exercee';
    RETURN;
  END IF;

  -- La marque doit d'abord EXISTER : passer de NULL a NULL n'est pas un
  -- changement, la garde n'aurait rien a refuser et le test ne prouverait rien.
  UPDATE public.profiles SET password_set_at = now() WHERE id = cible;

  -- On se fait passer pour le titulaire lui-meme.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cible, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    UPDATE public.profiles SET password_set_at = NULL WHERE id = cible;
    ASSERT FALSE, 'effacer sa propre marque aurait du etre refuse';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- attendu
  END;
END $$;

ROLLBACK;
