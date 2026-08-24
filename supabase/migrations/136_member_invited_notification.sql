-- 136 — Le compte apprend qu'un membre a ouvert ou fermé un accès
--
-- La mig 135 laisse un membre porteur du droit « inviter » ajouter quelqu'un.
-- Le geste est audité, mais l'audit n'est lu par personne au quotidien : sans
-- ce fait, le titulaire d'un compte pouvait découvrir un accès qu'il n'a pas
-- accordé, longtemps après, ou jamais.
--
-- Le fait est porté par le compte et non par la personne : `owner_notifications`
-- est déjà scopée sur `shipowner_id`, et l'e-mail part à l'adresse officielle du
-- dossier — celle du titulaire. Le membre qui a invité voit donc aussi la ligne,
-- ce qui est correct : c'est un événement du compte, pas une dénonciation.

ALTER TYPE public.owner_notification_kind ADD VALUE IF NOT EXISTS 'MEMBER_INVITED';

-- Le retrait suit la même règle que l'ajout : `revokeOwnerMember` est gardée
-- par le même `can_invite`, donc un membre peut fermer l'accès d'un autre. Ne
-- notifier que l'ajout laisserait le trou le plus gênant des deux ouvert.
ALTER TYPE public.owner_notification_kind ADD VALUE IF NOT EXISTS 'MEMBER_REVOKED';

-- DOWN:
-- Postgres ne sait pas retirer une valeur d'un type énuméré. Revenir en arrière
-- suppose de recréer le type sans la valeur et de réécrire chaque colonne qui
-- s'en sert — ce qui n'est raisonnable que si aucune ligne ne la porte. La
-- valeur inutilisée est inoffensive : la laisser est le retour arrière.
