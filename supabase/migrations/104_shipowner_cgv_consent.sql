-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 104 : consentement CGV versionné (RGPD Art. 7 — preuve du consentement)
--
-- Le consentement aux CGV n'était tracé que dans audit_logs.details_json
-- (cgv_accepted_at), sans version → impossible de prouver de façon opposable
-- QUELLE version des CGV a été acceptée si elles évoluent. On persiste la date +
-- la version sur shipowners. ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS cgv_accepted_at timestamptz;
ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS cgv_version     text;

COMMENT ON COLUMN public.shipowners.cgv_accepted_at IS 'Date d''acceptation des CGV (KYC-C) — preuve de consentement RGPD Art. 7.';
COMMENT ON COLUMN public.shipowners.cgv_version     IS 'Version des CGV acceptée (opposabilité si les CGV évoluent).';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS cgv_accepted_at;
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS cgv_version;
