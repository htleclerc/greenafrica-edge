-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 035 : pgmq pop/ack/enqueue RPCs + proforma-worker cron
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Exposes three thin SECURITY DEFINER wrappers on top of pgmq so the Next.js
-- queue worker (service_role) can pop/ack messages without being granted direct
-- access to the pgmq schema's internals. Also schedules the `proforma-worker`
-- pg_cron job that POSTs into /api/queue/process-proforma every minute via
-- pg_net, using worker URL + shared secret stored in app_config.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pgmq_pop_message(queue_name TEXT, visibility_sec INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN SELECT * FROM pgmq.read(queue_name, visibility_sec, 1)
  LOOP
    RETURN jsonb_build_object(
      'msg_id',      v_row.msg_id,
      'read_ct',     v_row.read_ct,
      'enqueued_at', v_row.enqueued_at,
      'message',     v_row.message
    );
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.pgmq_ack_message(queue_name TEXT, msg_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pgmq.archive(queue_name, msg_id);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.pgmq_enqueue_proforma(alert_id UUID)
RETURNS BIGINT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pgmq.send('proforma_queue', jsonb_build_object('arrival_alert_id', alert_id::text))
$$;

GRANT EXECUTE ON FUNCTION public.pgmq_pop_message(TEXT, INT)    TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_ack_message(TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pgmq_enqueue_proforma(UUID)    TO service_role;

-- ── Worker config keys (URL + secret) live in app_config for rotation ──────
INSERT INTO public.app_config (key, value, description) VALUES
  ('queue.worker_url',    '"http://host.docker.internal:3300"'::jsonb,
   'Base URL of the Next.js app (as reachable from the PG container). Include protocol + host + port.'),
  ('queue.worker_secret', '""'::jsonb,
   'Shared secret for X-Queue-Secret header. Rotate via UPDATE app_config WHERE key=''queue.worker_secret''.')
ON CONFLICT (key) DO NOTHING;

-- ── Schedule: hit the worker every minute ──────────────────────────────────
SELECT cron.schedule(
  'proforma-worker',
  '* * * * *',
  $worker$
  SELECT net.http_post(
    url := (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_url')
           || '/api/queue/process-proforma',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Queue-Secret', (SELECT (value #>> '{}') FROM public.app_config WHERE key='queue.worker_secret')
    ),
    body := '{}'::jsonb
  );
  $worker$
);

COMMENT ON FUNCTION public.pgmq_pop_message IS
  'Pop one message from the queue with a visibility timeout. Used by the Next.js queue worker route.';
COMMENT ON FUNCTION public.pgmq_ack_message IS
  'Archive (ack) a pgmq message by msg_id after successful processing.';
COMMENT ON FUNCTION public.pgmq_enqueue_proforma IS
  'Enqueue a pro-forma job for the given arrival_alert. Used by the claim flow server action.';
