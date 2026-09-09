BEGIN;

-- Le partage voulu : l'armateur retrouve le droit de choisir un premier mot de
-- passe, le personnel garde l'obligation de prouver l'ancien.
--
-- On rejoue l'etat laisse par les migs 156 puis 157 sur deux profils temoins,
-- plutot que de lire ceux du seed : leur composition varie d'un environnement
-- a l'autre et le test ne prouverait rien de stable.
DO $$
DECLARE
  armateur UUID;
  staff    UUID;
BEGIN
  -- Deux temoins crees ici : le seed ne porte pas forcement les deux roles, et
  -- s'appuyer dessus rendait le test silencieusement inoperant.
  armateur := gen_random_uuid();
  staff    := gen_random_uuid();

  INSERT INTO auth.users (id, email, instance_id)
  VALUES (armateur, 'temoin-armateur@example.test', '00000000-0000-0000-0000-000000000000'),
         (staff,    'temoin-staff@example.test',    '00000000-0000-0000-0000-000000000000');

  -- Un declencheur sur auth.users cree deja la ligne profils : on la complete
  -- plutot que de l'inserer. Etat pose par la mig 156 : tout le monde marque.
  UPDATE public.profiles SET role = 'SHIPOWNER',     password_set_at = now() WHERE id = armateur;
  UPDATE public.profiles SET role = 'FINANCE_ADMIN', password_set_at = now() WHERE id = staff;

  -- La regle de la mig 157, rejouee.
  UPDATE public.profiles
     SET password_set_at = NULL
   WHERE role = 'SHIPOWNER' AND password_set_at IS NOT NULL;

  ASSERT (SELECT password_set_at IS NULL FROM public.profiles WHERE id = armateur),
    'l''armateur doit pouvoir choisir un premier mot de passe sans prouver l''ancien';

  ASSERT (SELECT password_set_at IS NOT NULL FROM public.profiles WHERE id = staff),
    'le personnel doit continuer a prouver l''ancien mot de passe';
END $$;

ROLLBACK;
