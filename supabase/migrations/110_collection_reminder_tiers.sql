-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 110: paliers de relance précoces + CC huissier + bascule cron
--
-- B1 (moteur de relance). Étend reminder_tier (mig 094) avec les rappels
-- courtois J3/J7 pour que TOUTE relance figure dans le registre collection_reminders.
-- Ajoute le CC cabinet huissier par juridiction (table privée mig 109). Désactive
-- le pg_cron 065 : remplacé par la route TS /api/cron/collection-reminders, qui
-- réutilise la cascade destinataire TS (resolveInvoiceRecipients) au lieu de la
-- dupliquer en plpgsql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ALTER TYPE ... ADD VALUE ne peut pas cohabiter avec un usage de la valeur dans
-- la même transaction ; ces ajouts sont donc en tête, isolés.
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'J3' BEFORE 'J15';
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'J7' BEFORE 'J15';

ALTER TABLE public.jurisdiction_billing_cc
  ADD COLUMN IF NOT EXISTS bailiff_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.jurisdiction_billing_cc.bailiff_cc_emails IS
  'Cabinet huissier en copie des relances à partir de J45. Voir collectionReminderService.';

-- Désactive l'ancien enqueueur pg_cron (Plan 7F mig 065). Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proforma-reminders-daily') THEN
    PERFORM cron.unschedule('proforma-reminders-daily');
  END IF;
END $$;

-- DOWN:
-- SELECT cron.schedule('proforma-reminders-daily','0 8 * * *',$c$ SELECT public.enqueue_proforma_reminders(); $c$);
-- ALTER TABLE public.jurisdiction_billing_cc DROP COLUMN IF EXISTS bailiff_cc_emails;
-- -- NB: on ne retire pas J3/J7 de l'enum (Postgres ne supporte pas DROP VALUE).
