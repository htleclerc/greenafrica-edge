-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 039 : Shipowner Portal v0 — schema + RLS gaps (Plan 6 Task 0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Bridges the gaps mig 033 left for the SHIPOWNER role:
--   1. vessels SELECT — mig 033 only covered arrival_alerts + transactions
--   2. disputes INSERT — tighten the existing policy so SHIPOWNERs (and
--      SHIPPING_AGENTs) can only file disputes against transactions they own
--   3. shipowners audit columns — invited_at + invited_by for traceability
--   4. shipowner_payment_intents — owner declares "I paid via reference X";
--      FINANCE_ADMIN confirms via existing mark-paid flow
--
-- account_state='ACTIVE' gating is enforced by the invitation callback
-- (Plan 6 Task 2), not in the policies themselves — keeping policies role-
-- and ownership-based makes the SQL easier to reason about, and the
-- callback is the single place that flips account_state.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. vessels SELECT for SHIPOWNER ────────────────────────────────────────
--
-- SHIPOWNER reads only their own vessels (vessels.shipowner_id matches the
-- shipowners row whose profile_id = auth.uid()). Mirrors mig 033's pattern
-- for arrival_alerts.

CREATE POLICY "shipowner reads own vessels"
  ON public.vessels FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipowners s
     WHERE s.id = vessels.shipowner_id
       AND s.profile_id = auth.uid()
  ));

-- ── 2. disputes INSERT — tighten ownership chain ───────────────────────────
--
-- The mig 007 policy `disputes_insert_own` only checks submitted_by = auth.uid().
-- That allows a malicious user to file disputes against transactions they
-- don't own (the row appears as theirs in submitted_by). This tightens the
-- INSERT to require:
--   - submitted_by = auth.uid() (unchanged)
--   - AND the transaction belongs to the user, either as:
--       (a) SHIPPING_AGENT: transactions.agent_profile_id = auth.uid()
--       (b) SHIPOWNER: transactions.shipowner_id = (shipowners where profile_id = auth.uid())
-- Port Officers + Finance Admins go through service_role for admin-side
-- workflows so they bypass this policy entirely.

DROP POLICY IF EXISTS disputes_insert_own ON public.disputes;

CREATE POLICY disputes_insert_own ON public.disputes
  FOR INSERT WITH CHECK (
    submitted_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.transactions t
       WHERE t.id = disputes.transaction_id
         AND (
           t.agent_profile_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.shipowners s
              WHERE s.id = t.shipowner_id
                AND s.profile_id = auth.uid()
           )
         )
    )
  );

-- The existing disputes_select_own policy (mig 007) already covers SHIPOWNER
-- reading their own disputes implicitly via `submitted_by = auth.uid()`.
-- No change needed there.

-- ── 3. shipowners audit columns ────────────────────────────────────────────

ALTER TABLE public.shipowners
  ADD COLUMN invited_at TIMESTAMPTZ,
  ADD COLUMN invited_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.shipowners.invited_at IS
  'When the admin/manager dispatched the magic-link invitation. Set by the inviteShipowner action; null until invitation is sent.';
COMMENT ON COLUMN public.shipowners.invited_by IS
  'profiles.id of the admin/manager who sent the invitation. Audit trail for portal access grants.';

-- ── 4. shipowner_payment_intents ──────────────────────────────────────────
--
-- Owner-declared payments. Lifecycle:
--   DECLARED  — owner posted via /owner/invoices "Pay" dialog
--   CONFIRMED — FINANCE_ADMIN matched the bank transfer, called mark-paid
--   REJECTED  — FINANCE_ADMIN couldn't match the reference; intent dismissed

CREATE TYPE public.shipowner_payment_intent_status AS ENUM
  ('DECLARED', 'CONFIRMED', 'REJECTED');

CREATE TABLE public.shipowner_payment_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  declared_by       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reference         TEXT NOT NULL,
  amount_usd        NUMERIC NOT NULL CHECK (amount_usd >= 0),
  notes             TEXT,
  status            public.shipowner_payment_intent_status NOT NULL DEFAULT 'DECLARED',
  resolved_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT,
  declared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_intents_txn    ON public.shipowner_payment_intents(transaction_id);
CREATE INDEX idx_payment_intents_status ON public.shipowner_payment_intents(status);
CREATE INDEX idx_payment_intents_declared_by ON public.shipowner_payment_intents(declared_by);

CREATE TRIGGER shipowner_payment_intents_updated_at
  BEFORE UPDATE ON public.shipowner_payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TABLE public.shipowner_payment_intents IS
  'Owner-declared payment intents. Bridge between /owner/invoices Pay button and FINANCE_ADMIN mark-paid workflow. Reference is typically a bank transfer ID; FINANCE_ADMIN reconciles and confirms.';

-- RLS on shipowner_payment_intents
ALTER TABLE public.shipowner_payment_intents ENABLE ROW LEVEL SECURITY;

-- SHIPOWNER reads their own intents
CREATE POLICY "shipowner reads own payment intents"
  ON public.shipowner_payment_intents FOR SELECT
  USING (declared_by = auth.uid());

-- FINANCE_ADMIN, PORT_OFFICER, SUPERADMIN read all intents (cashier desk)
CREATE POLICY "finance reads all payment intents"
  ON public.shipowner_payment_intents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND role IN ('FINANCE_ADMIN', 'PORT_OFFICER', 'SUPERADMIN')
  ));

-- SHIPOWNER inserts intents only for their own transactions
CREATE POLICY "shipowner declares own payment intent"
  ON public.shipowner_payment_intents FOR INSERT
  WITH CHECK (
    declared_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.transactions t
        JOIN public.shipowners s ON s.id = t.shipowner_id
       WHERE t.id = shipowner_payment_intents.transaction_id
         AND s.profile_id = auth.uid()
    )
  );

-- FINANCE_ADMIN / SUPERADMIN updates intents (resolves DECLARED → CONFIRMED|REJECTED)
CREATE POLICY "finance resolves payment intents"
  ON public.shipowner_payment_intents FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- ── DOWN ────────────────────────────────────────────────────────────────────
-- Reversal block (commented — Supabase CLI doesn't auto-run; documented for
-- manual rollback during dev).
--
-- DROP TABLE IF EXISTS public.shipowner_payment_intents CASCADE;
-- DROP TYPE IF EXISTS public.shipowner_payment_intent_status;
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS invited_at;
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS invited_by;
-- DROP POLICY IF EXISTS disputes_insert_own ON public.disputes;
-- CREATE POLICY disputes_insert_own ON public.disputes
--   FOR INSERT WITH CHECK (submitted_by = auth.uid()); -- restore mig 007
-- DROP POLICY IF EXISTS "shipowner reads own vessels" ON public.vessels;
