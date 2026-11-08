-- Fermeture de TOUTES les sessions d'un compte, pour un appelant de confiance.
--
-- POURQUOI : poser un mot de passe par l'API d'administration ne ferme pas les
-- sessions deja ouvertes. GoTrue garde leurs jetons de rafraichissement valides,
-- si bien qu'une session ouverte survit a la remise a zero. Sur un compte repris
-- par un tiers, changer le mot de passe ne reprend donc pas la main : c'est
-- exactement le cas ou on remet un mot de passe au personnel.
--
-- POURQUOI UNE SECONDE FONCTION : `revoke_user_session` (mig 137) ne sert que la
-- personne elle-meme — son WHERE filtre sur `auth.uid()` et exclut la session
-- courante. Depuis un script qui s'authentifie avec la cle de service, il n'y a
-- pas d'utilisateur courant : elle ne supprimerait rien.
--
-- La suppression de la session emporte ses jetons de rafraichissement par la
-- cle etrangere en cascade du schema GoTrue — c'est deja ce dont depend
-- `revoke_user_session`.

CREATE OR REPLACE FUNCTION public.revoke_all_user_sessions(p_user_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    deleted INT;
BEGIN
    -- Aucune exclusion de session courante, contrairement a la mig 137 : ici
    -- l'appelant est un script, pas la personne, et le but est precisement de
    -- ne laisser aucune session debout.
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;

-- Reservee a la cle de service. `authenticated` ne doit PAS l'obtenir : la
-- fonction prend un identifiant en parametre et ne verifie pas qui appelle,
-- donc tout porteur de jeton pourrait deconnecter n'importe qui.
REVOKE ALL ON FUNCTION public.revoke_all_user_sessions(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_all_user_sessions(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_all_user_sessions(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_user_sessions(UUID) TO service_role;

-- DOWN:
-- DROP FUNCTION IF EXISTS public.revoke_all_user_sessions(UUID);
