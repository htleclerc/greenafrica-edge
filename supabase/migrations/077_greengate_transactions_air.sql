-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 077: GreenGate v8 — Wedge 1-C transactions polymorphic (air)
-- Add aircraft_id + drop vessel_id NOT NULL + mode-discriminated asset CHECK so an
-- AIR PROFORMA transaction can reference an aircraft instead of a vessel. vessel_name /
-- vessel_imo stay NOT NULL and are populated with the aircraft's registration/icao for
-- air rows (shared "asset name/identifier" columns; the W1-D UI badges the mode). ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS aircraft_id UUID REFERENCES public.aircraft(id);
ALTER TABLE public.transactions ALTER COLUMN vessel_id DROP NOT NULL;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_asset_per_mode;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_asset_per_mode CHECK (
  (mode = 'AIR' AND aircraft_id IS NOT NULL) OR
  (mode <> 'AIR' AND vessel_id IS NOT NULL)
) NOT VALID;
ALTER TABLE public.transactions VALIDATE CONSTRAINT transactions_asset_per_mode;
CREATE INDEX IF NOT EXISTS idx_transactions_aircraft ON public.transactions(aircraft_id);
-- DOWN: ALTER TABLE transactions DROP CONSTRAINT transactions_asset_per_mode, DROP COLUMN aircraft_id;
