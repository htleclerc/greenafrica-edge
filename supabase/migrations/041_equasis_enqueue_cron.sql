-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 041 : Equasis enqueue cron (Plan 7 Task 3)
-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron job that finds vessels needing owner-email discovery and enqueues
-- their IMOs into pgmq.scrape_queue. The Go scraper worker then picks them up.
--
-- Triggers (idempotent):
--   - vessel has an arrival_alert in UNCLAIMED past SLA, AND
--   - the vessel has no shipowner OR the shipowner has no official_email, AND
--   - no pending pgmq message exists for this IMO, AND
--   - no unreviewed proposal exists for this IMO in the last 24h
--
-- Feature flag: feature.equasis_scraper_enabled. When OFF the cron runs but
-- no-ops at the first SELECT — zero side effects.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.equasis_enqueue_pending()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled BOOLEAN;
  v_imo     TEXT;
  v_count   INT := 0;
  v_cutoff  TIMESTAMPTZ := NOW() - INTERVAL '24 hours';
BEGIN
  SELECT (value #>> '{}')::boolean INTO v_enabled
    FROM public.app_config WHERE key = 'feature.equasis_scraper_enabled';
  IF NOT COALESCE(v_enabled, FALSE) THEN
    RETURN 0;
  END IF;

  -- Walk vessels in UNCLAIMED-past-SLA alerts that lack owner email.
  FOR v_imo IN
    SELECT DISTINCT v.imo_number
      FROM public.vessels v
      JOIN public.arrival_alerts a ON a.vessel_id = v.id
      LEFT JOIN public.shipowners s ON s.id = v.shipowner_id
     WHERE a.status = 'UNCLAIMED'
       AND v.imo_number IS NOT NULL
       AND v.imo_number <> ''
       AND (v.shipowner_id IS NULL OR s.official_email IS NULL)
       -- Skip if there's already an unreviewed recent proposal
       AND NOT EXISTS (
         SELECT 1 FROM public.equasis_scrape_proposals p
          WHERE p.imo_number = v.imo_number
            AND p.reviewed_at IS NULL
            AND p.scraped_at > v_cutoff
       )
       -- Skip if there's already a pending pgmq message.
       -- pgmq.q_<queue> exposes msg_id + message; vt > now() means "in flight".
       AND NOT EXISTS (
         SELECT 1 FROM pgmq.q_scrape_queue q
          WHERE (q.message #>> '{imo}') = v.imo_number
       )
  LOOP
    PERFORM pgmq.send('scrape_queue', jsonb_build_object('imo', v_imo, 'priority', 100));
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.equasis_enqueue_pending() TO service_role;

COMMENT ON FUNCTION public.equasis_enqueue_pending IS
  'Plan 7 Task 3 — fills pgmq.scrape_queue with IMOs of UNCLAIMED-past-SLA vessels lacking owner email. Idempotent and gated by feature.equasis_scraper_enabled. Returns count enqueued.';

-- Schedule every 30 minutes
SELECT cron.schedule(
  'equasis-enqueue',
  '*/30 * * * *',
  $cron$ SELECT public.equasis_enqueue_pending(); $cron$
);
