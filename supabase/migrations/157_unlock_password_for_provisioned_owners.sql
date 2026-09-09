-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 157 : débloquer les armateurs déjà en base
--
-- La mig 156 a marqué TOUS les profils existants comme ayant choisi leur mot
-- de passe. C'était le choix sûr — les laisser nuls aurait ouvert à chaque
-- compte le droit d'en changer sans prouver l'ancien. Mais pour les armateurs,
-- c'est faux : aucun n'a jamais choisi quoi que ce soit.
--
-- CE QUE DIT LA BASE (relevé en production le 2026-09-09)
--
--   40 SHIPOWNER · 2 SUPERADMIN · 2 FINANCE_ADMIN
--   Les 44 portent un `encrypted_password` non nul — il n'existe donc AUCUN
--   signal en base pour distinguer « a choisi son mot de passe » de « porte un
--   jetable ». C'est précisément le manque que la mig 156 comble pour l'avenir.
--   Aucun armateur ne porte `invited_at` : ils n'ont pas été invités, ils ont
--   été provisionnés en silence par `scripts/provision-owner-accounts.ts`, avec
--   un mot de passe jetable qui ne leur a jamais été communiqué.
--
-- LE PARTAGE SE FAIT DONC SUR L'USAGE, PAS SUR UN CHAMP
--
--   Les armateurs entrent par LIEN MAGIQUE (`requestLoginLink`) ; le mot de
--   passe ne leur sert à rien et aucun ne le connaît. Le personnel, lui, entre
--   par mot de passe et s'en sert : sa marque reste posée, la preuve de
--   l'ancien lui reste due.
--
-- CE QUE ÇA COÛTE, ET POURQUOI C'EST ACCEPTABLE
--
--   Tant qu'un de ces armateurs n'a pas choisi son mot de passe, une session
--   ouverte suffit à en poser un sans preuve. Ce n'est pas une régression :
--   c'est exactement ce que faisait `/api/auth/set-initial-password` pour tout
--   le monde avant la mig 156, et ces comptes n'ont aucun mot de passe connu
--   de leur titulaire à protéger. La marque se repose d'elle-même au premier
--   choix, et la preuve redevient due.
--
-- Migration à effet unique : elle ne concerne que les comptes présents au
-- moment où la 156 les a marqués. Les comptes créés ensuite naissent avec une
-- marque nulle, sans avoir besoin de passer par ici.
--
-- DOWN :
--   UPDATE public.profiles SET password_set_at = now()
--    WHERE role = 'SHIPOWNER' AND password_set_at IS NULL;
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.profiles
   SET password_set_at = NULL
 WHERE role = 'SHIPOWNER'
   AND password_set_at IS NOT NULL;
