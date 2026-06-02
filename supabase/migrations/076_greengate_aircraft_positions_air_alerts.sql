-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 076: GreenGate v8 — Wedge 1-C aircraft positions + polymorphic alerts
-- aircraft_positions (mirror vessel_positions) + arrival_alerts made polymorphic
-- (shared maritime+air alert table, design §3): add aircraft_id, drop maritime
-- NOT NULLs, add a mode-discriminated asset CHECK. ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.aircraft_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id     UUID NOT NULL REFERENCES public.aircraft(id) ON DELETE CASCADE,
  lat             NUMERIC(9,6) NOT NULL,
  lng             NUMERIC(9,6) NOT NULL,
  altitude_ft     INTEGER,
  ground_speed_kt NUMERIC(6,1),
  heading         NUMERIC(5,1),
  in_fir          BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aircraft_positions_aircraft
  ON public.aircraft_positions(aircraft_id, recorded_at DESC);
COMMENT ON TABLE public.aircraft_positions IS
  'GreenGate v8 Wedge 1-C: ADS-B position reports for aircraft (mirror of vessel_positions).';

ALTER TABLE public.arrival_alerts
  ADD COLUMN IF NOT EXISTS aircraft_id UUID REFERENCES public.aircraft(id);
ALTER TABLE public.arrival_alerts ALTER COLUMN vessel_id DROP NOT NULL;
ALTER TABLE public.arrival_alerts ALTER COLUMN imo_number DROP NOT NULL;
ALTER TABLE public.arrival_alerts ALTER COLUMN distance_to_port_nm DROP NOT NULL;

ALTER TABLE public.arrival_alerts DROP CONSTRAINT IF EXISTS arrival_alerts_asset_per_mode;
ALTER TABLE public.arrival_alerts ADD CONSTRAINT arrival_alerts_asset_per_mode CHECK (
  (mode = 'AIR' AND aircraft_id IS NOT NULL) OR
  (mode <> 'AIR' AND vessel_id IS NOT NULL)
) NOT VALID;
ALTER TABLE public.arrival_alerts VALIDATE CONSTRAINT arrival_alerts_asset_per_mode;
CREATE INDEX IF NOT EXISTS idx_arrival_alerts_aircraft
  ON public.arrival_alerts(aircraft_id, detected_at DESC);

-- ── RLS for aircraft_positions: mirror vessel_positions (mig 004) ─────────────
-- vessel_positions exposes a position only when the caller can see the parent
-- vessel (owner-of-fleet OR staff). aircraft visibility (mig 074) is operator-of-
-- aircraft (shipowners.profile_id) OR staff confined to their jurisdiction, so we
-- gate aircraft_positions on the SAME chain via an EXISTS on aircraft.
ALTER TABLE public.aircraft_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see positions of visible aircraft" ON public.aircraft_positions;
CREATE POLICY "Users see positions of visible aircraft"
  ON public.aircraft_positions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.aircraft a
      WHERE a.id = aircraft_positions.aircraft_id
        AND (
          EXISTS (SELECT 1 FROM public.shipowners s
                   WHERE s.id = a.operator_id AND s.profile_id = auth.uid())
          OR ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
               AND a.jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
        )
    )
  );

-- Officers can insert positions (manual entry); the ADS-B feed writes via the
-- service-role platform client, which bypasses RLS. Mirrors vessel_positions.
DROP POLICY IF EXISTS "Officers can insert aircraft positions" ON public.aircraft_positions;
CREATE POLICY "Officers can insert aircraft positions"
  ON public.aircraft_positions FOR INSERT
  WITH CHECK (
    public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aircraft_positions TO service_role;

-- DOWN: DROP TABLE aircraft_positions; ALTER arrival_alerts DROP CONSTRAINT arrival_alerts_asset_per_mode,
--       DROP COLUMN aircraft_id; (NOT NULLs intentionally left dropped — harmless).
