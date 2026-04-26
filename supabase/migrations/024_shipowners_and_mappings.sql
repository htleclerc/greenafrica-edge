-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024 : shipowners, owner_agent_mappings, vessels extensions
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum ────────────────────────────────────────────────────────────────────
CREATE TYPE public.shipowner_account_state AS ENUM ('GHOST', 'INVITED', 'ACTIVE');

-- ── shipowners ──────────────────────────────────────────────────────────────
CREATE TABLE public.shipowners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_company_no        TEXT UNIQUE,
  name                  TEXT NOT NULL,
  country_code          TEXT,
  address               TEXT,
  official_email        TEXT,
  official_email_source TEXT CHECK (official_email_source IN
    ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED')),
  email_verified_at     TIMESTAMPTZ,
  account_state         public.shipowner_account_state NOT NULL DEFAULT 'GHOST',
  profile_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shipowners_imo_company ON public.shipowners(imo_company_no)
  WHERE imo_company_no IS NOT NULL;

CREATE TRIGGER shipowners_updated_at
  BEFORE UPDATE ON public.shipowners
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── owner_agent_mappings ────────────────────────────────────────────────────
CREATE TABLE public.owner_agent_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id     UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  agent_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  priority         INT  NOT NULL DEFAULT 100,
  valid_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until      DATE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipowner_id, agent_profile_id, valid_from)
);

CREATE INDEX idx_oam_lookup
  ON public.owner_agent_mappings(shipowner_id, active, priority)
  WHERE active = TRUE;

-- ── vessels extensions ─────────────────────────────────────────────────────
-- shipowner_id: use SET NULL on delete so a Port Officer cleaning up a
-- duplicate shipowner row does not cascade-delete vessels across the fleet.
ALTER TABLE public.vessels
  ADD COLUMN shipowner_id UUID REFERENCES public.shipowners(id) ON DELETE SET NULL,
  ADD COLUMN last_zone    TEXT;

CREATE INDEX idx_vessels_shipowner ON public.vessels(shipowner_id)
  WHERE shipowner_id IS NOT NULL;

COMMENT ON COLUMN public.vessels.last_zone IS
  'Cached last-known zone from Go eez detector. Values: EEZ, PORT_VICINITY, TRANSIT_LANE, INTERNATIONAL. Updated per AIS tick to detect zone-edge transitions.';

-- Disambiguate the pre-existing `owner_id` column (mig 003) from the new
-- `shipowner_id`: the former is the local shipping agent (used for RLS scope
-- of the dashboard), the latter is the actual vessel owner / operator.
COMMENT ON COLUMN public.vessels.owner_id IS
  'Local shipping agent representing the vessel (profiles.id). Despite the name, this is NOT the ship owner — see shipowner_id for the registered owner record.';
COMMENT ON COLUMN public.vessels.shipowner_id IS
  'Registered owner / operator of the vessel (shipowners.id). Distinct from owner_id which denotes the local shipping agent.';
