BEGIN;

DO $$
DECLARE required_keys TEXT[] := ARRAY[
  'carbon_tax.rate_usd_per_tco2',
  'arrival.corridor_radius_nm',
  'arrival.cancel_corridor_timeout_h',
  'arrival.claim_sla_hours',
  'arrival.escalation_eta_buffer_h',
  'reconciliation.tolerance_pct',
  'reconciliation.check_interval_min',
  'owner_escalation.delay_days',
  'owner_escalation.reminder_count',
  'proforma.languages_default',
  'proforma.email_cc_admin',
  'feature.ais_global_enabled',
  'feature.equasis_scraper_enabled',
  'feature.vessel_detention_enabled',
  'feature.shipowner_portal_enabled'
];
DECLARE k TEXT;
BEGIN
  FOREACH k IN ARRAY required_keys LOOP
    ASSERT EXISTS (SELECT 1 FROM public.app_config WHERE key = k),
      format('app_config key missing: %s', k);
  END LOOP;

  -- rate is 40
  ASSERT (SELECT value::text FROM public.app_config WHERE key='carbon_tax.rate_usd_per_tco2') = '40',
    'carbon_tax.rate_usd_per_tco2 should default to 40';

  -- owner_escalation.delay_days = 7
  ASSERT (SELECT value::text FROM public.app_config WHERE key='owner_escalation.delay_days') = '7',
    'owner_escalation.delay_days should default to 7';

  -- ais_global_enabled = false (Phase 2 flag)
  ASSERT (SELECT value::text FROM public.app_config WHERE key='feature.ais_global_enabled') = 'false',
    'feature.ais_global_enabled should default to false';
END $$;

ROLLBACK;
