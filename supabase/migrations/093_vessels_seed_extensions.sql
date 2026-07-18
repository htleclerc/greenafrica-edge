-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 093: Vessels — extensions package onboarding + NOT NULL relaxés
--
-- Les 100 navires du package (source Equasis/VesselFinder) n'ont ni call_sign
-- ni engine_power ni design_speed. Ces colonnes datent de la mig 003 (démo AIS) ;
-- on les rend nullables plutôt que d'inventer des valeurs sentinelles.
-- vessel_subtype préserve le type source ("Livestock Carrier"…) quand l'enum
-- vessel_category (003) ne le couvre pas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessels
  ALTER COLUMN mmsi DROP NOT NULL,
  ALTER COLUMN call_sign DROP NOT NULL,
  ALTER COLUMN engine_power_kw DROP NOT NULL,
  ALTER COLUMN design_speed_knots DROP NOT NULL;

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS vessel_subtype  TEXT,
  ADD COLUMN IF NOT EXISTS dwt             INTEGER,
  ADD COLUMN IF NOT EXISTS build_year      INTEGER,
  ADD COLUMN IF NOT EXISTS previous_names  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS wave_tag        TEXT,
  ADD COLUMN IF NOT EXISTS seed_ref        TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessels_seed_ref
  ON public.vessels(seed_ref) WHERE seed_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vessels_wave ON public.vessels(wave_tag)
  WHERE wave_tag IS NOT NULL;

COMMENT ON COLUMN public.vessels.vessel_subtype IS
  'Type source du package onboarding (ex. "Livestock Carrier") — plus fin que l''enum vessel_category.';

-- DOWN:
-- ALTER TABLE public.vessels DROP COLUMN IF EXISTS vessel_subtype, DROP COLUMN IF EXISTS dwt,
--   DROP COLUMN IF EXISTS build_year, DROP COLUMN IF EXISTS previous_names,
--   DROP COLUMN IF EXISTS wave_tag, DROP COLUMN IF EXISTS seed_ref;
-- (les NOT NULL ne sont pas restaurés — des lignes NULL existeraient)
