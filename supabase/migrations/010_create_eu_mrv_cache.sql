-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: EU MRV emissions cache table
-- Source: THETIS-MRV (https://mrv.emsa.europa.eu/)
-- Refreshed monthly via scripts/sync-eu-mrv.ts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eu_mrv_cache (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    imo_number      TEXT NOT NULL,
    vessel_name     TEXT NOT NULL DEFAULT '',
    ship_type       TEXT NOT NULL DEFAULT '',
    flag_code       TEXT NOT NULL DEFAULT '',
    reporting_period TEXT NOT NULL DEFAULT '',
    gross_tonnage   NUMERIC NOT NULL DEFAULT 0,
    total_fuel_consumption NUMERIC NOT NULL DEFAULT 0,
    total_co2_emissions    NUMERIC NOT NULL DEFAULT 0,
    transport_work  NUMERIC NOT NULL DEFAULT 0,
    distance_nm     NUMERIC NOT NULL DEFAULT 0,
    time_at_sea_hours NUMERIC NOT NULL DEFAULT 0,
    average_speed_knots NUMERIC NOT NULL DEFAULT 0,
    synced_at       TIMESTAMPTZ DEFAULT now(),

    UNIQUE (imo_number, reporting_period)
);

-- Index for vessel enrichment lookups
CREATE INDEX IF NOT EXISTS idx_eu_mrv_imo ON public.eu_mrv_cache (imo_number);

-- RLS: read-only for authenticated users, write for service_role only
ALTER TABLE public.eu_mrv_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eu_mrv_cache_read"
    ON public.eu_mrv_cache FOR SELECT
    TO authenticated
    USING (true);

COMMENT ON TABLE public.eu_mrv_cache IS
    'Cache of EU MRV THETIS ship emissions data. Refreshed monthly via sync-eu-mrv.ts cron.';
