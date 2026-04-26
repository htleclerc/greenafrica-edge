-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023 : arrival_alerts (state machine root for detection → reconcile)
-- + pgmq + pg_cron extensions (shared by all plan-1 migrations)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Enum: arrival_alert_status ─────────────────────────────────────────────
CREATE TYPE public.arrival_alert_status AS ENUM (
  'DETECTED',       -- Go backend emitted the alert
  'MATCHED_AUTO',   -- cascade A matched a local agent
  'UNCLAIMED',      -- cascade B awaiting portal claim
  'CLAIMED',        -- an agent clicked Claim
  'ESCALATED',      -- cascade C: Port Officer manual
  'PROFORMA_SENT',  -- pro-forma emailed to agent
  'ARRIVED',        -- vessel entered EEZ
  'DEPARTED_EEZ',   -- vessel left EEZ (awaiting reconcile)
  'RECONCILED',     -- final/complement/refund issued
  'CANCELLED'       -- false positive, rerouted, IMO missing, etc.
);

-- ── Table: arrival_alerts ──────────────────────────────────────────────────
CREATE TABLE public.arrival_alerts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id               UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  imo_number              TEXT NOT NULL,
  detected_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  detected_lat            NUMERIC(9, 6) NOT NULL,
  detected_lng            NUMERIC(9, 6) NOT NULL,
  distance_to_port_nm     NUMERIC(10, 2) NOT NULL,
  estimated_eta           TIMESTAMPTZ,
  estimated_route_nm      NUMERIC(10, 2),
  status                  public.arrival_alert_status NOT NULL DEFAULT 'DETECTED',
  matched_agent_id        UUID REFERENCES public.profiles(id),
  matched_via             TEXT CHECK (matched_via IN ('AUTO_MAPPING','CLAIM','PORT_OFFICER')),
  proforma_transaction_id UUID,  -- FK added in migration 026 after transactions is extended
  final_transaction_id    UUID,
  arrived_at              TIMESTAMPTZ,
  departed_eez_at         TIMESTAMPTZ,
  cancelled_reason        TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_status_open
  ON public.arrival_alerts(status)
  WHERE status NOT IN ('RECONCILED', 'CANCELLED');

CREATE INDEX idx_alert_vessel_detected
  ON public.arrival_alerts(vessel_id, detected_at DESC);

CREATE UNIQUE INDEX idx_alert_active_per_vessel
  ON public.arrival_alerts(vessel_id)
  WHERE status NOT IN ('RECONCILED', 'CANCELLED');

CREATE TRIGGER arrival_alerts_updated_at
  BEFORE UPDATE ON public.arrival_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
