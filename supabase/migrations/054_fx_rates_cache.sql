-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 054: FX rates cache for multi-currency payments
-- Refresh job (pg_cron) wired in Phase C — Phase A only stores schema
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.fx_rates (
  base_ccy        TEXT NOT NULL CHECK (length(base_ccy) = 3),
  quote_ccy       TEXT NOT NULL CHECK (length(quote_ccy) = 3),
  rate            NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  source          TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_ccy, quote_ccy, fetched_at)
);
CREATE INDEX idx_fx_recent ON public.fx_rates(quote_ccy, fetched_at DESC);

COMMENT ON TABLE public.fx_rates IS
  'Plan 7 v1: cached FX rates. Multi-row history per (base,quote). Latest = ORDER BY fetched_at DESC LIMIT 1.';

-- Helper: get latest rate for (base, quote)
CREATE OR REPLACE FUNCTION public.fx_rate_latest(p_base TEXT, p_quote TEXT)
RETURNS TABLE (rate NUMERIC, source TEXT, fetched_at TIMESTAMPTZ) AS $$
  SELECT rate, source, fetched_at FROM public.fx_rates
   WHERE base_ccy = p_base AND quote_ccy = p_quote
   ORDER BY fetched_at DESC LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Allowed currencies seeded into app_config (admin-tunable)
INSERT INTO public.app_config (key, value, description)
  VALUES (
    'fx.allowed_currencies',
    '["USD","EUR","GBP","AED","KES","SOS"]'::jsonb,
    'Plan 7 v1: currencies accepted for payment. fx-refresh cron pulls these.'
  )
  ON CONFLICT (key) DO NOTHING;

-- DOWN:
-- DROP FUNCTION public.fx_rate_latest;
-- DROP TABLE public.fx_rates;
-- DELETE FROM public.app_config WHERE key = 'fx.allowed_currencies';
