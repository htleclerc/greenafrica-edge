-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030 : equasis_scrape_proposals (dormant until Phase 2)
-- Feature-flagged by app_config.feature.equasis_scraper_enabled.
-- Proposals are NEVER applied automatically — always human-validated.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.equasis_scrape_proposals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number           TEXT NOT NULL,
  shipowner_id         UUID REFERENCES public.shipowners(id),
  proposed_owner_name  TEXT,
  proposed_manager     TEXT,
  proposed_email       TEXT,
  proposed_country     TEXT,
  scraped_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by          UUID REFERENCES public.profiles(id),
  reviewed_at          TIMESTAMPTZ,
  applied              BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason      TEXT
);

CREATE INDEX idx_esp_pending
  ON public.equasis_scrape_proposals(imo_number, scraped_at DESC)
  WHERE reviewed_at IS NULL;

COMMENT ON TABLE public.equasis_scrape_proposals IS
  'Phase 2 feature (feature.equasis_scraper_enabled). Rows created by scraper worker, reviewed by Port Officer before application to shipowners.';
