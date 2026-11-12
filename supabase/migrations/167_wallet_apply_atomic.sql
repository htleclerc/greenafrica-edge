-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 167: atomic wallet application (fixes double-settlement race)
-- Replaces the 3 separate PostgREST calls in walletApplyService with one
-- transaction that locks the wallet FIRST, so concurrent applications serialize
-- and a second application against an insufficient balance can never leave a
-- CONFIRMED payment / PAID transaction behind.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_wallet_credit(
  p_txn_id         UUID,
  p_shipowner_id   UUID,
  p_actor_user_id  UUID,
  p_amount_minor   BIGINT
) RETURNS TABLE(payment_id UUID, wallet_id UUID) AS $$
DECLARE
  v_wallet_id UUID;
  v_balance   BIGINT;
  v_payment   UUID;
BEGIN
  -- Lock the wallet row FIRST. This is the whole fix: two concurrent calls
  -- serialize here, so the second sees the already-debited balance.
  SELECT id, balance_usd_minor INTO v_wallet_id, v_balance
    FROM public.wallets WHERE shipowner_id = p_shipowner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found for shipowner %', p_shipowner_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_balance < p_amount_minor THEN
    RAISE EXCEPTION 'insufficient wallet balance: % < %', v_balance, p_amount_minor
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ledger debit (its AFTER-INSERT trigger re-checks non-negative under the lock).
  INSERT INTO public.wallet_ledger (wallet_id, kind, amount_signed_usd_minor, created_by)
    VALUES (v_wallet_id, 'PROFORMA_APPLY', -p_amount_minor, p_actor_user_id);

  -- Payment row, already CONFIRMED (money is in the wallet). The mig-051 trigger
  -- recomputes transaction status in the same transaction.
  INSERT INTO public.payments (
    transaction_id, shipowner_id, declared_by, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at, rail_details
  ) VALUES (
    p_txn_id, p_shipowner_id, p_actor_user_id, p_amount_minor, 'USD',
    p_amount_minor, 'WALLET', 'CONFIRMED', p_actor_user_id, NOW(),
    jsonb_build_object('applied_by_owner', true)
  ) RETURNING id INTO v_payment;

  RETURN QUERY SELECT v_payment, v_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- SECURITY DEFINER + PostgREST: without this, an authenticated user could call
-- the function directly and apply credit to arbitrary transactions. Only the
-- service-role (used by the server action after it verifies ownership) may call it.
REVOKE ALL ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) TO service_role;

-- DOWN:
-- DROP FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT);
