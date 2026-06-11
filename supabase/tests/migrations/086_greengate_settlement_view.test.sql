-- Test 086: v_revenue_split_settlement — attributed/unattributed/mismatch buckets
BEGIN;

-- ── Seed a hermetic ZZ jurisdiction with 30/70 split rule ───────────────────
-- Using a dedicated test jurisdiction (code='ZZ') means every view row for
-- jurisdiction_code='ZZ' comes exclusively from this test — no interference
-- from pre-existing PAID rows seeded by earlier migrations (SO/DJ).
DO $$
DECLARE
  zz_jid     UUID;
  zz_rid     UUID;
  so_rid     UUID;     -- SO escrow rule — used as the cross-jurisdiction mismatch source
  v_id       UUID;
  cur_month  DATE := date_trunc('month', NOW())::date;

  -- counters for current-month ZZ MARITIME row
  r_tx_count       BIGINT;
  r_total_usd      NUMERIC;
  r_conc_usd       NUMERIC;
  r_sov_usd        NUMERIC;
  r_unatr_count    BIGINT;
  r_unatr_usd      NUMERIC;
  r_mismatch_count BIGINT;

  -- counters for 2025-12 ZZ MARITIME row
  d_tx_count       BIGINT;
  d_total_usd      NUMERIC;
  d_conc_usd       NUMERIC;
  d_sov_usd        NUMERIC;
  d_unatr_count    BIGINT;
  d_unatr_usd      NUMERIC;
  d_mismatch_count BIGINT;
BEGIN
  -- ── 1. ZZ jurisdiction ─────────────────────────────────────────────────────
  INSERT INTO public.jurisdictions
    (code, name, default_currency, data_plane, status)
  VALUES
    ('ZZ', 'Test Jurisdiction ZZ', 'USD', 'POOL', 'ACTIVE')
  RETURNING id INTO zz_jid;

  -- ── 2. ZZ split rule: 30% concessionaire / 70% sovereign, from 2026-01-01 ─
  -- effective_from 2026-01-01 means any tx with created_at < 2026-01-01 → NULL stamp.
  INSERT INTO public.revenue_split_rule
    (jurisdiction_id, effective_from,
     concessionaire_pct, sovereign_pct,
     contract_ref, signature_hash, signed_by)
  VALUES
    (zz_jid, TIMESTAMPTZ '2026-01-01T00:00:00Z',
     30.00, 70.00,
     'ZZ_TEST_CONTRACT', 'ZZ_TEST_HASH', 'test-agent')
  RETURNING id INTO zz_rid;

  -- Fetch the live SO escrow rule — used as the mismatch source (tx in ZZ but rule from SO).
  SELECT id INTO so_rid
    FROM public.revenue_split_rule
   WHERE jurisdiction_id = '00000000-0000-4000-8000-00000000534f'
     AND effective_to IS NULL;

  IF so_rid IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP FAILED: SO escrow rule not found (mig 081/082 seed missing)';
  END IF;

  -- ── 3. ZZ vessel ───────────────────────────────────────────────────────────
  INSERT INTO public.vessels
    (name, imo_number, mmsi, call_sign, flag_code,
     category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
     jurisdiction_id)
  VALUES
    ('Test Vessel 086-ZZ', '9086001', '086000001', 'T086A', 'ZZ',
     'CARGO', 5000, 8000, 14.0,
     zz_jid)
  RETURNING id INTO v_id;

  -- ── 4. Transactions ────────────────────────────────────────────────────────

  -- Tx1: PAID, 100 USD, NOW() → trigger stamps zz_rid → attributed
  INSERT INTO public.transactions
    (vessel_id, mode, vessel_name, vessel_imo,
     transaction_type, emissions_tco2, tax_amount_usd,
     status, collections_status, document_type,
     rate_usd_per_tco2, jurisdiction_id)
  VALUES
    (v_id, 'MARITIME', 'Test Vessel 086-ZZ', '9086001',
     'ENTRY_TAX', 2.50, 100.00,
     'PAID', 'PAID', 'PROFORMA',
     40.00, zz_jid);

  -- Tx2: PAID, 100 USD, NOW() → trigger stamps zz_rid → attributed
  INSERT INTO public.transactions
    (vessel_id, mode, vessel_name, vessel_imo,
     transaction_type, emissions_tco2, tax_amount_usd,
     status, collections_status, document_type,
     rate_usd_per_tco2, jurisdiction_id)
  VALUES
    (v_id, 'MARITIME', 'Test Vessel 086-ZZ', '9086001',
     'ENTRY_TAX', 2.50, 100.00,
     'PAID', 'PAID', 'PROFORMA',
     40.00, zz_jid);

  -- Tx3: PENDING, 100 USD — must NOT appear in the view (status filter)
  INSERT INTO public.transactions
    (vessel_id, mode, vessel_name, vessel_imo,
     transaction_type, emissions_tco2, tax_amount_usd,
     status, collections_status, document_type,
     rate_usd_per_tco2, jurisdiction_id)
  VALUES
    (v_id, 'MARITIME', 'Test Vessel 086-ZZ', '9086001',
     'ENTRY_TAX', 2.50, 100.00,
     'PENDING', 'CURRENT', 'PROFORMA',
     40.00, zz_jid);

  -- Tx4: PAID, 100 USD, created_at '2025-12-01' — predates ZZ rule (effective 2026-01-01).
  -- The trigger resolves NULL (no rule covers that instant) → unattributed.
  -- This row lands in the 2025-12 month bucket.
  INSERT INTO public.transactions
    (vessel_id, mode, vessel_name, vessel_imo,
     transaction_type, emissions_tco2, tax_amount_usd,
     status, collections_status, document_type,
     rate_usd_per_tco2, jurisdiction_id,
     created_at)
  VALUES
    (v_id, 'MARITIME', 'Test Vessel 086-ZZ', '9086001',
     'ENTRY_TAX', 2.50, 100.00,
     'PAID', 'PAID', 'PROFORMA',
     40.00, zz_jid,
     TIMESTAMPTZ '2025-12-01T00:00:00Z');

  -- Tx5: PAID, 100 USD, NOW(), explicit split_rule_id = SO rule (cross-jurisdiction).
  -- The trigger skips stamping (non-NULL already). Rule belongs to SO, not ZZ → MISMATCH.
  INSERT INTO public.transactions
    (vessel_id, mode, vessel_name, vessel_imo,
     transaction_type, emissions_tco2, tax_amount_usd,
     status, collections_status, document_type,
     rate_usd_per_tco2, jurisdiction_id,
     split_rule_id)
  VALUES
    (v_id, 'MARITIME', 'Test Vessel 086-ZZ', '9086001',
     'ENTRY_TAX', 2.50, 100.00,
     'PAID', 'PAID', 'PROFORMA',
     40.00, zz_jid,
     so_rid);  -- deliberately from SO — proves mismatch detection

  -- ── 5. Assert current-month ZZ MARITIME row ────────────────────────────────
  -- Expects: Tx1 + Tx2 + Tx5 (all PAID, current-month)
  --   tx_count       = 3
  --   total_usd      = 300.00
  --   concessionaire = 30% of (Tx1 + Tx2) = 60.00  (Tx5 excluded: mismatch)
  --   sovereign      = 70% of (Tx1 + Tx2) = 140.00
  --   unattributed_count = 0  (all current-month PAID rows have a rule stamp)
  --   unattributed_usd   = NULL (FILTER matches no rows → NULL aggregate)
  --   mismatched_count   = 1  (Tx5)
  SELECT tx_count, total_usd, concessionaire_usd, sovereign_usd,
         unattributed_count, unattributed_usd, mismatched_count
    INTO r_tx_count, r_total_usd, r_conc_usd, r_sov_usd,
         r_unatr_count, r_unatr_usd, r_mismatch_count
    FROM public.v_revenue_split_settlement
   WHERE jurisdiction_id = zz_jid
     AND month = cur_month
     AND mode = 'MARITIME';

  IF r_tx_count IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case A): no current-month ZZ MARITIME row in view';
  END IF;

  IF r_tx_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (case A.tx_count): expected 3 but got %', r_tx_count;
  END IF;

  IF r_total_usd <> 300.00 THEN
    RAISE EXCEPTION 'TEST FAILED (case A.total_usd): expected 300.00 but got %', r_total_usd;
  END IF;

  IF r_conc_usd <> 60.00 THEN
    RAISE EXCEPTION 'TEST FAILED (case A.concessionaire_usd): expected 60.00 but got %', r_conc_usd;
  END IF;

  IF r_sov_usd <> 140.00 THEN
    RAISE EXCEPTION 'TEST FAILED (case A.sovereign_usd): expected 140.00 but got %', r_sov_usd;
  END IF;

  IF r_unatr_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (case A.unattributed_count): expected 0 but got %', r_unatr_count;
  END IF;

  IF r_unatr_usd IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case A.unattributed_usd): expected NULL (no unattributed rows) but got %', r_unatr_usd;
  END IF;

  IF r_mismatch_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (case A.mismatched_count): expected 1 but got %', r_mismatch_count;
  END IF;

  -- ── 6. Assert 2025-12 ZZ MARITIME row (Tx4 only) ──────────────────────────
  -- Expects:
  --   tx_count          = 1
  --   total_usd         = 100.00
  --   concessionaire    = NULL (FILTER matches no attributed rows)
  --   sovereign         = NULL
  --   unattributed_count = 1  (Tx4 has split_rule_id IS NULL)
  --   unattributed_usd  = 100.00
  --   mismatched_count  = 0
  SELECT tx_count, total_usd, concessionaire_usd, sovereign_usd,
         unattributed_count, unattributed_usd, mismatched_count
    INTO d_tx_count, d_total_usd, d_conc_usd, d_sov_usd,
         d_unatr_count, d_unatr_usd, d_mismatch_count
    FROM public.v_revenue_split_settlement
   WHERE jurisdiction_id = zz_jid
     AND month = DATE '2025-12-01'
     AND mode = 'MARITIME';

  IF d_tx_count IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case B): no 2025-12 ZZ MARITIME row in view';
  END IF;

  IF d_tx_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (case B.tx_count): expected 1 but got %', d_tx_count;
  END IF;

  IF d_total_usd <> 100.00 THEN
    RAISE EXCEPTION 'TEST FAILED (case B.total_usd): expected 100.00 but got %', d_total_usd;
  END IF;

  IF d_conc_usd IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case B.concessionaire_usd): expected NULL (no attributed rows) but got %', d_conc_usd;
  END IF;

  IF d_sov_usd IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case B.sovereign_usd): expected NULL (no attributed rows) but got %', d_sov_usd;
  END IF;

  IF d_unatr_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (case B.unattributed_count): expected 1 but got %', d_unatr_count;
  END IF;

  IF d_unatr_usd <> 100.00 THEN
    RAISE EXCEPTION 'TEST FAILED (case B.unattributed_usd): expected 100.00 but got %', d_unatr_usd;
  END IF;

  IF d_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (case B.mismatched_count): expected 0 but got %', d_mismatch_count;
  END IF;

  -- ── 7. PENDING tx must NOT appear anywhere ─────────────────────────────────
  -- The view filters status = 'PAID'. We seeded exactly one PENDING (Tx3) for ZZ.
  -- The two ZZ rows (current-month tx_count=3, dec tx_count=1) account for 4 PAID
  -- rows → any ZZ row with tx_count including the PENDING tx would fail the above.
  -- Implicit: confirmed by the exact tx_count=3 assertion above (not 4).

END $$;

ROLLBACK;
SELECT '086 settlement view: PASS' AS test_result;
