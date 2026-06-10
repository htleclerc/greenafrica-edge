-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 082: GreenGate v8 Wedge 2 — geofences registry + Djibouti onboarding
--
-- (a) GEOFENCES TABLE — DB-driven registry replacing hardcoded Go constants:
--     • backend/internal/eez/detector.go   — SomalilandZones(): 4 maritime polygons
--     • backend/internal/fir/detector.go   — SomalilandFIR ring
--     • backend/internal/corridor/watcher.go — destinations Berbera + Zeila
--     • (plus the TS duplicate in /api/adsb/ingest that reads them inline)
--     Go + TS load the active rows at startup with a 60-second cache. Detection
--     resolves jurisdiction_id from the matched ring — ends SOMALILAND_JID hardcodes
--     and column-DEFAULT stamping on detection paths.
--
--     geometry JSONB format:
--       polygon/ring: '[{"lat":..,"lng":..},...]'  — closed (first point = last point)
--       port point:   '{"lat":..,"lng":..}'
--
--     ALL rings are APPROXIMATE (same caveat as W1) — refine against official ICAO
--     FIR / maritime boundary publications before production billing.
--
--     DE-OVERLAP NOTE: the seeded SO FIR west edge moves 42.5 → 43.45 so that the
--     Djibouti FIR (41.7–43.45 E) and Somaliland FIR (43.45–49.5 E) abut rather
--     than overlap. Billing airports (Hargeisa 44.06 E, Berbera 45.01 E) remain well
--     inside the SO FIR after the shift.
--
--   • CORRIDOR CAVEAT: nearest-PORT at first detection (up to 500nm out) is NOT a
--     reliable jurisdiction signal (Zeila and Port de Djibouti are 25nm apart). The
--     corridor alert's jurisdiction stamp is PROVISIONAL; proforma/destination
--     matching re-resolves it (see W2 geofence-store task).
--
-- (b) DJIBOUTI ONBOARDING (jurisdiction #2) — POOL data-plane, both modes signed
--     (MARITIME + AIR). Includes: registry row, activation matrix, harmonised
--     40 USD/tCO2 tariffs (effective DATE '2026-03-31' — consistent with mig 080 seeds),
--     escrow revenue-split rule, Djibouti geofences, and staff memberships (central
--     Solide ops team operates both concessions — PORT_OFFICER/FINANCE_ADMIN/MANAGER
--     only; agents/owners remain jurisdiction-local).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Geofences table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geofences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              TEXT NOT NULL UNIQUE,
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id),
  mode             public.transport_mode NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('PORT_VICINITY','EEZ','TRANSIT_LANE','FIR','PORT')),
  name             TEXT NOT NULL,
  geometry         JSONB NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT geofences_geometry_shape CHECK (
    (kind = 'PORT' AND jsonb_typeof(geometry) = 'object')
    OR (kind <> 'PORT' AND jsonb_typeof(geometry) = 'array')
  )
);

CREATE INDEX IF NOT EXISTS idx_geofences_active
  ON public.geofences (active, mode, kind);

ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads geofences" ON public.geofences
  FOR SELECT USING (TRUE);

CREATE POLICY "finance admins write geofences" ON public.geofences
  FOR ALL
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

-- ── Somaliland geofence seeds ────────────────────────────────────────────────
-- Exact coordinates from backend/internal/eez/detector.go (SomalilandZones())
-- and backend/internal/corridor/watcher.go (destinations).
-- FIR west edge de-overlapped: 42.5 → 43.45 (see header note).

INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-port-berbera',
  '00000000-0000-4000-8000-00000000534f',
  'MARITIME', 'PORT_VICINITY', 'Port of Berbera (approx)',
  '[{"lat":10.42,"lng":45.00},{"lat":10.42,"lng":45.08},{"lat":10.48,"lng":45.08},{"lat":10.48,"lng":45.00},{"lat":10.42,"lng":45.00}]'
) ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-port-zeila',
  '00000000-0000-4000-8000-00000000534f',
  'MARITIME', 'PORT_VICINITY', 'Port of Zeila (approx)',
  '[{"lat":11.33,"lng":43.44},{"lat":11.33,"lng":43.52},{"lat":11.39,"lng":43.52},{"lat":11.39,"lng":43.44},{"lat":11.33,"lng":43.44}]'
) ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-eez',
  '00000000-0000-4000-8000-00000000534f',
  'MARITIME', 'EEZ', 'Somaliland EEZ (approx)',
  '[{"lat":10.00,"lng":43.20},{"lat":10.00,"lng":51.50},{"lat":13.00,"lng":51.50},{"lat":12.50,"lng":49.00},{"lat":11.80,"lng":45.00},{"lat":11.50,"lng":43.20},{"lat":10.00,"lng":43.20}]'
) ON CONFLICT (ref) DO NOTHING;

-- W1→W2 narrowing: west edge moved 43.00 → 43.45 because the [43.00–43.45] segment
-- is Djibouti water (DJ EEZ east edge), not Somaliland water; W1 was single-tenant so
-- the overlap was harmless, but W2 multi-jurisdiction billing requires clean boundaries.
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-transit-aden',
  '00000000-0000-4000-8000-00000000534f',
  'MARITIME', 'TRANSIT_LANE', 'Gulf of Aden Transit Corridor (approx)',
  '[{"lat":11.50,"lng":43.45},{"lat":11.50,"lng":51.50},{"lat":13.50,"lng":51.50},{"lat":13.50,"lng":43.45},{"lat":11.50,"lng":43.45}]'
) ON CONFLICT (ref) DO NOTHING;

-- SO FIR: west edge moved 42.5 → 43.45 to abut DJ FIR; billing airports inside
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-fir',
  '00000000-0000-4000-8000-00000000534f',
  'AIR', 'FIR', 'Somaliland FIR (approx, de-overlapped west edge)',
  '[{"lat":7.5,"lng":43.45},{"lat":7.5,"lng":49.5},{"lat":11.8,"lng":49.5},{"lat":11.8,"lng":43.45},{"lat":7.5,"lng":43.45}]'
) ON CONFLICT (ref) DO NOTHING;

-- PORT point geometry (destination/corridor check — from corridor/watcher.go)
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-dest-berbera',
  '00000000-0000-4000-8000-00000000534f',
  'MARITIME', 'PORT', 'Berbera',
  '{"lat":10.43,"lng":45.02}'
) ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'somaliland-dest-zeila',
  '00000000-0000-4000-8000-00000000534f',
  'MARITIME', 'PORT', 'Zeila',
  '{"lat":11.35,"lng":43.48}'
) ON CONFLICT (ref) DO NOTHING;

-- ── Djibouti jurisdiction row ────────────────────────────────────────────────
-- Fixed UUID: last bytes 0x444A = ASCII "DJ"
INSERT INTO public.jurisdictions (id, code, name, default_currency, data_plane,
                                  sovereign_region, regulator_name, locales, status)
VALUES ('00000000-0000-4000-8000-00000000444a', 'DJ', 'Republic of Djibouti', 'DJF',
        'POOL', 'Djibouti', 'MEDD', ARRAY['fr','ar','en']::TEXT[], 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- ── Djibouti geofences ───────────────────────────────────────────────────────
-- APPROXIMATE rings. DJ abuts SO at lng 43.20 (maritime) / 43.45 (FIR).

-- 10-point ring: extends DJ waters east of 43.20 NORTH of lat 11.55 (Obock coast,
-- eastern Gulf of Tadjoura exit, Sept Frères), abutting SO EEZ at 43.20 below lat
-- 11.55; caps north at 12.70 to stay out of Eritrean waters; NW corner slopes off
-- Eritrean land. MUST be refined against official boundary before production billing.
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'djibouti-eez',
  '00000000-0000-4000-8000-00000000444a',
  'MARITIME', 'EEZ', 'Djibouti EEZ (approx — refine against official boundary before production billing)',
  '[{"lat":11.20,"lng":42.40},{"lat":11.20,"lng":43.20},{"lat":11.55,"lng":43.20},{"lat":11.55,"lng":43.30},{"lat":12.00,"lng":43.42},{"lat":12.70,"lng":43.45},{"lat":12.70,"lng":43.00},{"lat":12.40,"lng":42.55},{"lat":11.80,"lng":42.40},{"lat":11.20,"lng":42.40}]'
) ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'djibouti-port-djibouti',
  '00000000-0000-4000-8000-00000000444a',
  'MARITIME', 'PORT_VICINITY', 'Port de Djibouti (approx)',
  '[{"lat":11.57,"lng":43.10},{"lat":11.57,"lng":43.18},{"lat":11.63,"lng":43.18},{"lat":11.63,"lng":43.10},{"lat":11.57,"lng":43.10}]'
) ON CONFLICT (ref) DO NOTHING;

-- DJ FIR: east edge at 43.45 abuts SO FIR west edge (de-overlap)
INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'djibouti-fir',
  '00000000-0000-4000-8000-00000000444a',
  'AIR', 'FIR', 'Djibouti airspace (approx)',
  '[{"lat":10.90,"lng":41.70},{"lat":10.90,"lng":43.45},{"lat":12.80,"lng":43.45},{"lat":12.80,"lng":41.70},{"lat":10.90,"lng":41.70}]'
) ON CONFLICT (ref) DO NOTHING;

INSERT INTO public.geofences (ref, jurisdiction_id, mode, kind, name, geometry)
VALUES (
  'djibouti-dest-djibouti',
  '00000000-0000-4000-8000-00000000444a',
  'MARITIME', 'PORT', 'Port de Djibouti',
  '{"lat":11.60,"lng":43.14}'
) ON CONFLICT (ref) DO NOTHING;

-- ── Djibouti activation matrix ───────────────────────────────────────────────
INSERT INTO public.jurisdiction_mode_config
  (jurisdiction_id, mode, enabled, methodology_id, geofence_ref, activated_at)
SELECT '00000000-0000-4000-8000-00000000444a', 'MARITIME', TRUE, m.id,
       'djibouti-eez', NOW()
  FROM public.methodologies m
 WHERE m.mode = 'MARITIME' AND m.code = 'IMO_MEPC_364_79'
ON CONFLICT (jurisdiction_id, mode) DO NOTHING;

INSERT INTO public.jurisdiction_mode_config
  (jurisdiction_id, mode, enabled, methodology_id, geofence_ref, activated_at)
SELECT '00000000-0000-4000-8000-00000000444a', 'AIR', TRUE, m.id,
       'djibouti-fir', NOW()
  FROM public.methodologies m
 WHERE m.mode = 'AIR' AND m.code = 'ICAO_LTO'
ON CONFLICT (jurisdiction_id, mode) DO NOTHING;

-- ── Djibouti tariffs ─────────────────────────────────────────────────────────
-- Harmonised pan-African 40 USD/tCO2 for both modes.
-- effective_from pinned to DATE '2026-03-31' for consistency with mig 080 seeds.
-- Idempotency via WHERE NOT EXISTS per (jurisdiction, mode) — same pattern as mig 081.
-- NOTE: the NOT EXISTS check ignores effective_from/effective_to windows on purpose;
-- any pre-existing ACTIVE DJ tariff for the mode suppresses the seed — safe direction
-- (ops must explicitly manage effective windows via admin UI, not re-seed).
INSERT INTO public.tariffs
  (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
SELECT '00000000-0000-4000-8000-00000000444a', 'MARITIME',
       40, 'USD', DATE '2026-03-31', 'ACTIVE', 'DJ_CONCESSION_2026'
WHERE NOT EXISTS (
  SELECT 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     AND mode = 'MARITIME'
     AND status = 'ACTIVE'
);

INSERT INTO public.tariffs
  (jurisdiction_id, mode, rate_per_tco2, currency, effective_from, status, decree_ref)
SELECT '00000000-0000-4000-8000-00000000444a', 'AIR',
       40, 'USD', DATE '2026-03-31', 'ACTIVE', 'DJ_CONCESSION_2026'
WHERE NOT EXISTS (
  SELECT 1 FROM public.tariffs
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     AND mode = 'AIR'
     AND status = 'ACTIVE'
);

-- ── Djibouti revenue split rule ───────────────────────────────────────────────
-- 100% escrowed pending MinFin formalisation — same pattern as Somaliland (mig 081).
-- effective_from pinned TIMESTAMPTZ '2026-03-31T00:00:00Z' for consistent as-of lookup.
-- NOTE on DOWN: the mig 081 append-only trigger forbids DELETE on revenue_split_rule.
-- To remove this row during rollback, drop or disable the trigger first, then DELETE.
INSERT INTO public.revenue_split_rule
  (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct,
   contract_ref, signature_hash, signed_by)
SELECT '00000000-0000-4000-8000-00000000444a',
       TIMESTAMPTZ '2026-03-31T00:00:00Z',
       0, 100,
       'ESCROW_PENDING_DJ_MINFIN', 'PENDING', 'solide'
WHERE NOT EXISTS (
  SELECT 1 FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
);

-- ── Djibouti staff memberships ────────────────────────────────────────────────
-- Central Solide ops team operates both concessions.
-- PORT_OFFICER / FINANCE_ADMIN / MANAGER get access to DJ.
-- SHIPPING_AGENT and SHIPOWNER remain jurisdiction-local — NOT included.
INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
SELECT p.id, '00000000-0000-4000-8000-00000000444a'
  FROM public.profiles p
 WHERE p.role IN ('PORT_OFFICER','FINANCE_ADMIN','MANAGER')
   AND p.is_active = true
ON CONFLICT DO NOTHING;

-- ── DOWN (DESTRUCTIVE) ────────────────────────────────────────────────────────
-- Order matters — FK references must be removed before parent rows.
--
-- FK WARNINGS:
--   • public.tariffs DELETE will hit transactions.tariff_id FK once any DJ invoice
--     exists — delete or null-out transactions.tariff_id for DJ rows first.
--   • public.jurisdictions DELETE will hit FKs from transactions, vessels, and
--     arrival_alerts — remove or reassign those rows before deleting the jurisdiction.
--
-- NOTE: revenue_split_rule rows for DJ are permanent (mig 081 append-only triggers
-- forbid DELETE). Drop or disable both triggers before attempting removal, then
-- RE-CREATE them after the DELETE:
--   DROP TRIGGER IF EXISTS revenue_split_rule_append_only ON public.revenue_split_rule;
--   DROP TRIGGER IF EXISTS revenue_split_rule_no_truncate ON public.revenue_split_rule;
-- After the DELETE, re-create:
--   CREATE TRIGGER revenue_split_rule_append_only
--     BEFORE UPDATE OR DELETE ON public.revenue_split_rule
--     FOR EACH ROW EXECUTE FUNCTION public.revenue_split_rule_guard();
--   CREATE TRIGGER revenue_split_rule_no_truncate
--     BEFORE TRUNCATE ON public.revenue_split_rule
--     FOR EACH STATEMENT EXECUTE FUNCTION public.revenue_split_rule_truncate_guard();
--
-- DELETE FROM public.user_jurisdictions WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a';
-- DELETE FROM public.revenue_split_rule  WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'; -- requires trigger drop above
-- DELETE FROM public.tariffs             WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a'; -- see FK warning above
-- DELETE FROM public.jurisdiction_mode_config WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000444a';
-- DELETE FROM public.geofences           WHERE ref LIKE 'djibouti-%';
-- DELETE FROM public.geofences           WHERE ref LIKE 'somaliland-%'; -- re-seed from Go constants
-- DELETE FROM public.jurisdictions       WHERE id = '00000000-0000-4000-8000-00000000444a'; -- see FK warning above
-- DROP TABLE IF EXISTS public.geofences;
