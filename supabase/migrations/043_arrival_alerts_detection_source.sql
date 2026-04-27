-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 042 — Plan 8: detection_source enum + nullable corridor columns
--
-- Adds a discriminator so downstream consumers (agent-match cron, admin UI)
-- can distinguish corridor-detected alerts from origin-port-detected alerts.
-- Drops NOT NULL on the four corridor-specific columns because origin-port
-- detection happens at ~3000 NM and those values aren't computed.
-- NOA is included now to avoid ALTER TYPE ADD VALUE in a future migration
-- (some Postgres configurations forbid that inside a transaction).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.detection_source AS ENUM (
  'CORRIDOR_500NM',
  'ORIGINPORT',
  'NOA'
);

ALTER TABLE public.arrival_alerts
  ADD COLUMN detection_source public.detection_source
    NOT NULL DEFAULT 'CORRIDOR_500NM',
  ALTER COLUMN detected_lat        DROP NOT NULL,
  ALTER COLUMN detected_lng        DROP NOT NULL,
  ALTER COLUMN distance_to_port_nm DROP NOT NULL,
  ALTER COLUMN estimated_route_nm  DROP NOT NULL;

-- Belt-and-braces backfill (default applies to existing rows already, but be
-- explicit so the test asserts a known state).
UPDATE public.arrival_alerts
   SET detection_source = 'CORRIDOR_500NM'
 WHERE detection_source IS NULL;

CREATE INDEX arrival_alerts_originport_unclaimed_idx
  ON public.arrival_alerts (created_at DESC)
  WHERE detection_source = 'ORIGINPORT' AND status = 'UNCLAIMED';
