-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 154 : sous-permission « encaissements seulement » sur le profil
--
-- Demande PO (2026-09-06) : ouvrir l'accès à la personne finance sans qu'elle
-- voie les pro-formas. Une créance n'est pas de l'argent ; montrer 1,3 M USD
-- « dus » à quelqu'un qui tient la trésorerie invite à des conclusions trop
-- actives sur de l'argent non reçu. Cette personne ne doit voir que ce qui a
-- réellement bougé : les paiements CONFIRMED (et les REFUNDED).
--
-- Même règle que les mig 130 et 142 : un drapeau sur le profil, jamais un
-- nouveau rôle. Celui-ci RETRANCHE — il n'accorde rien. Il est appliqué à
-- trois niveaux : le menu (rbac.ts PAYMENTS_ONLY_NAV), le middleware (toute
-- URL hors /admin/payments redirige ; l'API /api/admin/* répond 403) et l'API
-- des paiements, qui borne les statuts à CONFIRMED / REFUNDED quoi que
-- demande le client.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payments_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.payments_only IS
  'Mig 154 : sous-permission qui RETRANCHE — la personne ne voit que les paiements encaissés (CONFIRMED/REFUNDED), jamais une pro-forma ni un encours. Appliquée par le menu, le middleware et l''API des paiements.';

-- DOWN:
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS payments_only;
