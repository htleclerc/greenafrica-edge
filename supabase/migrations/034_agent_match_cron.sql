-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 034 : agent-match cron + pg_net (outbound HTTP from PG)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- pg_net lets PG call HTTP endpoints; used by the pgmq consumer cron to POST
-- into the Next.js /api/queue/process-proforma route.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── match_pending_alerts: runs the cascade A lookup for DETECTED alerts ─────
CREATE OR REPLACE FUNCTION public.match_pending_alerts()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_matched INT := 0;
  v_alert RECORD;
  v_agent UUID;
BEGIN
  FOR v_alert IN
    SELECT a.id, v.shipowner_id
      FROM public.arrival_alerts a
      JOIN public.vessels v ON v.id = a.vessel_id
     WHERE a.status = 'DETECTED'
  LOOP
    -- Cascade A lookup
    IF v_alert.shipowner_id IS NULL THEN
      UPDATE public.arrival_alerts SET status = 'UNCLAIMED' WHERE id = v_alert.id;
      CONTINUE;
    END IF;

    SELECT agent_profile_id INTO v_agent
      FROM public.owner_agent_mappings
     WHERE shipowner_id = v_alert.shipowner_id
       AND active = TRUE
       AND valid_from <= CURRENT_DATE
       AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
     ORDER BY priority ASC
     LIMIT 1;

    IF v_agent IS NULL THEN
      UPDATE public.arrival_alerts SET status = 'UNCLAIMED' WHERE id = v_alert.id;
    ELSE
      UPDATE public.arrival_alerts
         SET status           = 'MATCHED_AUTO',
             matched_agent_id = v_agent,
             matched_via      = 'AUTO_MAPPING'
       WHERE id = v_alert.id;

      PERFORM pgmq.send('proforma_queue',
        jsonb_build_object('arrival_alert_id', v_alert.id::text));
      v_matched := v_matched + 1;
    END IF;
  END LOOP;

  RETURN v_matched;
END;
$$;

-- ── Schedule: every 2 minutes ──────────────────────────────────────────────
SELECT cron.schedule(
  'agent-match',
  '*/2 * * * *',
  $$SELECT public.match_pending_alerts();$$
);

COMMENT ON FUNCTION public.match_pending_alerts IS
  'Run cascade A for DETECTED arrival_alerts. Transitions to MATCHED_AUTO + enqueues pgmq.proforma_queue, or UNCLAIMED when no mapping exists.';
