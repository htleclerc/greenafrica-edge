-- ─────────────────────────────────────────────────────────────────────────────
-- Tax calculator test harness: minimal stub for migrations 025, 071, 074, 075, 080.
-- Applied to a fresh throwaway PG instance (port 55443) — does NOT require pgmq,
-- pg_cron, or other Supabase-specific extensions.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Auth schema stub ────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

-- auth.uid() returns the session user's UUID from JWT claims.
-- In tests we run as service_role (bypasses RLS) so this never needs a real value.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULL::UUID $$;

-- ── Roles (Supabase built-ins) ───────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
END $$;

-- ── Core helper functions (mig 001 / mig 031) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- is_admin_or_officer: referenced by RLS policies in several migrations.
-- Always returns FALSE in tests (service_role bypasses RLS anyway).
CREATE OR REPLACE FUNCTION public.is_admin_or_officer()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT FALSE $$;

-- get_user_role: referenced by RLS in mig 074.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT NULL::TEXT $$;

-- ── Enums needed by core tables ──────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM (
      'PORT_OFFICER','FINANCE_ADMIN','SHIPPING_AGENT','SUPERADMIN','MANAGER'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operational_site') THEN
    CREATE TYPE public.operational_site AS ENUM (
      'BERBERA_PORT','NATIONAL_HQ','ZEILA_PORT'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vessel_category') THEN
    CREATE TYPE public.vessel_category AS ENUM (
      'CONTAINER','CARGO','TANKER','BULK_CARRIER','FERRY','NAVAL','SCIENTIFIC'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'compliance_status') THEN
    CREATE TYPE public.compliance_status AS ENUM (
      'COMPLIANT','PAYMENT_DUE','PROCESSING','NON_COMPLIANT','APPROACHING','EXEMPT'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_status') THEN
    CREATE TYPE public.transaction_status AS ENUM (
      'PAID','PENDING','OVERDUE','EXEMPT','DISPUTED',
      'INITIATED','CONFIRMED','REJECTED','CANCELLED','PARTIALLY_PAID','REFUNDED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'arrival_alert_status') THEN
    CREATE TYPE public.arrival_alert_status AS ENUM (
      'DETECTED','MATCHED_AUTO','UNCLAIMED','CLAIMED','ESCALATED',
      'PROFORMA_SENT','ARRIVED','DEPARTED_EEZ','RECONCILED','CANCELLED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipowner_account_state') THEN
    CREATE TYPE public.shipowner_account_state AS ENUM ('GHOST','INVITED','ACTIVE');
  END IF;
END $$;

-- ── Profiles ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  full_name        TEXT NOT NULL DEFAULT '',
  role             public.user_role NOT NULL DEFAULT 'PORT_OFFICER',
  operational_site public.operational_site NOT NULL DEFAULT 'BERBERA_PORT',
  country_code     CHAR(2) NOT NULL DEFAULT 'SO',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_profiles" ON public.profiles USING (TRUE);

-- ── Vessels (minimal stub) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vessels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_number       TEXT NOT NULL UNIQUE,
  mmsi             TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL DEFAULT '',
  call_sign        TEXT NOT NULL DEFAULT '',
  flag_code        CHAR(2) NOT NULL DEFAULT 'SO',
  category         public.vessel_category NOT NULL DEFAULT 'CARGO',
  gross_tonnage_dwt INTEGER NOT NULL DEFAULT 0,
  engine_power_kw  INTEGER NOT NULL DEFAULT 0,
  design_speed_knots NUMERIC(5,1) NOT NULL DEFAULT 0,
  compliance_status public.compliance_status NOT NULL DEFAULT 'APPROACHING',
  estimated_emissions_tco2 NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_liability_usd NUMERIC(12,2) NOT NULL DEFAULT 0,
  owner_id         UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_vessels" ON public.vessels USING (TRUE);

-- ── Shipowners (needed by 024/071/074) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shipowners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imo_company_no        TEXT UNIQUE,
  name                  TEXT NOT NULL DEFAULT '',
  account_state         public.shipowner_account_state NOT NULL DEFAULT 'GHOST',
  profile_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shipowners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_shipowners" ON public.shipowners USING (TRUE);

-- ── Transactions (minimal — 071 adds columns) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id        UUID REFERENCES public.vessels(id) ON DELETE CASCADE,
  vessel_name      TEXT NOT NULL DEFAULT '',
  vessel_imo       TEXT NOT NULL DEFAULT '',
  emissions_tco2   NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount_usd   NUMERIC(12,2) NOT NULL DEFAULT 0,
  status           public.transaction_status NOT NULL DEFAULT 'PENDING',
  document_type    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_transactions" ON public.transactions USING (TRUE);

-- ── Arrival alerts (minimal — 071 adds columns) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.arrival_alerts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id           UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  imo_number          TEXT NOT NULL DEFAULT '',
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_lat        NUMERIC(9,6) NOT NULL DEFAULT 0,
  detected_lng        NUMERIC(9,6) NOT NULL DEFAULT 0,
  distance_to_port_nm NUMERIC(10,2) NOT NULL DEFAULT 0,
  status              public.arrival_alert_status NOT NULL DEFAULT 'DETECTED',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.arrival_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_alerts" ON public.arrival_alerts USING (TRUE);

-- ── App config ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_app_config" ON public.app_config USING (TRUE);

-- Seed carbon tax rate (mig 027 value)
INSERT INTO public.app_config (key, value) VALUES
  ('carbon_tax.rate_usd_per_tco2', to_jsonb(40))
ON CONFLICT (key) DO NOTHING;

-- ── Extensions for arrival_alerts / vessels / positions (mig 023 + 024 back-fill) ─
-- These are the columns the tracker / corridor / sweeper tests need that the minimal
-- stub above omits. Added as ALTER TABLE IF NOT EXISTS so applying the real mig 023/024
-- over this stub is idempotent.

ALTER TABLE public.arrival_alerts
  ADD COLUMN IF NOT EXISTS estimated_eta       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_route_nm  NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS arrived_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS departed_eez_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason    TEXT;

-- Unique partial index on (vessel_id) WHERE status NOT IN (RECONCILED, CANCELLED).
-- Backs the corridor deduplication path (INSERT → unique violation → no second alert).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'arrival_alerts'
       AND indexname  = 'idx_alert_active_per_vessel'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX idx_alert_active_per_vessel
               ON public.arrival_alerts(vessel_id)
              WHERE status NOT IN (''RECONCILED'', ''CANCELLED'')';
  END IF;
END $$;

-- last_zone on vessels (mig 024)
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS last_zone TEXT;

-- ── vessel_positions (mig 003 subset — used by sweeper RunOnce query) ────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jurisdiction_zone') THEN
    CREATE TYPE public.jurisdiction_zone AS ENUM (
      'EEZ','PORT_VICINITY','TRANSIT_LANE','INTERNATIONAL'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vessel_positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id   UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  lat         NUMERIC(9,6) NOT NULL,
  lng         NUMERIC(9,6) NOT NULL,
  heading     NUMERIC(5,1) NOT NULL DEFAULT 0,
  speed_knots NUMERIC(5,1) NOT NULL DEFAULT 0,
  zone        public.jurisdiction_zone,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.vessel_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stub_all_vessel_positions" ON public.vessel_positions USING (TRUE);

-- AIR key seed (mig 075 value — needed by tariff/tax tests that check AIR mode)
INSERT INTO public.app_config (key, value) VALUES
  ('carbon_tax.air_rate_usd_per_tco2', to_jsonb(40))
ON CONFLICT (key) DO NOTHING;

-- arrival.corridor_radius_nm seed (needed by corridor watcher tests)
INSERT INTO public.app_config (key, value) VALUES
  ('arrival.corridor_radius_nm', to_jsonb(500))
ON CONFLICT (key) DO NOTHING;
