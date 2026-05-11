-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 064: Top-up-on-confirm trigger on `payments`
-- Plan 7E Task 1.
--
-- Purpose: when a payment with NO transaction_id transitions to CONFIRMED
-- (whether by INSERT direct or by UPDATE of an INITIATED row), credit the
-- shipowner's wallet via a TOPUP ledger entry.
--
-- Guards:
--   - Skip when transaction_id IS NOT NULL (invoice-linked payments handled
--     elsewhere; transactions trigger reconciles).
--   - Skip when UPDATE comes from an already-CONFIRMED row (cosmetic touches
--     on a confirmed payment must not produce duplicate TOPUP).
--   - Idempotency back-stop: COUNT existing TOPUP ledger rows by payment_id
--     before inserting.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_topup_credit_on_confirm() RETURNS TRIGGER AS $$
DECLARE
  wallet_uuid UUID;
  already INT;
BEGIN
  IF NEW.status <> 'CONFIRMED' OR NEW.transaction_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO wallet_uuid FROM public.wallets WHERE shipowner_id = NEW.shipowner_id;
  IF wallet_uuid IS NULL THEN
    INSERT INTO public.wallets (shipowner_id) VALUES (NEW.shipowner_id) RETURNING id INTO wallet_uuid;
  END IF;

  SELECT COUNT(*) INTO already FROM public.wallet_ledger
    WHERE payment_id = NEW.id AND kind = 'TOPUP';
  IF already > 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.wallet_ledger
    (wallet_id, amount_signed_usd_minor, kind, payment_id, created_by)
  VALUES
    (wallet_uuid, NEW.amount_usd_minor, 'TOPUP', NEW.id, NEW.confirmed_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_topup_credit_on_confirm ON public.payments;
CREATE TRIGGER trg_topup_credit_on_confirm
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_topup_credit_on_confirm();

COMMENT ON FUNCTION public.apply_topup_credit_on_confirm() IS
  'Plan 7E Task 1: credit wallet via TOPUP ledger row when a CONFIRMED payment has no transaction_id. Idempotent on re-UPDATE.';
