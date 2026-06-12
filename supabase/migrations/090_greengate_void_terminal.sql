-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 090: GreenGate Wedge 4 — VOID terminal + pgmq archive wrapper
--
-- TWO CHANGES:
--
-- 1. VOID TERMINAL: the mig-051 recompute_transaction_status function is
--    replaced with a version that has an early-exit guard for VOID transactions.
--    If the transaction's current status is already 'VOID', the function returns
--    without updating anything. A payment confirmed against a VOID document must
--    NOT resurrect it (the payments row stays CONFIRMED and the drift view from
--    mig 068 will alarm for ops investigation).
--    A RAISE WARNING is emitted so DBA logs capture the anomaly for triage.
--
-- 2. pgmq_archive_message: thin SECURITY DEFINER wrapper over pgmq.archive for
--    use by the reconciliation queue worker dead-letter path (mig 035 ships
--    pgmq_ack_message which also calls pgmq.archive, but a named dead-letter
--    RPC makes the intent explicit and keeps the worker code readable).
--
-- DOWN:
--   -- Restore mig-051 version of recompute_transaction_status (copy below).
--   CREATE OR REPLACE FUNCTION public.recompute_transaction_status(p_txn_id UUID)
--   RETURNS VOID AS $$
--   DECLARE
--     s RECORD;
--     new_status public.transaction_status;
--     curr_collections_status TEXT;
--   BEGIN
--     SELECT * INTO s FROM public.transaction_paid_summary WHERE transaction_id = p_txn_id;
--     IF NOT FOUND THEN RETURN; END IF;
--     new_status := CASE
--       WHEN s.paid_usd_minor >= s.due_usd_minor THEN 'PAID'::public.transaction_status
--       WHEN s.paid_usd_minor > 0                THEN 'PARTIALLY_PAID'::public.transaction_status
--       ELSE                                          'PENDING'::public.transaction_status
--     END;
--     SELECT collections_status INTO curr_collections_status
--       FROM public.transactions WHERE id = p_txn_id;
--     UPDATE public.transactions SET
--       status = new_status,
--       collections_status = CASE
--         WHEN new_status = 'PAID'::public.transaction_status THEN 'PAID'
--         WHEN curr_collections_status = 'PAID' AND new_status <> 'PAID'::public.transaction_status THEN 'CURRENT'
--         ELSE curr_collections_status
--       END,
--       settlement_effective_at = CASE WHEN new_status = 'PAID'::public.transaction_status AND settlement_effective_at IS NULL THEN NOW() ELSE settlement_effective_at END
--     WHERE id = p_txn_id;
--   END $$ LANGUAGE plpgsql;
--
--   DROP FUNCTION IF EXISTS public.pgmq_archive_message(TEXT, BIGINT);
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. VOID-terminal recompute_transaction_status ────────────────────────────
-- Replaces the mig-051 version. Only the early-exit guard (lines 3–8 in the
-- DECLARE/BEGIN block) is new; the rest of the body is byte-identical to 051.
CREATE OR REPLACE FUNCTION public.recompute_transaction_status(p_txn_id UUID)
RETURNS VOID AS $$
DECLARE
  s RECORD;
  new_status public.transaction_status;
  curr_collections_status TEXT;
  curr_status public.transaction_status;
BEGIN
  -- ── VOID TERMINAL GUARD (mig 090) ───────────────────────────────────────────
  -- A VOID transaction is permanently closed. A payment being confirmed against
  -- it (race condition, data entry error) must NOT resurrect the transaction —
  -- that would corrupt the fiscal ledger and the settlement view. The payments
  -- row stays CONFIRMED; the drift view (mig 068) will raise an alarm for ops.
  SELECT status INTO curr_status FROM public.transactions WHERE id = p_txn_id;
  IF curr_status = 'VOID'::public.transaction_status THEN
    RAISE WARNING 'recompute_transaction_status: transaction % is VOID — payment confirmed against a void document; drift view alarm expected. Investigate payments table.',
      p_txn_id;
    RETURN;
  END IF;

  -- ── Original mig-051 body (unchanged) ───────────────────────────────────────
  SELECT * INTO s FROM public.transaction_paid_summary WHERE transaction_id = p_txn_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Compute new status
  new_status := CASE
    WHEN s.paid_usd_minor >= s.due_usd_minor THEN 'PAID'::public.transaction_status
    WHEN s.paid_usd_minor > 0                THEN 'PARTIALLY_PAID'::public.transaction_status
    ELSE                                          'PENDING'::public.transaction_status
  END;

  -- Read current collections_status to handle transitions
  SELECT collections_status INTO curr_collections_status
    FROM public.transactions WHERE id = p_txn_id;

  UPDATE public.transactions SET
    status = new_status,
    -- If transitioning TO PAID, set collections_status to PAID.
    -- If transitioning FROM PAID (was PAID but now isn't), reset to CURRENT.
    -- Otherwise keep collections_status unchanged.
    collections_status = CASE
      WHEN new_status = 'PAID'::public.transaction_status THEN 'PAID'
      WHEN curr_collections_status = 'PAID' AND new_status <> 'PAID'::public.transaction_status THEN 'CURRENT'
      ELSE curr_collections_status
    END,
    settlement_effective_at = CASE WHEN new_status = 'PAID'::public.transaction_status AND settlement_effective_at IS NULL THEN NOW() ELSE settlement_effective_at END
  WHERE id = p_txn_id;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.recompute_transaction_status IS
  'mig 090: VOID-terminal guard added. VOID transactions are never recomputed — a payment confirmed against a VOID row triggers a WARNING and leaves the drift view (mig 068) to alarm for ops. Original mig-051 logic unchanged for non-VOID rows.';

-- ── 2. pgmq_archive_message wrapper ─────────────────────────────────────────
-- Named dead-letter RPC for the reconciliation queue worker (mig 090+). The
-- worker calls this when read_ct > 5 to preserve the message in the archive
-- table rather than leaving it to re-deliver forever.
-- Semantics: identical to pgmq_ack_message (both call pgmq.archive), but the
-- distinct name makes the dead-letter intent explicit at the call site.
CREATE OR REPLACE FUNCTION public.pgmq_archive_message(queue_name TEXT, msg_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pgmq.archive(queue_name, msg_id);
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pgmq_archive_message(TEXT, BIGINT) TO service_role;

COMMENT ON FUNCTION public.pgmq_archive_message IS
  'Dead-letter wrapper: archive a pgmq message that has exceeded the retry ceiling. Semantically identical to pgmq_ack_message but named to make intent explicit.';
