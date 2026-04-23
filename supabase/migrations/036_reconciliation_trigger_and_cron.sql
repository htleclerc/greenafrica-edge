-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 036 : reconciliation trigger + reconciliation-worker cron
-- ─────────────────────────────────────────────────────────────────────────────
--
-- When an arrival_alert transitions to DEPARTED_EEZ, enqueue a pgmq message on
-- reconciliation_queue so the Next.js worker can compute real distance and
-- issue the FINAL / COMPLEMENT / REFUND transaction.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_enqueue_reconciliation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only fire when status actually transitions INTO DEPARTED_EEZ.
  IF NEW.status = 'DEPARTED_EEZ'
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM pgmq.send('reconciliation_queue',
      jsonb_build_object('arrival_alert_id', NEW.id::text));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enqueue_reconciliation_on_departed
  AFTER UPDATE ON public.arrival_alerts
  FOR EACH ROW
  WHEN (NEW.status = 'DEPARTED_EEZ' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_enqueue_reconciliation();

COMMENT ON FUNCTION public.fn_enqueue_reconciliation IS
  'Enqueue a reconciliation job when arrival_alert.status transitions to DEPARTED_EEZ. Idempotent by construction (guarded by OLD.status IS DISTINCT).';

-- ── Schedule: hit the reconciliation worker every minute ───────────────────
SELECT cron.schedule(
  'reconciliation-worker',
  '* * * * *',
  $worker$
  SELECT net.http_post(
    url := (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_url')
           || '/api/queue/process-reconciliation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Queue-Secret', (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_secret')
    ),
    body := '{}'::jsonb
  );
  $worker$
);
