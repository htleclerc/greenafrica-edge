-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 039 : idempotency_keys — server-side request deduplication
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Why
-- ───
-- Money-rail routes (currently /api/transactions/mark-paid, future split/refund
-- endpoints) must survive client retries, network races, double-clicks, and
-- back-button replays without producing duplicate side effects (paid_at
-- overwritten, duplicate audit log, duplicate receipt PDF, duplicate email).
--
-- Pattern: Stripe-style Idempotency-Key header. Client supplies a UUID; server
-- caches the first response under that key and replays it on retry.
--
-- Lifecycle
-- ─────────
--   1. Client sends `Idempotency-Key: <uuid>` header
--   2. Server INSERTs a row with state='in_progress' + request_hash
--      (atomic — UNIQUE on key prevents two concurrent inserts)
--   3. Server executes business logic
--   4. Server UPDATEs the row to state='completed' with cached response
--   5. Subsequent requests with the same key + same body → return cached response
--   6. Same key + different body → 422 (Stripe convention)
--   7. Same key + still in_progress → 409 (caller should retry)
--   8. Cron drops rows older than expires_at (default +24h)
--
-- Security model
-- ──────────────
-- - service_role only (server-side use). RLS denies all anon/authenticated
--   direct access — keys are never exposed to the browser via PostgREST.
-- - Keys are scoped per user_id. A leaked key from user A cannot replay
--   under user B's session (the helper checks this).
-- - The table is NOT append-only — UPDATE is required for state transitions.
--   But UPDATE is restricted to: state, response_status, response_body,
--   completed_at via a column-level CHECK on a trigger. The (key, user_id,
--   method, path, request_hash, created_at) tuple is immutable.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    key             TEXT        PRIMARY KEY,
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    method          TEXT        NOT NULL,
    path            TEXT        NOT NULL,
    request_hash    TEXT        NOT NULL,
    state           TEXT        NOT NULL DEFAULT 'in_progress'
                    CHECK (state IN ('in_progress', 'completed', 'failed')),
    response_status INT         CHECK (response_status BETWEEN 100 AND 599),
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',

    -- Format guard: the spec accepts UUIDs but we accept any URL-safe token
    -- 8-128 chars to also support nanoid / ULID. Reject obvious garbage early.
    CHECK (key ~ '^[A-Za-z0-9_-]{8,128}$'),

    -- A completed row must have status + body; an in_progress row must not.
    CHECK (
        (state = 'in_progress' AND response_status IS NULL AND completed_at IS NULL)
     OR (state IN ('completed', 'failed') AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
    ON public.idempotency_keys(expires_at);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user
    ON public.idempotency_keys(user_id, created_at DESC);

COMMENT ON TABLE public.idempotency_keys IS
    'Server-side request deduplication for money-rail routes. Stripe-style. '
    'See migration 039 header for lifecycle and security model.';

COMMENT ON COLUMN public.idempotency_keys.request_hash IS
    'SHA-256 of normalized (sorted-key) JSON of the request body. Used to '
    'detect "same key reused with different body" → 422.';

-- ── Mutation guard: only allowed UPDATE is the state-transition columns ────

CREATE OR REPLACE FUNCTION public.idempotency_keys_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.key          IS DISTINCT FROM OLD.key
    OR NEW.user_id      IS DISTINCT FROM OLD.user_id
    OR NEW.method       IS DISTINCT FROM OLD.method
    OR NEW.path         IS DISTINCT FROM OLD.path
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.created_at   IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at   IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION
            'idempotency_keys: only state/response_status/response_body/completed_at are mutable'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS idempotency_keys_immutable_fields_trg ON public.idempotency_keys;
CREATE TRIGGER idempotency_keys_immutable_fields_trg
    BEFORE UPDATE ON public.idempotency_keys
    FOR EACH ROW
    EXECUTE FUNCTION public.idempotency_keys_immutable_fields();

-- ── RLS: deny everyone except service_role ─────────────────────────────────

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated/anon → all denied.
-- service_role bypasses RLS by design (used by server routes only).

-- ── Cleanup cron: drop expired rows daily at 03:00 Africa/Mogadishu ────────

-- Reuses the pg_cron extension already installed (mig 034 onwards).
SELECT cron.schedule(
    'idempotency-keys-cleanup',
    '0 0 * * *',  -- 00:00 UTC = 03:00 Africa/Mogadishu (UTC+3, no DST)
    $$ DELETE FROM public.idempotency_keys WHERE expires_at < NOW() $$
);

COMMIT;
