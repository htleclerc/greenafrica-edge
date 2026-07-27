-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 109: jurisdiction_billing_cc — adresses en copie des documents fiscaux
--
-- Adresses mises en copie de tout document fiscal émis par un État (pro-forma,
-- facture). Distinct de PLATFORM_BILLING_CC, la copie plateforme unique portée
-- par l'environnement : ici, chaque autorité portuaire gère sa propre liste.
--
-- Table dédiée PLUTÔT qu'une colonne sur jurisdictions : cette dernière est
-- lisible par tous (policy « anyone reads jurisdictions », USING (true), rôle
-- public), donc y stocker des adresses internes les exposerait aux armateurs.
-- Même raison que le refus d'app_config (mig 009). Ici la RLS n'autorise que le
-- staff ; le service_role (émission) lit via GRANT en contournant la RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jurisdiction_billing_cc (
  jurisdiction_id UUID PRIMARY KEY REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  cc_emails       TEXT[] NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.jurisdiction_billing_cc IS
  'Adresses en copie systématique des documents fiscaux émis par une juridiction. Non lisible par les débiteurs. Voir resolveInvoiceRecipients.';

ALTER TABLE public.jurisdiction_billing_cc ENABLE ROW LEVEL SECURITY;

-- Staff seulement : admins/officers (même helper que mig 094). Aucune policy de
-- lecture pour les armateurs — ils ne doivent pas voir ces adresses.
DROP POLICY IF EXISTS "staff manage jurisdiction billing cc" ON public.jurisdiction_billing_cc;
CREATE POLICY "staff manage jurisdiction billing cc"
  ON public.jurisdiction_billing_cc FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jurisdiction_billing_cc TO service_role;

-- DOWN:
-- DROP TABLE IF EXISTS public.jurisdiction_billing_cc;
