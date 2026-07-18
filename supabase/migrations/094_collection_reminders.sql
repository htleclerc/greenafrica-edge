-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 094: collection_reminders — relances post-émission J+15/J+30/J+45
--
-- Distinct de collections_event (mig 022) : collections_event est le ledger
-- hash-chaîné NET-30 (échéancier AVANT échéance J+5/J+15/J+25) ; cette table
-- trace le cycle de recouvrement Green-Gate APRÈS émission de la pro-forma
-- (J+15 amicale, J+30 mise en demeure, J+45 notice bailiff CC Eidle Advocats),
-- avec la réponse du débiteur. Spec : docs/onboarding/RECOUVREMENT_AUTOMATIQUE.md.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.reminder_tier AS ENUM ('J15', 'J30', 'J45', 'BAILIFF', 'JUDICIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.debtor_response_type AS ENUM
    ('SILENT', 'ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.collection_reminders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tier                 public.reminder_tier NOT NULL,
  sent_at              TIMESTAMPTZ NOT NULL,
  sent_email           TEXT NOT NULL,
  cc_emails            TEXT[] NOT NULL DEFAULT '{}',
  template_used        TEXT NOT NULL,
  debtor_response_at   TIMESTAMPTZ,
  debtor_response_type public.debtor_response_type NOT NULL DEFAULT 'SILENT',
  escalated_bailiff    BOOLEAN NOT NULL DEFAULT FALSE,
  seed_ref             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creminders_transaction
  ON public.collection_reminders(transaction_id);
CREATE INDEX IF NOT EXISTS idx_creminders_tier ON public.collection_reminders(tier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_seed_ref
  ON public.collection_reminders(seed_ref) WHERE seed_ref IS NOT NULL;
-- Idempotence du futur cron : une seule relance par (transaction, tier)
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_txn_tier
  ON public.collection_reminders(transaction_id, tier);

ALTER TABLE public.collection_reminders ENABLE ROW LEVEL SECURITY;

-- Staff : admins/officers de la juridiction (pattern mig 073/074)
DROP POLICY IF EXISTS "staff manage collection reminders" ON public.collection_reminders;
CREATE POLICY "staff manage collection reminders"
  ON public.collection_reminders FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

-- Débiteur : lecture de ses propres relances via la transaction
DROP POLICY IF EXISTS "shipowners read own reminders" ON public.collection_reminders;
CREATE POLICY "shipowners read own reminders"
  ON public.collection_reminders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      JOIN public.shipowners s ON s.id = t.shipowner_id
      WHERE t.id = collection_reminders.transaction_id
        AND s.profile_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_reminders TO service_role;

-- DOWN:
-- DROP TABLE IF EXISTS public.collection_reminders;
-- DROP TYPE IF EXISTS public.debtor_response_type; DROP TYPE IF EXISTS public.reminder_tier;
