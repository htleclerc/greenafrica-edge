-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 022 : NET-30 collections state machine
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Replaces the per-call PSP payment model with a NET-30 credit line:
--   - Armateurs have a `credit_limit_usd` on their profile.
--   - Each invoice (transaction) has a `due_date` = issued_at + 30 days
--     (Africa/Mogadishu timezone — cutoff at 23:59 local).
--   - Cron daily: scans transactions by `due_date` vs now, emits emails and
--     transitions a `collections_status` state machine.
--   - J+30 without payment → profile.eez_suspended=true (leverage).
--
-- Changes
-- ───────
-- 1. profiles: add credit_limit_usd, eez_suspended, eez_suspended_at
-- 2. transactions: add due_date (GENERATED), partial_paid_usd, collections_status,
--    debtor_profile_id (FK → profiles, backfilled from vessel.owner_id),
--    settlement_effective_at
-- 2b. dispute_intervals: canonical dispute history table + fn_dispute_pause_days
-- 3. collections_event: append-only ledger of state transitions + emails sent
-- 4. profile_credit_usage: view exposing residual credit per armateur
-- 4b. orphan_transactions: triage view for rows with NULL debtor_profile_id
-- 5. Backfill collections_status for existing transactions
-- 6. DB trigger: enforce `status='PAID' ⇔ collections_status='PAID'` invariant
--    so two sources of truth cannot drift (OV4 from eng review)
--
-- Design notes (from eng review + outside voice, PR-2)
-- ───────────
-- - `settlement_effective_at` (OV1) is distinct from `paid_at`: it's when the
--   invoice is legally considered settled for MoECC reporting (may differ if
--   counsel rules that settlement requires dispute-window expiry).
-- - `collections_event.supersedes_event_id` (OV10) allows admin-error revocation
--   without violating append-only: a new event with a back-reference negates the
--   earlier one. Hash-chain stays intact.
-- - No Polygon anchor columns here (eng review 3A: drop on-chain V1, use local
--   hash-chain like audit_logs migration 018).
-- - RLS policies on transactions stay as-is (migration 004). debtor_profile_id
--   added for scoping armateur UI + the credit usage view.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. profiles — credit limit + EEZ suspension ─────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS credit_limit_usd   NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (credit_limit_usd >= 0),
    ADD COLUMN IF NOT EXISTS eez_suspended      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS eez_suspended_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_eez_suspended ON public.profiles(eez_suspended)
    WHERE eez_suspended = TRUE;

-- ── 2. transactions — NET-30 scaffolding ────────────────────────────────────
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS due_date             TIMESTAMPTZ
        GENERATED ALWAYS AS (
            -- J+30 end-of-day cutoff in Africa/Mogadishu (UTC+3, no DST).
            -- Floor created_at to Mogadishu-local midnight, advance 31 days,
            -- step back 1µs → 23:59:59.999999 on day J+30 local.
            (
                date_trunc('day', (created_at AT TIME ZONE 'Africa/Mogadishu'))
                + INTERVAL '31 days'
                - INTERVAL '1 microsecond'
            ) AT TIME ZONE 'Africa/Mogadishu'
        ) STORED,
    ADD COLUMN IF NOT EXISTS partial_paid_usd     NUMERIC(14,2) NOT NULL DEFAULT 0
        CHECK (partial_paid_usd >= 0 AND partial_paid_usd <= tax_amount_usd),
    -- collections_status: 8 canonical states. "Which reminders fired" lives in
    -- collections_event, not here — DRY, single source of truth per fact.
    ADD COLUMN IF NOT EXISTS collections_status   TEXT NOT NULL DEFAULT 'CURRENT'
        CHECK (collections_status IN (
            'CURRENT',       -- issued, more than 5 days until due_date
            'DUE_SOON',      -- within 5 days of due_date, pre-due
            'OVERDUE',       -- past due_date
            'SUSPENDED',     -- EEZ suspended (armateur-level lever active)
            'ESCALATED',     -- handed to collections agency
            'DISPUTED',      -- dispute open, clock paused (see dispute_intervals)
            'PAID',          -- settled (see settlement_effective_at)
            'WAIVED'         -- dispute resolved in armateur's favor
        )),
    ADD COLUMN IF NOT EXISTS debtor_profile_id    UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS settlement_effective_at TIMESTAMPTZ;
-- NOTE on disputes: `disputed_at` / `dispute_resumed_at` / `dispute_pause_days`
-- scalars were considered but rejected. Scalars can silently drift from reality
-- and can't represent repeat-dispute history. Source of truth is the new
-- `dispute_intervals` table below; pause days are derived via fn_dispute_pause_days.

-- Backfill debtor_profile_id from vessel.owner_id (nullable — some tx are
-- ghost/system).
UPDATE public.transactions t
SET debtor_profile_id = v.owner_id
FROM public.vessels v
WHERE t.vessel_id = v.id
  AND t.debtor_profile_id IS NULL
  AND v.owner_id IS NOT NULL;

-- Backfill collections_status for existing rows based on current `status`:
--   PAID → PAID (also set settlement_effective_at = paid_at)
--   EXEMPT → WAIVED (keeps "no money owed" semantics)
--   DISPUTED → DISPUTED
--   OVERDUE → OVERDUE
--   PENDING → CURRENT (cron will advance it on next run)
UPDATE public.transactions
SET collections_status = CASE status
        WHEN 'PAID'      THEN 'PAID'
        WHEN 'EXEMPT'    THEN 'WAIVED'
        WHEN 'DISPUTED'  THEN 'DISPUTED'
        WHEN 'OVERDUE'   THEN 'OVERDUE'
        ELSE 'CURRENT'
    END,
    settlement_effective_at = CASE WHEN status = 'PAID' THEN paid_at ELSE NULL END,
    partial_paid_usd        = CASE WHEN status = 'PAID' THEN tax_amount_usd ELSE 0 END
WHERE collections_status = 'CURRENT'
  AND status IN ('PAID','EXEMPT','DISPUTED','OVERDUE','PENDING');

-- Indexes for cron scan + UI queries
CREATE INDEX IF NOT EXISTS idx_txn_debtor_status
    ON public.transactions(debtor_profile_id, collections_status)
    WHERE collections_status NOT IN ('PAID','WAIVED','DISPUTED');

CREATE INDEX IF NOT EXISTS idx_txn_due_date_status
    ON public.transactions(due_date, collections_status)
    WHERE collections_status NOT IN ('PAID','WAIVED','DISPUTED');

-- ── 2b. dispute_intervals — canonical dispute history ───────────────────────
-- Source of truth for dispute timing. `fn_dispute_pause_days(txn_id)` sums
-- closed intervals for the cron's effective_due math. Handles repeat disputes
-- cleanly; admin edits can't silently skew a hidden scalar.
CREATE TABLE IF NOT EXISTS public.dispute_intervals (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    opened_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_by      UUID REFERENCES public.profiles(id),
    closed_at      TIMESTAMPTZ,
    closed_by      UUID REFERENCES public.profiles(id),
    resolution     TEXT CHECK (resolution IN ('VALID','INVALID','WITHDRAWN')),
    note           TEXT,
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
    CHECK ((closed_at IS NULL) = (resolution IS NULL)),
    CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);

-- At most one open dispute per transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_intervals_open_per_txn
    ON public.dispute_intervals(transaction_id)
    WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dispute_intervals_txn
    ON public.dispute_intervals(transaction_id, opened_at DESC);

-- Derived pause days: sum of closed intervals, rounded up to whole days.
-- The cron computes effective_due = due_date + fn_dispute_pause_days(txn_id).
CREATE OR REPLACE FUNCTION public.fn_dispute_pause_days(p_txn_id UUID)
RETURNS INT
LANGUAGE SQL STABLE
AS $$
    SELECT COALESCE(
        CEIL(EXTRACT(EPOCH FROM SUM(closed_at - opened_at)) / 86400)::INT,
        0
    )
    FROM public.dispute_intervals
    WHERE transaction_id = p_txn_id
      AND closed_at IS NOT NULL;
$$;

COMMENT ON FUNCTION public.fn_dispute_pause_days(UUID) IS
    'Cumulative days paused for dispute review on this transaction. '
    'The cron uses this to compute effective_due = due_date + pause_days.';

ALTER TABLE public.dispute_intervals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dispute intervals — armateur sees own"
    ON public.dispute_intervals FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = dispute_intervals.transaction_id
              AND t.debtor_profile_id = auth.uid()
        )
        OR public.get_user_role()::text IN ('PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN','MANAGER')
    );

CREATE POLICY "Dispute intervals — staff opens"
    ON public.dispute_intervals FOR INSERT
    WITH CHECK (
        public.get_user_role()::text IN ('PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN','MANAGER')
    );

-- UPDATE is only for closing an open interval (setting closed_at/by/resolution).
-- The service layer enforces that opened_at, opened_by, transaction_id aren't
-- touched. RLS just checks role.
CREATE POLICY "Dispute intervals — staff closes"
    ON public.dispute_intervals FOR UPDATE
    USING (
        public.get_user_role()::text IN ('PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN','MANAGER')
    )
    WITH CHECK (
        public.get_user_role()::text IN ('PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN','MANAGER')
    );

-- ── 3. collections_event — append-only state transition ledger ──────────────
CREATE TABLE IF NOT EXISTS public.collections_event (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id        UUID NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
    event_type            TEXT NOT NULL CHECK (event_type IN (
        'ISSUED',                  -- invoice created
        'REMINDER_DUE_MINUS_25',   -- first email J+5
        'REMINDER_DUE_MINUS_15',   -- second email J+15
        'REMINDER_DUE_MINUS_5',    -- third email J+25
        'OVERDUE_REACHED',         -- crossed due_date
        'SUSPENDED_OVERDUE_30',    -- EEZ suspended
        'ESCALATED_OVERDUE_60',    -- escalated to agency
        'DISPUTE_OPENED',
        'DISPUTE_RESOLVED_INVALID',-- admin sided with Solide, clock resumes
        'DISPUTE_RESOLVED_VALID',  -- admin sided with armateur, WAIVED
        'PAID_PSP',                -- webhook from PSP
        'PAID_MANUAL',             -- admin marked paid (wire transfer)
        'PARTIAL_PAYMENT',         -- partial_paid_usd incremented
        'REFUND_DUE',              -- overpayment edge case (OV6)
        'RESUMED_MANUAL',          -- admin lifted EEZ suspension manually (OV4)
        'CORRECTION'               -- admin-error correction (see supersedes_event_id)
    )),
    actor_profile_id      UUID REFERENCES public.profiles(id),  -- NULL for cron/system
    actor_role            TEXT,                                  -- 'cron', 'SUPERADMIN', etc.
    amount_usd            NUMERIC(14,2),                         -- NULL for reminders
    note                  TEXT,                                  -- optional free-text
    supersedes_event_id   UUID REFERENCES public.collections_event(id),
    payload_hash          TEXT NOT NULL,                         -- SHA-256 for chain
    prev_event_hash       TEXT,                                  -- hash-chain
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_event_tx
    ON public.collections_event(transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_event_actor
    ON public.collections_event(actor_profile_id, created_at DESC);

-- RLS: read-only for relevant actors, append-only for everyone.
ALTER TABLE public.collections_event ENABLE ROW LEVEL SECURITY;

-- Armateurs see events on their own transactions.
CREATE POLICY "Collections events — armateur sees own"
    ON public.collections_event FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.transactions t
            WHERE t.id = collections_event.transaction_id
              AND t.debtor_profile_id = auth.uid()
        )
        OR public.get_user_role()::text IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER')
    );

-- INSERT is allowed for staff + system. The service layer always uses the
-- service_role client, bypassing RLS — this policy covers the rare case of
-- a SQL editor insert.
CREATE POLICY "Collections events — staff can insert"
    ON public.collections_event FOR INSERT
    WITH CHECK (
        public.get_user_role()::text IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER')
    );

-- Append-only: block UPDATE and DELETE at the trigger level (same pattern as
-- audit_logs migration 018).
CREATE OR REPLACE FUNCTION public.collections_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'collections_event is append-only — % operation is not permitted', TG_OP
        USING HINT = 'To revoke an event, insert a CORRECTION row with supersedes_event_id set.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS collections_event_no_update ON public.collections_event;
CREATE TRIGGER collections_event_no_update
    BEFORE UPDATE ON public.collections_event
    FOR EACH ROW
    EXECUTE FUNCTION public.collections_event_append_only();

DROP TRIGGER IF EXISTS collections_event_no_delete ON public.collections_event;
CREATE TRIGGER collections_event_no_delete
    BEFORE DELETE ON public.collections_event
    FOR EACH ROW
    EXECUTE FUNCTION public.collections_event_append_only();

-- ── 4. profile_credit_usage — view exposing residual credit ─────────────────
-- `credit_used_usd`     : in-flight non-disputed debt (CURRENT→OVERDUE→SUSPENDED).
-- `credit_disputed_usd` : amounts paused pending dispute adjudication.
-- `credit_available_usd`: limit − used. Does NOT net out disputed — the
--                         issuance gate in app code decides whether to block
--                         on (used + disputed) or just on used.
CREATE OR REPLACE VIEW public.profile_credit_usage AS
SELECT
    p.id                                              AS profile_id,
    p.credit_limit_usd,
    COALESCE(SUM(t.tax_amount_usd - t.partial_paid_usd)
             FILTER (WHERE t.collections_status NOT IN ('PAID','WAIVED','DISPUTED')), 0)
                                                      AS credit_used_usd,
    COALESCE(SUM(t.tax_amount_usd - t.partial_paid_usd)
             FILTER (WHERE t.collections_status = 'DISPUTED'), 0)
                                                      AS credit_disputed_usd,
    p.credit_limit_usd - COALESCE(SUM(t.tax_amount_usd - t.partial_paid_usd)
             FILTER (WHERE t.collections_status NOT IN ('PAID','WAIVED','DISPUTED')), 0)
                                                      AS credit_available_usd,
    p.eez_suspended
FROM public.profiles p
LEFT JOIN public.transactions t
    ON t.debtor_profile_id = p.id
WHERE p.role = 'SHIPPING_AGENT'
GROUP BY p.id, p.credit_limit_usd, p.eez_suspended;

COMMENT ON VIEW public.profile_credit_usage IS
    'Per-armateur credit ledger. credit_used_usd is non-disputed in-flight '
    'debt; credit_disputed_usd is isolated so the app-level issuance gate can '
    'pick a policy (block on used+disputed vs. just used) without requiring '
    'a migration to flip it.';

-- ── 4b. orphan_transactions — operational triage view ───────────────────────
-- Transactions with no resolvable debtor (NULL debtor_profile_id) fall out of
-- every downstream flow: RLS hides them, the cron has no one to email, the
-- credit usage view excludes them. This view surfaces them for admin triage.
-- Steady-state expectation: zero rows. Weekly dashboard alert if > 0.
-- TODO (post first prod deploy): verify backfill cleanness, then tighten
-- transactions.debtor_profile_id to NOT NULL via follow-up migration.
CREATE OR REPLACE VIEW public.orphan_transactions AS
SELECT
    t.id,
    t.vessel_id,
    t.vessel_name,
    t.vessel_imo,
    t.tax_amount_usd,
    t.status,
    t.collections_status,
    t.created_at,
    t.due_date
FROM public.transactions t
WHERE t.debtor_profile_id IS NULL
  AND t.collections_status NOT IN ('PAID','WAIVED');

COMMENT ON VIEW public.orphan_transactions IS
    'Transactions with no resolvable debtor profile — historical rows where the '
    'vessel→owner backfill found no owner_id. Should be zero in steady state. '
    'Surface via admin dashboard; manual triage assigns a debtor or voids the row.';

-- ── 5. status ⇔ collections_status invariant trigger (OV4) ──────────────────
-- Without this, a mistaken UPDATE on `status` could leave the two columns out
-- of sync, corrupting MoECC reports and the collections cron.
CREATE OR REPLACE FUNCTION public.enforce_status_collections_invariant()
RETURNS TRIGGER AS $$
BEGIN
    -- If status is PAID, collections_status must be PAID.
    IF NEW.status = 'PAID' AND NEW.collections_status <> 'PAID' THEN
        RAISE EXCEPTION 'Invariant violated: status=PAID requires collections_status=PAID (got %). Fix: update via collectionsService.handlePaymentReceived.', NEW.collections_status;
    END IF;

    -- If status is EXEMPT, collections_status must be WAIVED.
    IF NEW.status = 'EXEMPT' AND NEW.collections_status <> 'WAIVED' THEN
        RAISE EXCEPTION 'Invariant violated: status=EXEMPT requires collections_status=WAIVED (got %).', NEW.collections_status;
    END IF;

    -- If collections_status is PAID, status must be PAID (the mirror).
    IF NEW.collections_status = 'PAID' AND NEW.status <> 'PAID' THEN
        RAISE EXCEPTION 'Invariant violated: collections_status=PAID requires status=PAID (got %).', NEW.status;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_status_invariant ON public.transactions;
CREATE TRIGGER transactions_status_invariant
    BEFORE INSERT OR UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_status_collections_invariant();

-- ── Documentation ───────────────────────────────────────────────────────────
COMMENT ON COLUMN public.transactions.collections_status IS
    'NET-30 state machine, independent from legacy `status` but invariant-bound. '
    'Driven by cron (/api/cron/overdue-alerts) + dispute/payment events.';
COMMENT ON COLUMN public.transactions.settlement_effective_at IS
    'When this invoice is legally settled for MoECC reporting. Distinct from '
    'paid_at in case counsel rules settlement requires dispute-window expiry '
    '(OV1 from outside voice plan review).';
COMMENT ON COLUMN public.collections_event.supersedes_event_id IS
    'If set, this event cancels/corrects a prior event. Append-only preserved; '
    'admin-error revocation flow (OV10 from outside voice plan review).';
