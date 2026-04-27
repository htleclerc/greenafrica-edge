-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 045 — Plan 8: origin port allow-list seed
--
-- Curated AIS-5 Destination variants per port. Read by the Go matcher;
-- enriched by the admin UI when approving fuzzy proposals. Idempotent via
-- ON CONFLICT DO NOTHING because hosted environments may have the key
-- already (manual injection during staging, etc).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value, description) VALUES
  ('arrival.origin_port_allow_list',
   '{
     "BERBERA": ["BERBERA","BBR","BERBA","BERBARA","SBE","SOMA BBR","SOMALILAND BERBERA"],
     "ZEILA":   ["ZEILA","ZEYLA","ZELA"]
    }'::jsonb,
   'Allow-list of AIS-5 Destination variants per port. Edited via /admin/tax-settings. Values UPPERCASE, no punctuation. Approving a fuzzy proposal auto-merges its normalized variant into this list.')
ON CONFLICT (key) DO NOTHING;
