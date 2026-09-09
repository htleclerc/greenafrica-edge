-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 156 : savoir si la personne a choisi son mot de passe
--
-- Une invitation crée le compte avec un mot de passe que l'invité ne connaît
-- pas : `inviteUserByEmail` n'en pose aucun, et `invite-armateur` en pose un
-- jetable (`tmp_<uuid>_<ts>`). L'écran de réglages, lui, exige l'ancien mot de
-- passe avant d'en accepter un nouveau — un contrôle légitime (mig 137 : une
-- session volée ne doit pas suffire à verrouiller le titulaire hors de son
-- compte), mais que l'invité ne peut PAS franchir. Il se retrouvait à devoir
-- prouver un secret qui ne lui a jamais été communiqué.
--
-- Cette colonne dit ce qu'il manquait : la personne a-t-elle déjà choisi son
-- mot de passe elle-même. Tant qu'elle est NULLE, on en accepte un premier
-- sans rien demander ; une fois posée, l'ancien redevient obligatoire.
--
-- ELLE FERME AUSSI UN CONTOURNEMENT. `POST /api/auth/set-initial-password`
-- accepte aujourd'hui n'importe quelle session et remplace le mot de passe
-- sans preuve : la règle « prouver l'ancien » de la mig 137 était donc
-- contournable par un simple appel à cette route. Elle ne servira plus qu'une
-- fois, tant que cette colonne est nulle.
--
-- BACKFILL : `now()` pour TOUTES les lignes existantes. Les laisser nulles
-- ouvrirait à chaque compte déjà en service le droit de changer de mot de
-- passe sans prouver l'ancien — exactement la régression que la mig 137
-- interdit. Les rares invités bloqués aujourd'hui passent par « mot de passe
-- oublié », qui n'a jamais réclamé l'ancien.
--
-- Aucune garde à ajouter : `profiles_privileged_column_guard` (mig 140) est une
-- LISTE BLANCHE — seules `full_name, phone, bio, timezone, preferred_language,
-- notification_prefs, updated_at` sont modifiables par soi-même. Toute colonne
-- absente de cette liste, celle-ci comprise, est refusée d'office. C'est ce qui
-- empêche quelqu'un d'effacer sa propre marque pour se dispenser de la preuve.
--
-- DOWN :
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS password_set_at;
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;

-- Les comptes déjà en service gardent l'exigence de prouver l'ancien.
UPDATE public.profiles
   SET password_set_at = now()
 WHERE password_set_at IS NULL;

COMMENT ON COLUMN public.profiles.password_set_at IS
  'Horodatage du premier mot de passe choisi par la personne elle-même. NULL = compte invité qui n''a pas encore choisi : on accepte un premier mot de passe sans réclamer l''ancien. Non modifiable par son titulaire (liste blanche de la mig 140).';
