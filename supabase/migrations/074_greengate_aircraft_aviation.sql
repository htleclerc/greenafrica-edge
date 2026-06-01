-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 074: GreenGate v8 — Wedge 1-A aviation data foundation (ADDITIVE)
--
-- New tables only; no change to maritime tables. Mirrors the maritime asset/operator
-- pattern (design §2: disjoint vessels + aircraft):
--   • aircraft            ≈ vessels       (tenant-scoped; mig-073-style staff RLS)
--   • air_emission_factors ≈ methodologies (global reference; read-all, admin-write)
-- Mode is implicitly AIR for aircraft (mirrors vessels' implicit MARITIME — no column).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── aircraft (tenant-scoped asset; operator = generalised shipowners entity) ──
CREATE TABLE IF NOT EXISTS public.aircraft (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icao24            TEXT,                                   -- 24-bit Mode S hex (ADS-B key ≈ vessels.mmsi)
  registration      TEXT,                                  -- tail number, e.g. '6O-AAA' (≈ vessels.name)
  icao_type         TEXT,                                  -- ICAO type designator 'A320' (drives EDB lookup)
  engine_type       TEXT,                                  -- engine family/type (second EDB key)
  mtow_kg           INTEGER,                               -- max takeoff weight (W1-B MTOW fallback input)
  operator_id       UUID REFERENCES public.shipowners(id), -- NULL until claimed; GHOST-linked in W1-C
  jurisdiction_id   UUID NOT NULL
                      DEFAULT '00000000-0000-4000-8000-00000000534f'
                      REFERENCES public.jurisdictions(id),
  compliance_status public.compliance_status NOT NULL DEFAULT 'APPROACHING',  -- reuse mig-003 enum
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_aircraft_icao24
  ON public.aircraft (icao24) WHERE icao24 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aircraft_operator     ON public.aircraft (operator_id);
CREATE INDEX IF NOT EXISTS idx_aircraft_jurisdiction ON public.aircraft (jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_aircraft_registration ON public.aircraft (registration);

COMMENT ON TABLE public.aircraft IS
  'GreenGate v8 Wedge 1: AIR-mode asset (disjoint from vessels). icao24 = ADS-B Mode S correlation key; icao_type drives air_emission_factors lookup; operator_id → shipowners (generalised operator).';

ALTER TABLE public.aircraft ENABLE ROW LEVEL SECURITY;

-- SELECT: the operating shipowner (via shipowners.profile_id) OR staff confined to
-- their jurisdiction (mig-073 pattern). Mirrors vessels "Shipping agents see own fleet".
DROP POLICY IF EXISTS "operators + staff see aircraft" ON public.aircraft;
CREATE POLICY "operators + staff see aircraft"
  ON public.aircraft FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.shipowners s
             WHERE s.id = aircraft.operator_id AND s.profile_id = auth.uid())
    OR ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
         AND jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
  );

-- Write: admins/officers confined to their jurisdiction (mirrors shipowners "admins full").
-- Service-role (TenantScopedClient) bypasses RLS for system writes (W1-C detection, etc.).
DROP POLICY IF EXISTS "admins manage aircraft" ON public.aircraft;
CREATE POLICY "admins manage aircraft"
  ON public.aircraft FOR ALL
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  )
  WITH CHECK (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aircraft TO service_role;

-- ── air_emission_factors (global reference; mirrors methodologies) ────────────
CREATE TABLE IF NOT EXISTS public.air_emission_factors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icao_type            TEXT NOT NULL,
  engine_type          TEXT,
  co2_kg_per_lto_cycle NUMERIC NOT NULL,   -- CO2 per standard ICAO LTO cycle
  source               TEXT,               -- 'ICAO_EDB' for seeded rows
  effective_from       DATE NOT NULL,
  UNIQUE (icao_type, engine_type, effective_from)
);

COMMENT ON TABLE public.air_emission_factors IS
  'GreenGate v8 Wedge 1: CO2 per ICAO LTO cycle by aircraft type/engine. Seeded rows are ICAO-EDB-derived (LTO fuel burn × 3.16 kg CO2/kg). Types absent here fall back to an MTOW estimate in the W1-B calculator (with an "approximate" flag).';

ALTER TABLE public.air_emission_factors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone reads air emission factors" ON public.air_emission_factors;
CREATE POLICY "anyone reads air emission factors"
  ON public.air_emission_factors FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "admins write air emission factors" ON public.air_emission_factors;
CREATE POLICY "admins write air emission factors"
  ON public.air_emission_factors FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.air_emission_factors TO service_role;

-- ── seed: representative types at Somaliland airports (Hargeisa/Berbera) ──────
-- Values are ICAO-EDB-derived approximations (full-LTO-cycle fuel burn × 3.16 kg
-- CO2/kg); validate against the current ICAO EDB before production billing.
INSERT INTO public.air_emission_factors (icao_type, engine_type, co2_kg_per_lto_cycle, source, effective_from) VALUES
  ('A320', 'CFM56-5B',  2600, 'ICAO_EDB', DATE '2026-06-01'),
  ('A20N', 'LEAP-1A',   2150, 'ICAO_EDB', DATE '2026-06-01'),
  ('A321', 'CFM56-5B',  2950, 'ICAO_EDB', DATE '2026-06-01'),
  ('B738', 'CFM56-7B',  2800, 'ICAO_EDB', DATE '2026-06-01'),
  ('B38M', 'LEAP-1B',   2400, 'ICAO_EDB', DATE '2026-06-01'),
  ('E190', 'CF34-10E',  1900, 'ICAO_EDB', DATE '2026-06-01'),
  ('CRJ9', 'CF34-8C',   1650, 'ICAO_EDB', DATE '2026-06-01'),
  ('AT76', 'PW127',      560, 'ICAO_EDB', DATE '2026-06-01'),
  ('DH8D', 'PW150A',     650, 'ICAO_EDB', DATE '2026-06-01'),
  ('B763', 'CF6-80C2',  5500, 'ICAO_EDB', DATE '2026-06-01'),
  ('A332', 'CF6-80E1',  7000, 'ICAO_EDB', DATE '2026-06-01'),
  ('B788', 'GEnx-1B',   6500, 'ICAO_EDB', DATE '2026-06-01')
ON CONFLICT (icao_type, engine_type, effective_from) DO NOTHING;

-- DOWN: DROP TABLE public.air_emission_factors; DROP TABLE public.aircraft;
-- (both are additive — dropping them is safe; no maritime data depends on them.)
