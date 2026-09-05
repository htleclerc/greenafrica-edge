-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 148 : payer est un droit par défaut de tout membre du compte
--
-- Décision PO (2026-09-05) : « tous les comptes associés doivent avoir le
-- droit de payer la facture, sauf si le titulaire le leur retire lui-même —
-- permissif par défaut ». Régler une facture ne nuit jamais au compte ; c'est
-- le geste pour lequel on associe un collègue en premier lieu. La mig 135
-- ouvrait tout à FALSE, si bien qu'un membre invité sans case cochée arrivait
-- sur ses factures sans bouton « Payer » et croyait l'écran cassé.
--
-- Les autres droits (contester, gérer les navires, inviter) restent fermés
-- par défaut : ils engagent le compte ou en ouvrent l'accès, payer non.
--
-- Backfill des membres ACTIFS : sous l'ancienne règle, « non coché » était
-- l'état par défaut, pas un retrait explicite — on ne peut pas distinguer les
-- deux, et la règle nouvelle dit que le retrait est un geste du titulaire.
-- Il peut le refaire depuis l'écran Membres.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.owner_members
  ALTER COLUMN can_pay SET DEFAULT TRUE;

UPDATE public.owner_members
   SET can_pay = TRUE
 WHERE active = TRUE
   AND can_pay = FALSE;

COMMENT ON COLUMN public.owner_members.can_pay IS
  'Mig 148 : TRUE par défaut — payer est ouvert à tout membre tant que le titulaire ne le retire pas.';

-- DOWN:
-- ALTER TABLE public.owner_members ALTER COLUMN can_pay SET DEFAULT FALSE;
-- (le backfill n'est pas réversible : on ne sait plus quels membres étaient à FALSE)
