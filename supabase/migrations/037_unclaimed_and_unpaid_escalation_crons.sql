-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 037 : unclaimed-escalation + unpaid-escalation crons
-- ─────────────────────────────────────────────────────────────────────────────

-- ── fn_escalate_unclaimed: UNCLAIMED → ESCALATED after claim_sla_hours ────
CREATE OR REPLACE FUNCTION public.fn_escalate_unclaimed()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sla_h   INT;
  v_buf_h   INT;
  v_count   INT := 0;
BEGIN
  SELECT (value #>> '{}')::INT INTO v_sla_h
    FROM public.app_config WHERE key='arrival.claim_sla_hours';
  v_sla_h := COALESCE(v_sla_h, 24);

  SELECT (value #>> '{}')::INT INTO v_buf_h
    FROM public.app_config WHERE key='arrival.escalation_eta_buffer_h';
  v_buf_h := COALESCE(v_buf_h, 36);

  WITH escalated AS (
    UPDATE public.arrival_alerts
       SET status = 'ESCALATED'
     WHERE status = 'UNCLAIMED'
       AND detected_at < NOW() - (v_sla_h || ' hours')::INTERVAL
       AND (estimated_eta IS NULL OR estimated_eta < NOW() + (v_buf_h || ' hours')::INTERVAL)
     RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM escalated;
  RETURN v_count;
END;
$$;

-- ── fn_stage_unpaid_owner_escalation: stage PROFORMA rows eligible for owner cascade
CREATE OR REPLACE FUNCTION public.fn_stage_unpaid_owner_escalation()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_delay_days INT;
  v_count      INT := 0;
BEGIN
  SELECT (value #>> '{}')::INT INTO v_delay_days
    FROM public.app_config WHERE key='owner_escalation.delay_days';
  v_delay_days := COALESCE(v_delay_days, 7);

  WITH staged AS (
    UPDATE public.transactions t
       SET owner_escalation_due_at = NOW()
      FROM public.arrival_alerts a
     WHERE t.arrival_alert_id = a.id
       AND t.document_type = 'PROFORMA'
       AND t.status = 'PENDING'
       AND t.owner_escalation_due_at IS NULL
       AND a.arrived_at IS NOT NULL
       AND a.arrived_at < NOW() - (v_delay_days || ' days')::INTERVAL
     RETURNING t.id
  )
  SELECT COUNT(*) INTO v_count FROM staged;
  RETURN v_count;
END;
$$;

-- ── Schedules ─────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'unclaimed-escalation',
  '0 * * * *', -- hourly
  $$SELECT public.fn_escalate_unclaimed();$$
);

SELECT cron.schedule(
  'unpaid-escalation',
  '0 6 * * *', -- daily at 06:00 UTC
  $$SELECT public.fn_stage_unpaid_owner_escalation();$$
);

COMMENT ON FUNCTION public.fn_escalate_unclaimed IS
  'Transition UNCLAIMED arrival_alerts to ESCALATED when detected_at is older than arrival.claim_sla_hours and (ETA is null or within arrival.escalation_eta_buffer_h).';
COMMENT ON FUNCTION public.fn_stage_unpaid_owner_escalation IS
  'Stage owner_escalation_due_at on unpaid PROFORMA transactions whose alert.arrived_at is older than owner_escalation.delay_days. Sets the eligibility timestamp; actual send is a manual Port Officer action.';
