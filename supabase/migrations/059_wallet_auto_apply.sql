-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 059: Wallet auto-apply on PROFORMA insert + payment-proofs bucket
-- Spec §7.2 WALLET option C. Skips if wallets.auto_apply_to_proforma=FALSE
-- or balance is zero. Concurrency-safe via SELECT … FOR UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_apply_wallet_to_proforma()
RETURNS TRIGGER AS $$
DECLARE
  v_auto_apply  BOOLEAN;
  v_balance     BIGINT;
  v_due_minor   BIGINT;
  v_apply_minor BIGINT;
  v_payment_id  UUID;
  v_wallet_id   UUID;
  v_system_user UUID;
BEGIN
  IF NEW.document_type <> 'PROFORMA' OR NEW.shipowner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lock the wallet row + read both flags atomically
  SELECT id, auto_apply_to_proforma, balance_usd_minor
    INTO v_wallet_id, v_auto_apply, v_balance
    FROM public.wallets
   WHERE shipowner_id = NEW.shipowner_id
   FOR UPDATE;

  IF NOT FOUND OR NOT COALESCE(v_auto_apply, FALSE) OR v_balance <= 0 THEN
    RETURN NEW;
  END IF;

  -- Get system user (SUPERADMIN or FINANCE_ADMIN) to author the ledger entry
  SELECT id INTO v_system_user FROM public.profiles
    WHERE is_active = true AND role IN ('SUPERADMIN', 'FINANCE_ADMIN')
    ORDER BY created_at ASC LIMIT 1;

  IF v_system_user IS NULL THEN
    RAISE EXCEPTION 'No active system user (SUPERADMIN/FINANCE_ADMIN) found for wallet auto-apply';
  END IF;

  v_due_minor := (NEW.tax_amount_usd * 100)::BIGINT;
  v_apply_minor := LEAST(v_balance, v_due_minor);

  -- Insert WALLET payment row (CONFIRMED state for auto-applied wallet with system_user as confirmer)
  INSERT INTO public.payments (
    transaction_id, shipowner_id, declared_by, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at, rail_details
  ) VALUES (
    NEW.id, NEW.shipowner_id, NULL, v_apply_minor, 'USD',
    v_apply_minor, 'WALLET', 'CONFIRMED', v_system_user, NOW(),
    jsonb_build_object('auto_applied', true)
  ) RETURNING id INTO v_payment_id;

  -- Ledger entry (negative — debit). Trigger on wallet_ledger
  -- (apply_ledger_to_wallet, mig 050) syncs wallets.balance_usd_minor.
  INSERT INTO public.wallet_ledger (
    wallet_id, amount_signed_usd_minor, kind, created_by
  ) VALUES (
    v_wallet_id, -v_apply_minor, 'PROFORMA_APPLY', v_system_user
  );

  -- Recompute transaction status (PAID / PARTIALLY_PAID)
  PERFORM public.recompute_transaction_status(NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER transactions_auto_apply_wallet
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_apply_wallet_to_proforma();

-- Storage bucket for proof uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('payment-proofs', 'payment-proofs', false, 10485760,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO NOTHING;

-- Bucket RLS: owner can write to own payment subfolder; admins read all
DO $$
BEGIN
  CREATE POLICY payment_proofs_owner_write ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'payment-proofs'
      AND (storage.foldername(name))[1] = public.current_shipowner_id()::TEXT
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY payment_proofs_owner_read ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'payment-proofs'
      AND (storage.foldername(name))[1] = public.current_shipowner_id()::TEXT
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY payment_proofs_admin_read ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'payment-proofs'
      AND EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
           AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- DOWN:
-- DROP TRIGGER transactions_auto_apply_wallet ON public.transactions;
-- DROP FUNCTION public.auto_apply_wallet_to_proforma();
-- DROP POLICY payment_proofs_owner_write  ON storage.objects;
-- DROP POLICY payment_proofs_owner_read   ON storage.objects;
-- DROP POLICY payment_proofs_admin_read   ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'payment-proofs';
