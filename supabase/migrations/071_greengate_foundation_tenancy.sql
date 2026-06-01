-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 071: GreenGate v8 Foundation — tenant + mode discriminators (ADDITIVE)
--
-- Phase 0a of the GreenGate v8 restructuring (multi-tenant · multi-mode · multi-pays).
-- See docs/designs/GREENGATE_V8_MULTITENANT.md.
--
-- ADDITIVE and BACKWARD-COMPATIBLE — no existing RLS policy is changed:
--   • Control-plane tables: jurisdictions, methodologies, jurisdiction_mode_config,
--     user_jurisdictions.
--   • transport_mode enum ('MARITIME','AIR').
--   • jurisdiction_id + mode discriminators on transactions / arrival_alerts / vessels,
--     shipowners.applicable_modes.
--   • Somaliland seeded as tenant #1; ALL existing rows backfilled to Somaliland via a
--     constant column DEFAULT (the "expand" step — old code paths that don't yet set
--     jurisdiction_id keep writing valid Somaliland rows during the deploy window).
--     The DEFAULT is dropped in the later contract migration once every write path sets
--     jurisdiction_id explicitly.
--   • current_jurisdiction_ids() RLS helper (inert until policies reference it in mig 072).
--
-- The behavioural RLS re-key + cross-tenant isolation tests + the TenantScopedClient
-- wrapper land NEXT (mig 072 + app), while there is still only one tenant (Somaliland)
-- and therefore zero cross-tenant data that could leak during the change.
--
-- INDEX NOTE: indexes are created in-transaction (plain CREATE INDEX). Tables are small
-- (Somaliland launched 2026-05). For large-table production, create these CONCURRENTLY
-- outside a transaction instead.
-- ─────────────────────────────────────────────────────────────────────────────

-- Somaliland (tenant #1) fixed id — last bytes 0x534F = ASCII "SO".
-- Used as the column DEFAULT below so existing rows backfill and old code paths stay valid.

-- ── transport mode enum ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transport_mode') THEN
    CREATE TYPE public.transport_mode AS ENUM ('MARITIME','AIR');
  END IF;
END $$;

-- ── jurisdictions (control-plane registry — a "tenant" = a country-concession) ─
CREATE TABLE IF NOT EXISTS public.jurisdictions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL UNIQUE,                            -- ISO-ish: 'SO','SN',...
  name              TEXT NOT NULL,
  default_currency  CHAR(3) NOT NULL DEFAULT 'USD',
  data_plane        TEXT NOT NULL DEFAULT 'POOL' CHECK (data_plane IN ('POOL','SILO')),
  data_plane_ref    TEXT,                                           -- NULL when POOL; Supabase project ref when SILO
  sovereign_region  TEXT,
  regulator_name    TEXT,
  locales           TEXT[] NOT NULL DEFAULT ARRAY['en']::TEXT[],     -- locales per jurisdiction (design decision)
  status            TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER jurisdictions_updated_at
  BEFORE UPDATE ON public.jurisdictions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Seed Somaliland as tenant #1 (the current implicit single tenant becomes explicit).
INSERT INTO public.jurisdictions (id, code, name, default_currency, data_plane,
                                  sovereign_region, regulator_name, locales, status)
VALUES ('00000000-0000-4000-8000-00000000534f', 'SO', 'Republic of Somaliland', 'USD',
        'POOL', 'Somaliland', 'MoECC', ARRAY['so','ar','en']::TEXT[], 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- ── methodologies (versioned CO2 methodology registry) ────────────────────────
CREATE TABLE IF NOT EXISTS public.methodologies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode        public.transport_mode NOT NULL,
  code        TEXT NOT NULL,                                         -- 'IMO_MEPC_364_79', 'ICAO_LTO'
  version     TEXT NOT NULL,
  params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mode, code, version)
);

INSERT INTO public.methodologies (mode, code, version) VALUES
  ('MARITIME', 'IMO_MEPC_364_79', '4th-GHG-2020'),
  ('AIR',      'ICAO_LTO',        'EDB-2024')
ON CONFLICT (mode, code, version) DO NOTHING;

-- ── jurisdiction_mode_config (activation matrix — maritime / air / both per country) ─
CREATE TABLE IF NOT EXISTS public.jurisdiction_mode_config (
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  mode             public.transport_mode NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  methodology_id   UUID REFERENCES public.methodologies(id),
  geofence_ref     TEXT,
  activated_at     TIMESTAMPTZ,
  PRIMARY KEY (jurisdiction_id, mode)
);

-- Somaliland: MARITIME enabled now (current prod). AIR present-but-DISABLED — flipped on
-- in Wedge 1 once ICAO LTO + aircraft land. This row also proves the "one mode on, one off"
-- requirement (a jurisdiction may run maritime, air, or both per its concession).
INSERT INTO public.jurisdiction_mode_config (jurisdiction_id, mode, enabled, methodology_id, geofence_ref, activated_at)
SELECT '00000000-0000-4000-8000-00000000534f', 'MARITIME', TRUE, m.id, 'somaliland-eez', NOW()
  FROM public.methodologies m WHERE m.mode = 'MARITIME' AND m.code = 'IMO_MEPC_364_79'
ON CONFLICT (jurisdiction_id, mode) DO NOTHING;

INSERT INTO public.jurisdiction_mode_config (jurisdiction_id, mode, enabled, methodology_id)
SELECT '00000000-0000-4000-8000-00000000534f', 'AIR', FALSE, m.id
  FROM public.methodologies m WHERE m.mode = 'AIR' AND m.code = 'ICAO_LTO'
ON CONFLICT (jurisdiction_id, mode) DO NOTHING;

-- ── user_jurisdictions (staff ↔ jurisdiction membership — drives RLS scoping in 072) ─
CREATE TABLE IF NOT EXISTS public.user_jurisdictions (
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, jurisdiction_id)
);

-- Backfill: every existing non-SUPERADMIN profile works Somaliland today.
-- (SUPERADMIN gets ALL jurisdictions implicitly via current_jurisdiction_ids().)
INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
SELECT p.id, '00000000-0000-4000-8000-00000000534f'
  FROM public.profiles p
 WHERE p.role <> 'SUPERADMIN'
ON CONFLICT DO NOTHING;

-- ── discriminators on existing tables (additive; constant DEFAULT backfills existing rows) ─
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id),
  ADD COLUMN IF NOT EXISTS mode public.transport_mode NOT NULL DEFAULT 'MARITIME';

ALTER TABLE public.arrival_alerts
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id),
  ADD COLUMN IF NOT EXISTS mode public.transport_mode NOT NULL DEFAULT 'MARITIME',
  ADD COLUMN IF NOT EXISTS distance_m NUMERIC;     -- canonical SI distance (nm/km derived at display)

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS applicable_modes public.transport_mode[] NOT NULL
    DEFAULT ARRAY['MARITIME']::public.transport_mode[];

COMMENT ON COLUMN public.transactions.jurisdiction_id IS
  'GreenGate v8 tenant discriminator. DEFAULT (Somaliland) is a transitional expand-step safety net; drop it in the contract migration once every write path sets jurisdiction_id explicitly.';
COMMENT ON COLUMN public.arrival_alerts.distance_m IS
  'Canonical SI distance in metres (mode-agnostic). Maritime nm and air km are derived at display. Backfill from estimated_route_nm × 1852 is a follow-up data task.';
COMMENT ON COLUMN public.shipowners.applicable_modes IS
  'GreenGate v8: which transport modes this operator transacts (MARITIME, AIR). shipowners is the generalised "operator" entity reused across modes (design decision 5A).';

-- ── RLS helper: jurisdictions the caller may access (inert until mig 072 references it) ─
-- SECURITY DEFINER + empty search_path + fully-qualified identifiers (matches mig 031/058).
-- STABLE so Postgres evaluates it once per query, not per row (perf).
CREATE OR REPLACE FUNCTION public.current_jurisdiction_ids()
RETURNS UUID[]
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = auth.uid() AND p.role = 'SUPERADMIN')
      THEN (SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM public.jurisdictions)
    ELSE (SELECT COALESCE(array_agg(jurisdiction_id), ARRAY[]::uuid[])
            FROM public.user_jurisdictions WHERE user_id = auth.uid())
  END;
$$;

GRANT EXECUTE ON FUNCTION public.current_jurisdiction_ids() TO authenticated, service_role;

-- ── RLS on new control-plane tables (reference/config: read-all, admin-write) ─────────
ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads jurisdictions" ON public.jurisdictions FOR SELECT USING (TRUE);
CREATE POLICY "admins write jurisdictions" ON public.jurisdictions FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());

ALTER TABLE public.methodologies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads methodologies" ON public.methodologies FOR SELECT USING (TRUE);
CREATE POLICY "admins write methodologies" ON public.methodologies FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());

ALTER TABLE public.jurisdiction_mode_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone reads mode config" ON public.jurisdiction_mode_config FOR SELECT USING (TRUE);
CREATE POLICY "admins write mode config" ON public.jurisdiction_mode_config FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());

ALTER TABLE public.user_jurisdictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own memberships" ON public.user_jurisdictions FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin_or_officer());
CREATE POLICY "admins write memberships" ON public.user_jurisdictions FOR ALL
  USING (public.is_admin_or_officer()) WITH CHECK (public.is_admin_or_officer());

-- ── indexes (see INDEX NOTE in header re: CONCURRENTLY for large tables) ───────
CREATE INDEX IF NOT EXISTS idx_transactions_jurisdiction   ON public.transactions(jurisdiction_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_mode           ON public.transactions(mode);
CREATE INDEX IF NOT EXISTS idx_arrival_alerts_jurisdiction ON public.arrival_alerts(jurisdiction_id, status);
CREATE INDEX IF NOT EXISTS idx_vessels_jurisdiction        ON public.vessels(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_user_jurisdictions_user     ON public.user_jurisdictions(user_id);

-- DOWN:
-- DROP INDEX IF EXISTS public.idx_user_jurisdictions_user, public.idx_vessels_jurisdiction,
--   public.idx_arrival_alerts_jurisdiction, public.idx_transactions_mode, public.idx_transactions_jurisdiction;
-- DROP POLICY ... ON public.user_jurisdictions; (×2) -- and on jurisdiction_mode_config, methodologies, jurisdictions
-- DROP FUNCTION IF EXISTS public.current_jurisdiction_ids();
-- ALTER TABLE public.shipowners    DROP COLUMN IF EXISTS applicable_modes;
-- ALTER TABLE public.vessels       DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.arrival_alerts DROP COLUMN IF EXISTS distance_m, DROP COLUMN IF EXISTS mode, DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.transactions  DROP COLUMN IF EXISTS mode, DROP COLUMN IF EXISTS jurisdiction_id;
-- DROP TABLE IF EXISTS public.user_jurisdictions, public.jurisdiction_mode_config, public.methodologies, public.jurisdictions;
-- DROP TYPE IF EXISTS public.transport_mode;
-- (Note: dropping jurisdiction_id columns first requires dropping the FK DEFAULT; the
--  jurisdictions table must be dropped AFTER the referencing columns.)
