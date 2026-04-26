-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025 : emission_factors table with cascade (EU_MRV → IMO → fallback)
-- + seeds from IMO 4th GHG Study (2020, public domain)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.emission_factor_source AS ENUM (
  'EU_MRV',       -- per-vessel actual from EU MRV THETIS dataset
  'IMO_CATEGORY', -- per category + GT range, IMO reference tables
  'FALLBACK'      -- last resort generic factor
);

CREATE TABLE public.emission_factors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            public.emission_factor_source NOT NULL,
  imo_number        TEXT,
  vessel_category   public.vessel_category,
  gt_min            INT,
  gt_max            INT,
  grams_co2_per_nm  NUMERIC(10, 3) NOT NULL CHECK (grams_co2_per_nm > 0),
  valid_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until       DATE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (source = 'EU_MRV'       AND imo_number IS NOT NULL) OR
    (source = 'IMO_CATEGORY' AND vessel_category IS NOT NULL) OR
    (source = 'FALLBACK')
  )
);

CREATE INDEX idx_ef_imo
  ON public.emission_factors(imo_number)
  WHERE imo_number IS NOT NULL AND active = TRUE;

CREATE INDEX idx_ef_cat_gt
  ON public.emission_factors(vessel_category, gt_min, gt_max)
  WHERE active = TRUE;

-- ── Seeds (IMO 4th GHG Study 2020 — conservative category averages) ─────────
INSERT INTO public.emission_factors (source, vessel_category, gt_min, gt_max, grams_co2_per_nm, notes) VALUES
  ('IMO_CATEGORY', 'TANKER',       0,      5000,    48000,  'GHG4 small tanker'),
  ('IMO_CATEGORY', 'TANKER',       5000,   60000,   120000, 'GHG4 medium tanker'),
  ('IMO_CATEGORY', 'TANKER',       60000,  200000,  280000, 'GHG4 large tanker'),
  ('IMO_CATEGORY', 'CARGO',        0,      5000,    35000,  'GHG4 small cargo'),
  ('IMO_CATEGORY', 'CARGO',        5000,   60000,   95000,  'GHG4 medium cargo'),
  ('IMO_CATEGORY', 'CARGO',        60000,  200000,  220000, 'GHG4 large cargo'),
  ('IMO_CATEGORY', 'CONTAINER',    0,      60000,   110000, 'GHG4 small/medium container'),
  ('IMO_CATEGORY', 'CONTAINER',    60000,  200000,  300000, 'GHG4 large container'),
  ('IMO_CATEGORY', 'BULK_CARRIER', 0,      200000,  100000, 'GHG4 bulk carrier'),
  ('IMO_CATEGORY', 'FERRY',        0,      999999,  70000,  'GHG4 ferry'),
  ('IMO_CATEGORY', 'NAVAL',        0,      999999,  90000,  'GHG4 naval estimate'),
  ('IMO_CATEGORY', 'SCIENTIFIC',   0,      999999,  60000,  'GHG4 scientific/research'),
  ('FALLBACK',     NULL,           NULL,   NULL,    50000,  'Conservative fallback');
