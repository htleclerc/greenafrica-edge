-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 106 : ACTIVATION des purges de rétention (RGPD Art. 5(1)(e))
--
-- Durées de rétention VALIDÉES par le PO le 2026-07-21 : 90 jours.
-- Active les fonctions de purge livrées désactivées en mig 102, en suppression
-- réelle (p_dry_run=false), planifiées hebdomadairement (dimanche 03:00).
-- Ne concernent QUE des données opérationnelles/transitoires (AIS/ADS-B,
-- notifications) — aucune donnée fiscale/immuable (transactions/audit_logs
-- restent hors purge automatique).
--
-- Inspection à blanc à tout moment (compte sans supprimer) :
--   select public.rgpd_purge_arrival_alerts(90, true);
--   select public.rgpd_purge_owner_notifications(90, true);
-- Désactivation :
--   select cron.unschedule('rgpd-purge-arrival-alerts');
--   select cron.unschedule('rgpd-purge-owner-notifications');
--
-- cron.schedule(nom,…) fait un upsert par nom → migration idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'rgpd-purge-arrival-alerts',
  '0 3 * * 0',
  $$SELECT public.rgpd_purge_arrival_alerts(90, false);$$
);

SELECT cron.schedule(
  'rgpd-purge-owner-notifications',
  '0 3 * * 0',
  $$SELECT public.rgpd_purge_owner_notifications(90, false);$$
);

-- DOWN:
-- SELECT cron.unschedule('rgpd-purge-arrival-alerts');
-- SELECT cron.unschedule('rgpd-purge-owner-notifications');
