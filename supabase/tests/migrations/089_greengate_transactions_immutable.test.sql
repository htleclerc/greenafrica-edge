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
-- 7c. value → SAME value: allowed (/invoices/generate regeneration path re-writes
--     identical ref; idempotent re-generation must not be broken)
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

  -- Same-value re-write (value → identical value): must be allowed
  -- IS DISTINCT FROM returns FALSE for equal values, so the guard does not fire.
  UPDATE public.transactions SET invoice_ref = 'INV-2026-089NEW' WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND invoice_ref = 'INV-2026-089NEW';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (7c): invoice_ref same-value re-write should be allowed (idempotent regeneration)';
  END IF;
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
-- Drop the WHEN OTHERS arm that would swallow the TEST FAILED marker.
-- Only catch the specific error codes that indicate TRUNCATE was blocked.
DO $$
BEGIN
  BEGIN
    TRUNCATE public.transactions;
    RAISE EXCEPTION 'TEST FAILED (17): TRUNCATE should have been blocked';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;         -- our trigger
    WHEN feature_not_supported  THEN NULL;         -- FK children blocked it (0A000) — equally good
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

-- ── 18. FROZEN new columns: vessel_name and vessel_imo cannot be changed ──────
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET vessel_name = 'HACKED-NAME'
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (18a): expected insufficient_privilege for vessel_name change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    UPDATE public.transactions SET vessel_imo = 'IMO0000000'
     WHERE id = 'e0890000-0000-0000-0000-000000000089';
    RAISE EXCEPTION 'TEST FAILED (18b): expected insufficient_privilege for vessel_imo change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 19. FROZEN: partial_paid_usd cannot be changed post-INSERT ────────────────
-- partial_paid_usd is NOT NULL DEFAULT 0, so it is always set at INSERT.
-- The only writer was the mig 022 one-time backfill; no post-insert updater exists.
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000094';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-F', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  BEGIN
    UPDATE public.transactions SET partial_paid_usd = 100.00 WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (19): expected insufficient_privilege for partial_paid_usd change';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 20. FIRST-WRITE-ONLY: shipowner_id ───────────────────────────────────────
-- 20a. NULL → value: allowed (mig 070 backfill / claim flow path)
-- 20b. value → different value: rejected (re-pointing settlement attribution = fraud)
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000095';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
  so_id     UUID;
  so_id2    UUID;
BEGIN
  -- Need two shipowner rows for this test.
  INSERT INTO public.shipowners (name, official_email)
  VALUES ('Test Owner A', 'owner-a@test.com')
  RETURNING id INTO so_id;

  INSERT INTO public.shipowners (name, official_email)
  VALUES ('Test Owner B', 'owner-b@test.com')
  RETURNING id INTO so_id2;

  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-G', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  -- NULL → value: must succeed
  UPDATE public.transactions SET shipowner_id = so_id WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND shipowner_id = so_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (20a): shipowner_id NULL→value should succeed';
  END IF;

  -- value → different value: must be rejected
  BEGIN
    UPDATE public.transactions SET shipowner_id = so_id2 WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (20b): expected insufficient_privilege for shipowner_id re-point';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 21. FIRST-WRITE-ONLY: debtor_profile_id ──────────────────────────────────
-- NULL → value allowed (mig 022 triage / backfill path); value → different = rejected.
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000096';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
  prof_id   UUID;
  prof_id2  UUID;
BEGIN
  -- Grab two existing staff profiles (superadmin seeds are available post-reset).
  SELECT id INTO prof_id  FROM public.profiles LIMIT 1 OFFSET 0;
  SELECT id INTO prof_id2 FROM public.profiles LIMIT 1 OFFSET 1;

  IF prof_id IS NULL OR prof_id2 IS NULL OR prof_id = prof_id2 THEN
    RAISE EXCEPTION 'TEST SETUP FAILED (21): need at least 2 profile rows; check seed state';
  END IF;

  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-H', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  -- NULL → value: must succeed
  UPDATE public.transactions SET debtor_profile_id = prof_id WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND debtor_profile_id = prof_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (21a): debtor_profile_id NULL→value should succeed';
  END IF;

  -- value → different value: must be rejected
  BEGIN
    UPDATE public.transactions SET debtor_profile_id = prof_id2 WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (21b): expected insufficient_privilege for debtor_profile_id re-assign';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 22. Backfill hatch: NULL→value on frozen column allowed; value→value rejected ──
-- This exercises the narrowed escape hatch semantics:
--   - hatch ON + frozen column currently NULL → allowed (mirrors mig 085 backfill)
--   - hatch ON + frozen column already set    → STILL rejected (hatch is not bypass)
DO $$
DECLARE
  txn_id    UUID := 'e0890000-0000-0000-0000-000000000097';
  vessel_id UUID := 'f0890000-0000-0000-0000-000000000089';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
  dj_jid    UUID := '00000000-0000-4000-8000-00000000444a';
  so_rule   UUID;
BEGIN
  SELECT id INTO so_rule FROM public.revenue_split_rule
   WHERE jurisdiction_id = so_jid AND effective_to IS NULL;

  -- Insert with NULL split_rule_id (simulates a pre-085 row).
  -- Disable the stamp trigger so split_rule_id stays NULL.
  ALTER TABLE public.transactions DISABLE TRIGGER transactions_stamp_split_rule;

  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type, status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-089-I', 'IMO9089001',
    'ENTRY_TAX', 5.00, 200.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA', 'PENDING', 'CURRENT'
  );

  ALTER TABLE public.transactions ENABLE TRIGGER transactions_stamp_split_rule;

  -- Hatch ON + split_rule_id is NULL → must be allowed (mig 085 backfill scenario)
  SET LOCAL app.transactions_allow_backfill = 'on';
  UPDATE public.transactions SET split_rule_id = so_rule WHERE id = txn_id;
  PERFORM 1 FROM public.transactions WHERE id = txn_id AND split_rule_id = so_rule;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (22a): hatch + NULL→value on frozen split_rule_id should succeed';
  END IF;

  -- Hatch ON + split_rule_id already set (value → different value) → STILL rejected
  -- The hatch does not grant unconditional write access to frozen data.
  BEGIN
    UPDATE public.transactions
       SET split_rule_id = (SELECT id FROM public.revenue_split_rule
                             WHERE jurisdiction_id = dj_jid AND effective_to IS NULL)
     WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (22b): hatch + value→value on frozen split_rule_id should still be rejected';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  -- Also verify: hatch ON + frozen tax_amount_usd already set → STILL rejected
  BEGIN
    UPDATE public.transactions SET tax_amount_usd = 999.00 WHERE id = txn_id;
    RAISE EXCEPTION 'TEST FAILED (22c): hatch + value→value on frozen tax_amount_usd should still be rejected';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ── 22b. Column-count completeness tripwire ──────────────────────────────────
-- mig 089 classifies every column of public.transactions as FROZEN, FIRST-WRITE-
-- ONLY, GENERATED, or FREE (42 columns total as of this migration).  When a new
-- column is added in a future migration, this assertion will fail with a clear
-- message reminding the developer to classify it in the trigger body of
-- transactions_fiscal_immutable_guard() — see the MAINTENANCE note in the mig
-- 089 header comment.
DO $$
DECLARE
  col_count INT;
BEGIN
  SELECT count(*) INTO col_count
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'transactions';

  IF col_count <> 42 THEN
    RAISE EXCEPTION
      'TEST FAILED (column-count tripwire): public.transactions has % columns, expected 42. '
      'A new column was added without being classified in mig 089''s '
      'transactions_fiscal_immutable_guard() trigger. See the MAINTENANCE note in '
      'supabase/migrations/089_greengate_transactions_immutable.sql and add the new '
      'column to the FROZEN / FIRST-WRITE-ONLY / FREE inventory before re-running.',
      col_count;
  END IF;
END $$;

ROLLBACK;
SELECT '089 transactions immutable: PASS' AS test_result;
