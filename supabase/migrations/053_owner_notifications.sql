-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 053: Owner notifications (in-app bell + email tracking)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.owner_notification_kind AS ENUM (
  'KYC_APPROVED', 'KYC_REJECTED', 'KYC_C_REQUIRED',
  'ALERT_DETECTED', 'PROFORMA_ISSUED', 'PROFORMA_REMINDER',
  'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
  'FINAL_ISSUED', 'COMPLEMENT_ISSUED', 'REFUND_ISSUED',
  'WALLET_TOPPED_UP', 'WALLET_APPLIED', 'WALLET_LOW_BALANCE',
  'DISPUTE_UPDATED', 'OWNER_ESCALATION'
);

CREATE TABLE public.owner_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  kind            public.owner_notification_kind NOT NULL,
  title_key       TEXT NOT NULL,
  body_key        TEXT NOT NULL,
  body_params     JSONB NOT NULL DEFAULT '{}'::jsonb,
  deep_link       TEXT,
  read_at         TIMESTAMPTZ,
  emailed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_owner_unread
  ON public.owner_notifications(shipowner_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX idx_notif_owner_created
  ON public.owner_notifications(shipowner_id, created_at DESC);

ALTER TABLE public.owner_notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.owner_notifications IS
  'Plan 7 v1: in-app notifications for shipowners. emailed_at tracks Resend delivery.';

-- DOWN:
-- DROP TABLE public.owner_notifications;
-- DROP TYPE public.owner_notification_kind;
