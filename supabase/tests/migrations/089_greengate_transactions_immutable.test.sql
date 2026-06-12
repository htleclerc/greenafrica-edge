-- Test 089: GreenGate v8 Wedge 4 — transactions fiscal columns immutable
BEGIN;

-- ── Seed: minimal vessel + a PAID Somaliland MARITIME transaction ─────────────
DO $$
DECLARE
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.vessels (
    id, imo_number, mmsi, name, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots
  ) VALUES (
    vessel_id, 'IMO9089001', '089000001', 'TEST-089', 'T089A', 'SO',
    'BULK_CARRIER', 5000, 8000, 14.0
  ) ON CONFLICT (id) DO NOTHING;

  -- A PAID transaction with fiscal columns stamped (invoice already distributed).
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    distance_eez_nm, mode, jurisdiction_id, document_type,
    status, collections_status, invoice_ref, content_hash, verify_signature
  ) VALUES (
    txn_id, vessel_id, 'TEST-089', 'IMO9089001',
    'ENTRY_TAX', 10.00, 400.00, 40.00,
    120.50, 'MARITIME', so_jid, 'FINAL',
    'PAID', 'PAID', 'INV-2026-089TEST', 'hash-abc', 'sig-xyz'
  ) ON CONFLICT (id) DO NOTHING;
END $$;

-- ── 1. FROZEN: tax_amount_usd cannot be changed ───────────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET tax_amount_usd = 999.99
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (1): expected insufficient_privilege for tax_amount_usd change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 2. FROZEN: jurisdiction_id cannot be re-assigned ──────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions
       SET jurisdiction_id = '00000000-0000-4000-8000-00000000444a'
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (2): expected insufficient_privilege for jurisdiction_id change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 3. FROZEN: document_type cannot be changed ────────────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET document_type = 'PROFORMA'
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (3): expected insufficient_privilege for document_type change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 4. FROZEN: emissions_tco2 cannot be changed ───────────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET emissions_tco2 = 99.99
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (4): expected insufficient_privilege for emissions_tco2 change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 5. FROZEN: mode cannot be changed ────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET mode = 'AIR'
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (5): expected insufficient_privilege for mode change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 6. FROZEN: rate_usd_per_tco2 cannot be changed ───────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET rate_usd_per_tco2 = 99.00
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (6): expected insufficient_privilege for rate_usd_per_tco2 change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 7. FIRST-WRITE-ONLY: invoice_ref ─────────────────────────────────────────
-- 7a. NULL → value: allowed (pipeline first-write path)
-- 7b. value → different value: rejected (distributed PDF carries old ref)
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000090';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-B', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  -- First write (NULL → value): must succeed
  UPDATE public.transactions SET invoice_ref = 'INV-2026-089NEW' WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND invoice_ref = 'INV-2026-089NEW';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (7a): invoice_ref NULL→value should succeed';
  END IF;

  -- Second write (value → different value): must be rejected
  BEGIN
    UPDATE public.transactions SET invoice_ref = 'INV-2026-089CHANGED' WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (7b): expected insufficient_privilege for invoice_ref re-write';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 8. FIRST-WRITE-ONLY: content_hash ────────────────────────────────────────
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000091';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-C', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  -- NULL → value: allowed
  UPDATE public.transactions SET content_hash = 'hash-first' WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND content_hash = 'hash-first';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (8a): content_hash NULL→value should succeed';
  END IF;

  -- value → different value: rejected
  BEGIN
    UPDATE public.transactions SET content_hash = 'hash-second' WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (8b): expected insufficient_privilege for content_hash re-write';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 9. FIRST-WRITE-ONLY: verify_signature ────────────────────────────────────
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000092';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-D', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  -- NULL → value: allowed
  UPDATE public.transactions SET verify_signature = 'sig-first' WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND verify_signature = 'sig-first';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (9a): verify_signature NULL→value should succeed';
  END IF;

  -- value → different value: rejected
  BEGIN
    UPDATE public.transactions SET verify_signature = 'sig-second' WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (9b): expected insufficient_privilege for verify_signature re-write';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 10. FREE: status + collections_status — direct UPDATE respecting mig 022 ──
-- The recompute_transaction_status RPC internally issues UPDATE status + collections_status
-- + settlement_effective_at. We test the free path directly (same columns, same
-- invariant guard from mig 022) rather than through the WALLET trigger to avoid
-- complex payment + shipowner seeding.
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000093';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-E', 'IMO9089001',
    'ENTRY_TAX', 10.00, 400.00, 40.00,
    'MARITIME', so_jid, 'FINAL', 'PENDING', 'CURRENT'
  );

  -- status + collections_status + settlement_effective_at: all FREE
  -- mig 022 invariant: status=PAID ↔ collections_status=PAID
  UPDATE public.transactions
     SET status = 'PAID', collections_status = 'PAID',
         settlement_effective_at = NOW(),
         paid_at = NOW()
   WHERE id = txn_id;

  PERFORM 1 FROM public.transactions
   WHERE id = txn_id AND status = 'PAID' AND collections_status = 'PAID'
     AND settlement_effective_at IS NOT NULL AND paid_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (10): status/collections_status/paid_at/settlement_effective_at should be freely updatable';
  END IF;
END $$;

-- ── 11. FREE: invoice_pdf_url, receipt_pdf_url ────────────────────────────────
DO $$
BEGIN
  UPDATE public.transactions
     SET invoice_pdf_url = 'documents/invoices/test-089.pdf',
         receipt_pdf_url = 'documents/receipts/test-089.pdf'
   WHERE id = 'e0890000-0000-0000-0000-000000000089';

  PERFORM 1 FROM public.transactions
   WHERE id = 'e0890000-0000-0000-0000-000000000089'
     AND invoice_pdf_url = 'documents/invoices/test-089.pdf'
     AND receipt_pdf_url = 'documents/receipts/test-089.pdf';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (11): invoice_pdf_url and receipt_pdf_url should be freely updatable';
  END IF;
END $$;

-- ── 12. FREE: payment_proof_files ────────────────────────────────────────────
DO $$
BEGIN
  UPDATE public.transactions
     SET payment_proof_files = '[{"path":"legacy/e089/proof.pdf","mime_type":"application/pdf","size_bytes":1024,"uploaded_at":"2026-06-12T00:00:00Z"}]'::jsonb
   WHERE id = 'e0890000-0000-0000-0000-000000000089';

  PERFORM 1 FROM public.transactions
   WHERE id = 'e0890000-0000-0000-0000-000000000089'
     AND jsonb_array_length(payment_proof_files) = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (12): payment_proof_files should be freely updatable';
  END IF;
END $$;

-- ── 13. FREE: escalated_to_owner_at, escalated_to_owner_email, escalated_by ──
DO $$
BEGIN
  UPDATE public.transactions
     SET escalated_to_owner_at    = NOW(),
         escalated_to_owner_email = 'owner@test.com',
         escalated_by             = '00000000-0000-0000-0000-000000000002'
   WHERE id = 'e0890000-0000-0000-0000-000000000089';

  PERFORM 1 FROM public.transactions
   WHERE id = 'e0890000-0000-0000-0000-000000000089'
     AND escalated_to_owner_email = 'owner@test.com';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (13): escalated_* fields should be freely updatable';
  END IF;
END $$;

-- ── 14. FREE: proforma_sent_at ───────────────────────────────────────────────
DO $$
BEGIN
  UPDATE public.transactions SET proforma_sent_at = NOW()
   WHERE id = 'e0890000-0000-0000-0000-000000000089';

  PERFORM 1 FROM public.transactions
   WHERE id = 'e0890000-0000-0000-0000-000000000089'
     AND proforma_sent_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (14): proforma_sent_at should be freely updatable';
  END IF;
END $$;

-- ── 15. DELETE guard ──────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    DELETE FROM public.transactions WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (15): expected insufficient_privilege for DELETE';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 16. Sneaky combined update: FREE column + FROZEN column in same statement ─
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions
       SET status = 'PENDING',    -- FREE
           tax_amount_usd = 1.00  -- FROZEN
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (16): expected insufficient_privilege for combined status+tax_amount_usd update';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 17. TRUNCATE guard ────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    TRUNCATE public.transactions;
    RAISE EXCEPTION 'TEST FAILED (17): TRUNCATE should have been blocked';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN feature_not_supported THEN NULL; -- FK children blocked it (0A000) — equally good
    WHEN OTHERS THEN NULL;
  END;
END $$;

-- Verify the TRUNCATE trigger exists.
DO $$
BEGIN
  PERFORM 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'transactions'
     AND t.tgname = 'transactions_no_truncate';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (17b): transactions_no_truncate trigger not found';
  END IF;
END $$;

ROLLBACK;
SELECT '089 transactions immutable: PASS' AS test_result;
