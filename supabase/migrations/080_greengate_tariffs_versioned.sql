-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 080: GreenGate v8 Wedge 2 — versioned tariffs table
--
-- PRIX = méthodologie[mode](émissions) × tarif[juridiction, mode, catégorie, date].
-- Replaces the global app_config keys (carbon_tax.rate_usd_per_tco2 /
-- carbon_tax.air_rate_usd_per_tco2) as the rate source of truth. The Go calculator
-- becomes tariff-aware (fail-closed: no ACTIVE tariff row → error, never silent $0).
-- The app_config keys are left in place for rollback but are no longer read after
-- the Go deploy that ships with this migration.
--
-- Versioning rules:
--   • A row is a tariff VERSION: [effective_from, effective_to) ; effective_to NULL = current.
--   • asset_category NULL = applies to ALL categories of the mode (specific row wins).
--   • zone reserved (NULL = all zones) — schema aligned with the design doc, unused in v1 lookup.
--   • No overlapping ACTIVE windows per (jurisdiction, mode, category, zone) — exclusion constraint.
--   • signature_hash reserved for D2 anchoring (decision 3A: invoices only in v8).
--   • transactions snapshot tariff_id at issuance — issued invoices never change.
--   • ARCHIVED = withdrawn/never-applicable. A SUPERSEDED version is CLOSED (effective_to set),
--     never archived — past-dated lookups must keep resolving.
--
-- Seeds Somaliland MARITIME + AIR versions from the live app_config values so the
-- Go cutover is value-identical.
--
-- app_config JSON format: values stored as raw JSON scalars via to_jsonb(40) — e.g.
--   ('carbon_tax.rate_usd_per_tco2', to_jsonb(40), ...)
-- which stores the integer 40 as a bare JSON number. `value #>> '{}'` correctly
-- extracts the text representation '40' of a scalar jsonb value. Verified in mig 027
-- (original INSERT) and mig 075 (AIR rate copied from maritime using the same key).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- btree_gist supports enum types natively via gist_enum_ops — no wrapper function needed.

CREATE TABLE IF NOT EXISTS public.tariffs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id),
  mode             public.transport_mode NOT NULL,
  asset_category   TEXT,                          -- NULL = all categories (specific wins)
  zone             TEXT,                          -- reserved (NULL = all zones)
  rate_per_tco2    NUMERIC(10,2) NOT NULL CHECK (rate_per_tco2 > 0),
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  effective_from   DATE NOT NULL,
  effective_to     DATE,                          -- NULL = current version
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  decree_ref       TEXT,
  signature_hash   TEXT,                          -- reserved: D2 anchoring seam (3A)
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- transitional: v1 lookup is not zone-aware; drop this CHECK in the migration that makes the Go lookup zone-aware
  CONSTRAINT tariffs_zone_reserved CHECK (zone IS NULL),
  -- '*' is the NULL sentinel in the exclusion constraint COALESCE keys — never allow literal '*'
  CONSTRAINT tariffs_no_sentinel CHECK (asset_category IS DISTINCT FROM '*' AND zone IS DISTINCT FROM '*'),
  CONSTRAINT tariffs_no_overlap EXCLUDE USING gist (
    jurisdiction_id WITH =,
    mode WITH =,                                  -- native enum gist ops (gist_enum_ops)
    (COALESCE(asset_category, '*')) WITH =,
    (COALESCE(zone, '*')) WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS idx_tariffs_lookup
  ON public.tariffs (jurisdiction_id, mode, status, effective_from DESC);

-- Immutability guard: ACTIVE fiscal rows are append-only for the core rate fields.
-- Allowed on ACTIVE rows: setting effective_to, changing status, decree_ref, signature_hash.
CREATE OR REPLACE FUNCTION public.tariffs_active_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ACTIVE' THEN
    IF (
      NEW.jurisdiction_id  IS DISTINCT FROM OLD.jurisdiction_id  OR
      NEW.mode             IS DISTINCT FROM OLD.mode             OR
      NEW.asset_category   IS DISTINCT FROM OLD.asset_category   OR
      NEW.zone             IS DISTINCT FROM OLD.zone             OR
      NEW.rate_per_tco2    IS DISTINCT FROM OLD.rate_per_tco2    OR
      NEW.currency         IS DISTINCT FROM OLD.currency         OR
      NEW.effective_from   IS DISTINCT FROM OLD.effective_from
    ) THEN
      RAISE EXCEPTION 'tariffs: ACTIVE fiscal rows are immutable except closing effective_to / status / decree_ref / signature_hash';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tariffs_active_immutable
  BEFORE UPDATE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.tariffs_active_guard();

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES public.tariffs(id);

COMMENT ON COLUMN public.transactions.tariff_id IS
  'Tariff version used at issuance (GreenGate v8 W2). Snapshot — never updated after issue.';

ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads tariffs" ON public.tariffs FOR SELECT USING (TRUE);

CREATE POLICY "finance admins write tariffs" ON public.tariffs FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
              AND p.role IN ('FINANCE_ADMIN','SUPERADMIN'))
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
              AND p.role IN ('FINANCE_ADMIN','SUPERADMIN'))
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
SELECT '00000000-0000-4000-8000-00000000534f', 'MARITIME',
       (value #>> '{}')::numeric, 'USD', CURRENT_DATE, 'ACTIVE', 'MOE&CC/mi/36/2026'
  FROM public.app_config WHERE key = 'carbon_tax.rate_usd_per_tco2'
ON CONFLICT DO NOTHING;

INSERT INTO public.tariffs (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
SELECT '00000000-0000-4000-8000-00000000534f', 'AIR',
       (value #>> '{}')::numeric, 'USD', CURRENT_DATE, 'ACTIVE', 'MOE&CC/mi/36/2026'
  FROM public.app_config WHERE key = 'carbon_tax.air_rate_usd_per_tco2'
ON CONFLICT DO NOTHING;

-- Post-seed assertion: fail at deploy time if app_config keys were absent (silent-empty-seed guard).
DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.tariffs
     WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
       AND status = 'ACTIVE'
       AND effective_to IS NULL
  ) <> 2 THEN
    RAISE EXCEPTION 'mig 080: Somaliland tariff seeds missing (app_config keys absent?)';
  END IF;
END $$;

-- DOWN (DESTRUCTIVE: drops the issuance snapshot on issued invoices; revert the tariff-aware Go deploy FIRST or every calculation will fail-closed):
-- DROP TRIGGER IF EXISTS tariffs_active_immutable ON public.tariffs;
-- DROP FUNCTION IF EXISTS public.tariffs_active_guard();
-- ALTER TABLE public.transactions DROP COLUMN IF EXISTS tariff_id;
-- DROP TABLE IF EXISTS public.tariffs;
