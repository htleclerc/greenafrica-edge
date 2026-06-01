-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 075: GreenGate v8 — Wedge 1-B air pricing + ICAO LTO methodology params
--
-- (a) MTOW-fallback coefficients on the ICAO_LTO methodology (mig 071 row). The Go
--     air calculator reads these to estimate CO2/LTO for aircraft types absent from
--     air_emission_factors (flagged "approximate"). Linear fit over the mig-074 seed.
-- (b) Seed carbon_tax.air_rate_usd_per_tco2 = the current maritime rate (admin-tunable
--     default). The calc is fail-closed: a missing rate errors, never a silent $0.
-- ADDITIVE / idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.methodologies
   SET params = jsonb_build_object(
         'mtow_fallback', jsonb_build_object(
           'slope_kg_co2_per_kg_mtow', 0.0280748::numeric,
           'intercept_kg',             222.0::numeric
         ))
 WHERE mode = 'AIR' AND code = 'ICAO_LTO';

-- Seed the AIR rate from the maritime rate (only if maritime exists; idempotent).
INSERT INTO public.app_config (key, value, updated_at)
SELECT 'carbon_tax.air_rate_usd_per_tco2', value, NOW()
  FROM public.app_config
 WHERE key = 'carbon_tax.rate_usd_per_tco2'
ON CONFLICT (key) DO NOTHING;

-- DOWN: UPDATE public.methodologies SET params = '{}'::jsonb WHERE mode='AIR' AND code='ICAO_LTO';
--       DELETE FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2';
