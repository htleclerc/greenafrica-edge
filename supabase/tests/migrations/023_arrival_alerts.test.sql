-- 023: extensions & arrival_alerts schema
BEGIN;
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgmq'),
    'pgmq extension not enabled';
  ASSERT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron'),
    'pg_cron extension not enabled';
END $$;
ROLLBACK;
