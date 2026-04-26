BEGIN;

-- Verify queues exist (pgmq stores metadata in pgmq.meta)
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name='proforma_queue'),
    'proforma_queue not created';
  ASSERT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name='reconciliation_queue'),
    'reconciliation_queue not created';
  ASSERT EXISTS (SELECT 1 FROM pgmq.meta WHERE queue_name='scrape_queue'),
    'scrape_queue not created';
END $$;

-- Round-trip: send and peek on proforma_queue
DO $$
DECLARE v_msg_id BIGINT;
BEGIN
  v_msg_id := pgmq.send('proforma_queue', '{"arrival_alert_id":"00000000-0000-0000-0000-000000000001"}'::jsonb);
  ASSERT v_msg_id IS NOT NULL AND v_msg_id > 0,
    'pgmq.send did not return a valid msg_id';

  ASSERT EXISTS (
    SELECT 1 FROM pgmq.q_proforma_queue WHERE msg_id = v_msg_id
  ), 'message not found in pgmq.q_proforma_queue';
END $$;

ROLLBACK;
