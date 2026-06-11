-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 083: GreenGate v8 Wedge 2 — track the jurisdiction of last_zone
--
-- vessels.last_zone caches the zone KIND only; with abutting cross-jurisdiction
-- EEZs (DJ|SO at lng 43.20, mig 082) the kind alone cannot see an EEZ→EEZ
-- jurisdiction hop, which silently misses arrivals/departures on the revenue
-- path. The Go tracker/sweeper now persist and compare (zone, jurisdiction).
-- ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS last_zone_jurisdiction_id UUID REFERENCES public.jurisdictions(id);
COMMENT ON COLUMN public.vessels.last_zone_jurisdiction_id IS
  'Jurisdiction of last_zone (NULL when INTERNATIONAL or legacy rows). Paired with last_zone by the Go eez tracker.';
-- DOWN: ALTER TABLE public.vessels DROP COLUMN IF EXISTS last_zone_jurisdiction_id;
