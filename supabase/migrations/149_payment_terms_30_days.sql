-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 149 : le délai de paiement imprimé passe à 30 jours
--
-- Décision PO (2026-09-05) : « les 45 jours ne sont plus d'actualité, mais
-- 30 jours ». La mig 131 avait seedé `payment_terms_days = 45` d'après les
-- documents d'août 2026 ; c'est ce que le pied de page des PDF et la page 2
-- (« PAYMENT TERMS & RECOVERY PROCEDURE ») affichaient.
--
-- L'échéance réelle, elle, n'a jamais bougé : `transactions.due_date` est
-- posée à NET-30 par le déclencheur de la mig 146 (et l'était par l'expression
-- générée de la mig 022 avant). Le document annonçait donc 45 jours à un
-- débiteur dont le portail et la relance comptaient 30. Cette migration
-- ramène le texte sur la donnée.
--
-- Ne touche que les lignes encore à 45 : un profil de juridiction réglé
-- autrement par un administrateur garde sa valeur.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.jurisdiction_issuer_profile
   SET payment_terms_days = 30
 WHERE payment_terms_days = 45;

COMMENT ON COLUMN public.jurisdiction_issuer_profile.payment_terms_days IS
  'Délai de paiement imprimé sur les documents (jours). 30 depuis la mig 149 — aligné sur le NET-30 de transactions.due_date.';

-- DOWN:
-- UPDATE public.jurisdiction_issuer_profile SET payment_terms_days = 45 WHERE payment_terms_days = 30;
