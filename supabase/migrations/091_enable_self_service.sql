-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 091: Open public operator self-service signup (maritime + air)
--
-- Activates the two self-service flags so /signup renders the operator
-- registration form (RegisterModeSwitcher) for both maritime shipowners
-- and air operators. Idempotent via ON CONFLICT DO UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.app_config (key, value)
VALUES
  ('feature.shipowner_self_service_enabled', 'true'::jsonb),
  ('feature.air_self_service_enabled',       'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- DOWN: UPDATE public.app_config SET value = 'false'::jsonb
--         WHERE key IN ('feature.shipowner_self_service_enabled', 'feature.air_self_service_enabled');
