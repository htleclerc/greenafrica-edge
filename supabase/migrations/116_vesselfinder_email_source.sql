-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 116 : VESSELFINDER_VERIFIED dans la chaîne de confiance
--
-- Niveaux : AGENT_CLAIM (1) < EQUASIS_VERIFIED (2) = VESSELFINDER_VERIFIED (2)
--           < PORT_OFFICER (3)
-- Une adresse issue de VesselFinder remplace donc une revendication d'agent,
-- mais jamais une saisie d'officier de port.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners
  DROP CONSTRAINT IF EXISTS shipowners_official_email_source_check;

ALTER TABLE public.shipowners
  ADD CONSTRAINT shipowners_official_email_source_check
  CHECK (official_email_source IN
    ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED', 'VESSELFINDER_VERIFIED'));

-- DOWN:
-- ALTER TABLE public.shipowners DROP CONSTRAINT shipowners_official_email_source_check;
-- ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_official_email_source_check
--   CHECK (official_email_source IN ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED'));
