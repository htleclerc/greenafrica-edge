BEGIN;

DO $$ BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='pgmq_pop_message'
  ), 'pgmq_pop_message RPC missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='pgmq_ack_message'
  ), 'pgmq_ack_message RPC missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='pgmq_enqueue_proforma'
  ), 'pgmq_enqueue_proforma RPC missing';
  ASSERT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='proforma-worker'
  ), 'pg_cron job proforma-worker missing';
END $$;

-- Round-trip: send via enqueue, pop it, verify shape, ack it
DO $$
DECLARE
  v_alert UUID := gen_random_uuid();
  v_id BIGINT;
  v_popped JSONB;
BEGIN
  v_id := public.pgmq_enqueue_proforma(v_alert);
  ASSERT v_id > 0, 'enqueue returned invalid msg_id';

  SELECT public.pgmq_pop_message('proforma_queue', 30) INTO v_popped;
  ASSERT v_popped IS NOT NULL, 'pop returned null';
  ASSERT (v_popped->>'msg_id')::bigint = v_id,
    format('wrong msg_id: got %s want %s', v_popped->>'msg_id', v_id);
  ASSERT (v_popped->'message'->>'arrival_alert_id') = v_alert::text,
    'payload arrival_alert_id missing or wrong';

  PERFORM public.pgmq_ack_message('proforma_queue', v_id);
END $$;

ROLLBACK;
