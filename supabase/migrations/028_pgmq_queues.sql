-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 028 : pgmq queues for proforma + reconciliation + scrape
-- ─────────────────────────────────────────────────────────────────────────────

-- proforma_queue     payload: { arrival_alert_id: UUID }
-- reconciliation_queue payload: { arrival_alert_id: UUID }
-- scrape_queue       payload: { imo: TEXT, priority: INT }  (Phase 2)

SELECT pgmq.create('proforma_queue');
SELECT pgmq.create('reconciliation_queue');
SELECT pgmq.create('scrape_queue');

-- Grant service_role to read/write (adjust to your RLS model if different)
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA pgmq TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pgmq TO service_role;

COMMENT ON TABLE pgmq.q_proforma_queue IS
  'Pro-forma generation jobs. Consumed by Next.js /api/queue/process-proforma.';
COMMENT ON TABLE pgmq.q_reconciliation_queue IS
  'Reconciliation jobs triggered on EEZ exit. Consumed by /api/queue/process-reconcile.';
COMMENT ON TABLE pgmq.q_scrape_queue IS
  'Phase 2: EQUASIS scrape tasks.';
