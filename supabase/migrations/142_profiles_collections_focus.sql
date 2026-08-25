-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 142 : sous-permission « poste de recouvrement »
--
-- Un FINANCE_ADMIN qui poursuit les impayés n'a que faire des 21 entrées du
-- menu financier : il atterrit sur la carte des navires et cherche ses écrans.
-- Ce drapeau resserre SA navigation sans toucher au rôle, donc sans priver
-- quiconque d'un écran qu'il a aujourd'hui.
--
-- Portée volontairement limitée : le drapeau ne fait que RETRANCHER des entrées
-- de menu et changer la page d'atterrissage. Il n'accorde aucun droit et n'en
-- retire aucun — les gardes de page continuent de ne regarder que le rôle.
-- Ce n'est pas une cloison de sécurité, c'est un confort de navigation.
--
-- Patron repris de `can_record_cash` (mig 061) : booléen sur profiles, défaut
-- false, accordé explicitement par un SUPERADMIN. ADDITIVE et inerte au
-- déploiement — personne ne voit son menu changer tant que rien n'est accordé.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS collections_focus BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.collections_focus IS
  'Sous-permission de confort : resserre le menu et l''atterrissage sur le poste de recouvrement. '
  'Ne retranche que de la navigation, n''accorde aucun droit. Voir rbac.ts COLLECTIONS_FOCUS_NAV.';

-- DOWN:
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS collections_focus;
