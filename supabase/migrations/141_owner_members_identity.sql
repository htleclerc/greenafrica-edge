-- 141 — La liste des membres porte enfin leur identité
--
-- `profiles` n'accorde la lecture qu'à son propre titulaire (« Users can read
-- own profile ») ou au staff. Un armateur ne peut donc pas lire le profil des
-- personnes qu'il a lui-même invitées : l'écran affichait deux tirets à la
-- place du nom et de l'adresse.
--
-- Une policy de lecture élargie exposerait tout le profil du membre — rôle,
-- plafond de crédit, site opérationnel. On sort donc le strict nécessaire par
-- une fonction bornée, sur le patron de la mig 137 : la portée est dans le
-- WHERE, et seules deux colonnes de `profiles` en ressortent.

CREATE OR REPLACE FUNCTION public.owner_members_with_identity()
RETURNS TABLE (
    id                 UUID,
    profile_id         UUID,
    email              TEXT,
    full_name          TEXT,
    can_pay            BOOLEAN,
    can_dispute        BOOLEAN,
    can_manage_vessels BOOLEAN,
    can_invite         BOOLEAN,
    active             BOOLEAN,
    created_at         TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.id,
           m.profile_id,
           p.email,
           p.full_name,
           m.can_pay,
           m.can_dispute,
           m.can_manage_vessels,
           m.can_invite,
           m.active,
           m.created_at,
           m.revoked_at
      FROM public.owner_members m
      JOIN public.profiles p ON p.id = m.profile_id
      -- La portée vient de la session, jamais d'un paramètre : la fonction
      -- n'en prend aucun, il n'y a donc rien à falsifier pour lire les membres
      -- d'un autre compte. `current_shipowner_id()` rend NULL pour le staff,
      -- qui ne voit alors aucune ligne.
     WHERE m.shipowner_id = public.current_shipowner_id()
     ORDER BY m.active DESC, m.created_at;
$$;

-- `FROM anon` explicitement, en plus de PUBLIC : Supabase pose un droit par
-- défaut sur toute nouvelle fonction du schéma public pour anon, et révoquer
-- PUBLIC ne défait pas ce don nommé.
REVOKE ALL ON FUNCTION public.owner_members_with_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_members_with_identity() FROM anon;
GRANT EXECUTE ON FUNCTION public.owner_members_with_identity() TO authenticated;

-- DOWN:
-- DROP FUNCTION IF EXISTS public.owner_members_with_identity();
