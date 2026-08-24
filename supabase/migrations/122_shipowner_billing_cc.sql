-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 122 : copies de facturation propres à l'armateur
--
-- Le destinataire principal reste official_email. Ces adresses viennent en
-- copie seulement. Défaut '{}' → aucun e-mail sortant ne change au déploiement.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS billing_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.shipowners.billing_cc_emails IS
  'Copies propres à l''armateur sur factures et relances. Destinataire principal = official_email.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_cc_emails;
