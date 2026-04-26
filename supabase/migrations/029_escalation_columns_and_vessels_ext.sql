-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 029 : owner escalation columns + dormant detention columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.transactions
  ADD COLUMN owner_escalation_due_at  TIMESTAMPTZ,  -- staged by daily cron (eligible since)
  ADD COLUMN escalated_to_owner_at    TIMESTAMPTZ,  -- actual send timestamp
  ADD COLUMN escalated_to_owner_email TEXT,
  ADD COLUMN escalated_by             UUID REFERENCES public.profiles(id);

CREATE INDEX idx_txn_unpaid_escalation_due
  ON public.transactions(status, document_type, owner_escalation_due_at)
  WHERE status = 'PENDING' AND escalated_to_owner_at IS NULL;

COMMENT ON COLUMN public.transactions.owner_escalation_due_at IS
  'Set by pg_cron unpaid-escalation: marks pro-forma as eligible for owner cascade. NULL = not yet eligible.';
COMMENT ON COLUMN public.transactions.escalated_to_owner_at IS
  'Set by Port Officer action: actual timestamp the owner cascade email was sent.';

-- Vessels: dormant detention columns (feature-flagged post-MVP)
ALTER TABLE public.vessels
  ADD COLUMN detain_on_next_call BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN detain_reason       TEXT,
  ADD COLUMN detain_set_by       UUID REFERENCES public.profiles(id),
  ADD COLUMN detain_set_at       TIMESTAMPTZ;

CREATE INDEX idx_vessels_detain_flag
  ON public.vessels(detain_on_next_call)
  WHERE detain_on_next_call = TRUE;
