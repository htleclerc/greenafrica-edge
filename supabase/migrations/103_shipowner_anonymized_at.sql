-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 103 : marqueur d'anonymisation RGPD (Art. 17)
--
-- Ajoute shipowners.anonymized_at, posé par l'action d'anonymisation (droit à
-- l'effacement). L'anonymisation efface les données personnelles de CONTACT et
-- BANCAIRES, mais CONSERVE l'identité légale/fiscale (name, billing_legal_name,
-- imo/iata/aoc, country) — exception Art. 17(3)(b) (obligation légale de
-- conservation fiscale) — et n'affecte pas les transactions immuables (mig 089).
-- ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

COMMENT ON COLUMN public.shipowners.anonymized_at IS
  'Horodatage d''anonymisation RGPD Art.17 : données de contact/bancaires effacées ; identité légale/fiscale conservée (obligation légale).';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS anonymized_at;
