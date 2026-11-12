-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 171: stamp the shipowner's real jurisdiction on wallet-applied
-- payments + ledger. apply_wallet_credit (mig 167) omitted jurisdiction_id, so
-- both rows fell back to the Somaliland DEFAULT (mig 072) — wrong for Djibouti
-- shipowners, corrupting settlement attribution. Same signature/return as 167;
-- the TS caller is unchanged.
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
  v_jid       UUID;
  v_payment   UUID;
BEGIN
  -- Real jurisdiction of the shipowner (not the Somaliland column default).
  SELECT jurisdiction_id INTO v_jid
    FROM public.shipowners WHERE id = p_shipowner_id;
  IF v_jid IS NULL THEN
    RAISE EXCEPTION 'shipowner not found or has no jurisdiction: %', p_shipowner_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Lock the wallet row FIRST — serializes concurrent applications (the mig-167 fix).
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

  INSERT INTO public.wallet_ledger (wallet_id, kind, amount_signed_usd_minor, created_by, jurisdiction_id)
    VALUES (v_wallet_id, 'PROFORMA_APPLY', -p_amount_minor, p_actor_user_id, v_jid);

  INSERT INTO public.payments (
    transaction_id, shipowner_id, declared_by, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at, rail_details, jurisdiction_id
  ) VALUES (
    p_txn_id, p_shipowner_id, p_actor_user_id, p_amount_minor, 'USD',
    p_amount_minor, 'WALLET', 'CONFIRMED', p_actor_user_id, NOW(),
    jsonb_build_object('applied_by_owner', true), v_jid
  ) RETURNING id INTO v_payment;

  RETURN QUERY SELECT v_payment, v_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) TO service_role;

-- DOWN:
-- Restore the migration-167 body (without jurisdiction_id stamping). See
-- supabase/migrations/167_wallet_apply_atomic.sql for the prior definition.
