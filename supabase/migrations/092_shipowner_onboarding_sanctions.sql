-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 092: Onboarding armateurs — sanctions OFAC/UN + métadonnées seed
--
-- Package d'intégration docs/onboarding/ (Green-Gate v2, 13 juillet 2026).
-- ADDITIVE : étend shipowners (l'entité opérateur généralisée maritime+air)
-- au lieu de créer des tables parallèles armateurs/compagnies_aeriennes.
--   • is_ofac_sdn / is_un_prohibited : blocage absolu de tout contact sortant
--     (garde applicative domain/sanctions/contactGuard.ts + audit_logs).
--   • iata_code / icao_code / hub_code : identité compagnie aérienne
--     (mirroir de imo_company_no / aoc_number pour le mode AIR).
--   • seed_ref : clé d'idempotence de l'import (arm-XXX / avi-XXX).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS is_ofac_sdn      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_un_prohibited BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sanction_notes   TEXT,
  ADD COLUMN IF NOT EXISTS aliases          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS equasis_id       TEXT,
  ADD COLUMN IF NOT EXISTS ops_email        TEXT,
  ADD COLUMN IF NOT EXISTS finance_email    TEXT,
  ADD COLUMN IF NOT EXISTS iata_code        TEXT,
  ADD COLUMN IF NOT EXISTS icao_code        TEXT,
  ADD COLUMN IF NOT EXISTS hub_code         TEXT,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS seed_ref         TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipowners_seed_ref
  ON public.shipowners(seed_ref) WHERE seed_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipowners_iata
  ON public.shipowners(iata_code) WHERE iata_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipowners_sanctioned
  ON public.shipowners(id) WHERE is_ofac_sdn OR is_un_prohibited;

COMMENT ON COLUMN public.shipowners.is_ofac_sdn IS
  'OFAC SDN list hit. TRUE ⇒ AUCUN contact direct (email/invite) — procédure in rem via Bailiff uniquement. Enforced par domain/sanctions/contactGuard.ts.';
COMMENT ON COLUMN public.shipowners.is_un_prohibited IS
  'UN sanctions list hit. TRUE ⇒ AUCUN contact direct — notification consulaire uniquement.';
COMMENT ON COLUMN public.shipowners.seed_ref IS
  'Référence du package onboarding_armateurs (arm-XXX / avi-XXX). Clé d''idempotence de scripts/seed-onboarding.ts.';

-- Valeur d'audit pour les refus de contact sanctions (utilisée par l'action
-- inviteShipowner et les envois sortants)
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SANCTIONS_CONTACT_BLOCKED';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS is_ofac_sdn, DROP COLUMN IF EXISTS is_un_prohibited,
--   DROP COLUMN IF EXISTS sanction_notes, DROP COLUMN IF EXISTS aliases, DROP COLUMN IF EXISTS equasis_id,
--   DROP COLUMN IF EXISTS ops_email, DROP COLUMN IF EXISTS finance_email, DROP COLUMN IF EXISTS iata_code,
--   DROP COLUMN IF EXISTS icao_code, DROP COLUMN IF EXISTS hub_code, DROP COLUMN IF EXISTS notes,
--   DROP COLUMN IF EXISTS seed_ref;
-- (enum values cannot be removed in Postgres without recreating the enum)
