-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 065: Proforma reminders cron (Plan 7F)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Daily pg_cron job scans PROFORMA transactions PENDING age=3 days or 7 days
-- and INSERTs a PROFORMA_REMINDER notification. Idempotent: the per-day
-- bucket prevents double-reminders if the job re-runs.

-- 1. SQL function
CREATE OR REPLACE FUNCTION public.enqueue_proforma_reminders() RETURNS INT AS $$
DECLARE
  rec RECORD;
  inserted_count INT := 0;
  age_days INT;
BEGIN
  FOR rec IN
    SELECT
      t.id, t.shipowner_id, t.invoice_ref, t.tax_amount_usd, t.vessel_name,
      t.created_at,
      EXTRACT(DAY FROM (NOW() - t.created_at))::INT AS age_days
    FROM public.transactions t
    WHERE t.document_type = 'PROFORMA'
      AND t.status = 'PENDING'
      AND t.shipowner_id IS NOT NULL
      AND EXTRACT(DAY FROM (NOW() - t.created_at))::INT IN (3, 7)
  LOOP
    age_days := rec.age_days;

    -- Idempotency: skip if a reminder already exists for this transaction
    -- at this age-bucket
    IF NOT EXISTS (
      SELECT 1 FROM public.owner_notifications
      WHERE kind = 'PROFORMA_REMINDER'
        AND shipowner_id = rec.shipowner_id
        AND (body_params->>'transaction_id')::UUID = rec.id
        AND (body_params->>'age_days')::INT = age_days
    ) THEN
      INSERT INTO public.owner_notifications
        (shipowner_id, kind, title_key, body_key, body_params, deep_link)
      VALUES
        (rec.shipowner_id,
         'PROFORMA_REMINDER',
         'OwnerPortal.notifications.kind.PROFORMA_REMINDER.title',
         'OwnerPortal.notifications.kind.PROFORMA_REMINDER.body',
         jsonb_build_object(
           'transaction_id', rec.id,
           'invoice_ref', rec.invoice_ref,
           'amount_usd', rec.tax_amount_usd,
           'vessel_name', rec.vessel_name,
           'age_days', age_days
         ),
         '/owner/invoices?focus=' || rec.id);

      inserted_count := inserted_count + 1;
    END IF;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.enqueue_proforma_reminders() IS
  'Plan 7F: scan PROFORMA transactions PENDING aged 3 or 7 days; INSERT PROFORMA_REMINDER notif (idempotent per transaction × age_days). Returns count of insertions.';

-- 2. pg_cron daily job at 08:00 UTC
SELECT cron.schedule(
  'proforma-reminders-daily',
  '0 8 * * *',
  $cron$ SELECT public.enqueue_proforma_reminders(); $cron$
);
