-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023 : arrival_alerts (state machine root for detection → reconcile)
-- + pgmq + pg_cron extensions (shared by all plan-1 migrations)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- (arrival_alerts DDL added in Task 2)
