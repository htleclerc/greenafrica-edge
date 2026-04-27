-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 046 — Plan 8: agent-match cron skips ORIGINPORT
--
-- Replaces the function body from migration 034 so alerts produced by the
-- new origin-port detector stay DETECTED (unprocessed) regardless of any
-- cascade match in owner_agent_mappings. Rationale: scenario A has 1-3 weeks
-- lead time; info can change in transit; humans must confirm before pro-forma
-- fires.
--
-- The cron job from 034 already calls match_pending_alerts() — no rebinding
-- needed; only the function body changes.
-- ─────────────────────────────────────────────────────────────────────────────

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
       AND a.detection_source != 'ORIGINPORT' -- [Plan 8: skip ORIGINPORT alerts]
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

COMMENT ON FUNCTION public.match_pending_alerts IS
  'Run cascade A for DETECTED arrival_alerts, skipping ORIGINPORT alerts (Plan 8). '
  'Transitions to MATCHED_AUTO + enqueues pgmq.proforma_queue, or UNCLAIMED when no mapping exists. '
  'ORIGINPORT alerts are skipped entirely and remain DETECTED for human review.';
