-- Test 085: transactions split_rule_id — issuance-date stamping trigger + backfill
BEGIN;

-- Minimal transactions INSERT shape (from 077 behavioral test):
--   vessel_id (nullable FK), mode, vessel_name, vessel_imo,
--   transaction_type, emissions_tco2, tax_amount_usd,
--   status, collections_status, document_type, rate_usd_per_tco2, jurisdiction_id
-- For MARITIME rows the transactions_asset_per_mode CHECK requires vessel_id NOT NULL.
-- Vessel seed shape (from live schema): name, imo_number, mmsi, call_sign, flag_code,
--   category, gross_tonnage_dwt, engine_power_kw, design_speed_knots, jurisdiction_id.

-- ── 1. SO: trigger stamps the Somaliland escrow rule ────────────────────────
DO $$
DECLARE
  so_jid      UUID := '00000000-0000-4000-8000-00000000534f';
  so_rule_id  UUID;
  v_id        UUID;
  txn_id      UUID;
  stamped_id  UUID;
BEGIN
  SELECT id INTO so_rule_id
    FROM public.revenue_split_rule
   WHERE jurisdiction_id = so_jid AND effective_to IS NULL;

  IF so_rule_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Somaliland split rule seed not found';
  END IF;

  INSERT INTO public.vessels (
    name, imo_number, mmsi, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    jurisdiction_id
  ) VALUES (
    'Test Vessel 085-SO', '9085001', '085000001', 'T085A', 'SO',
    'CARGO', 5000, 8000, 14.0,
    so_jid
  ) RETURNING id INTO v_id;

  INSERT INTO public.transactions (
    vessel_id, mode, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd,
    status, collections_status, document_type,
    rate_usd_per_tco2, jurisdiction_id
  ) VALUES (
    v_id, 'MARITIME', 'Test Vessel 085-SO', '9085001',
    'ENTRY_TAX', 10.00, 400.00,
    'PENDING', 'CURRENT', 'PROFORMA',
    40.00, so_jid
  ) RETURNING id INTO txn_id;

  SELECT split_rule_id INTO stamped_id FROM public.transactions WHERE id = txn_id;

  IF stamped_id IS DISTINCT FROM so_rule_id THEN
    RAISE EXCEPTION 'TEST FAILED (case 1): expected SO split_rule_id=% but got %', so_rule_id, stamped_id;
  END IF;
END $$;

-- ── 2. DJ: trigger stamps the Djibouti escrow rule ──────────────────────────
DO $$
DECLARE
  dj_jid      UUID := '00000000-0000-4000-8000-00000000444a';
  dj_rule_id  UUID;
  v_id        UUID;
  txn_id      UUID;
  stamped_id  UUID;
BEGIN
  SELECT id INTO dj_rule_id
    FROM public.revenue_split_rule
   WHERE jurisdiction_id = dj_jid AND effective_to IS NULL;

  IF dj_rule_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: Djibouti split rule seed not found';
  END IF;

  INSERT INTO public.vessels (
    name, imo_number, mmsi, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    jurisdiction_id
  ) VALUES (
    'Test Vessel 085-DJ', '9085002', '085000002', 'T085B', 'DJ',
    'CARGO', 5000, 8000, 14.0,
    dj_jid
  ) RETURNING id INTO v_id;

  INSERT INTO public.transactions (
    vessel_id, mode, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd,
    status, collections_status, document_type,
    rate_usd_per_tco2, jurisdiction_id
  ) VALUES (
    v_id, 'MARITIME', 'Test Vessel 085-DJ', '9085002',
    'ENTRY_TAX', 8.00, 320.00,
    'PENDING', 'CURRENT', 'PROFORMA',
    40.00, dj_jid
  ) RETURNING id INTO txn_id;

  SELECT split_rule_id INTO stamped_id FROM public.transactions WHERE id = txn_id;

  IF stamped_id IS DISTINCT FROM dj_rule_id THEN
    RAISE EXCEPTION 'TEST FAILED (case 2): expected DJ split_rule_id=% but got %', dj_rule_id, stamped_id;
  END IF;
END $$;

-- ── 3. Explicit split_rule_id is preserved — trigger does NOT overwrite ──────
-- Supply DJ rule id on an SO jurisdiction row; proves non-NULL values are left alone.
DO $$
DECLARE
  so_jid      UUID := '00000000-0000-4000-8000-00000000534f';
  dj_jid      UUID := '00000000-0000-4000-8000-00000000444a';
  dj_rule_id  UUID;
  v_id        UUID;
  txn_id      UUID;
  stamped_id  UUID;
BEGIN
  SELECT id INTO dj_rule_id
    FROM public.revenue_split_rule
   WHERE jurisdiction_id = dj_jid AND effective_to IS NULL;

  INSERT INTO public.vessels (
    name, imo_number, mmsi, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    jurisdiction_id
  ) VALUES (
    'Test Vessel 085-explicit', '9085003', '085000003', 'T085C', 'SO',
    'CARGO', 5000, 8000, 14.0,
    so_jid
  ) RETURNING id INTO v_id;

  INSERT INTO public.transactions (
    vessel_id, mode, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd,
    status, collections_status, document_type,
    rate_usd_per_tco2, jurisdiction_id,
    split_rule_id
  ) VALUES (
    v_id, 'MARITIME', 'Test Vessel 085-explicit', '9085003',
    'ENTRY_TAX', 5.00, 200.00,
    'PENDING', 'CURRENT', 'PROFORMA',
    40.00, so_jid,
    dj_rule_id   -- explicit: artificial but proves preservation (trigger skips non-NULL)
  ) RETURNING id INTO txn_id;

  SELECT split_rule_id INTO stamped_id FROM public.transactions WHERE id = txn_id;

  IF stamped_id IS DISTINCT FROM dj_rule_id THEN
    RAISE EXCEPTION 'TEST FAILED (case 3): explicit split_rule_id was overwritten; expected % but got %', dj_rule_id, stamped_id;
  END IF;
END $$;

-- ── 4. Pre-rule created_at → split_rule_id remains NULL ─────────────────────
-- created_at = 2026-01-01 predates both rules (effective_from = 2026-03-31).
DO $$
DECLARE
  so_jid     UUID := '00000000-0000-4000-8000-00000000534f';
  v_id       UUID;
  txn_id     UUID;
  stamped_id UUID;
BEGIN
  INSERT INTO public.vessels (
    name, imo_number, mmsi, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    jurisdiction_id
  ) VALUES (
    'Test Vessel 085-predate', '9085004', '085000004', 'T085D', 'SO',
    'CARGO', 5000, 8000, 14.0,
    so_jid
  ) RETURNING id INTO v_id;

  INSERT INTO public.transactions (
    vessel_id, mode, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd,
    status, collections_status, document_type,
    rate_usd_per_tco2, jurisdiction_id,
    created_at
  ) VALUES (
    v_id, 'MARITIME', 'Test Vessel 085-predate', '9085004',
    'ENTRY_TAX', 3.00, 120.00,
    'PENDING', 'CURRENT', 'PROFORMA',
    40.00, so_jid,
    TIMESTAMPTZ '2026-01-01T00:00:00Z'
  ) RETURNING id INTO txn_id;

  SELECT split_rule_id INTO stamped_id FROM public.transactions WHERE id = txn_id;

  IF stamped_id IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case 4): pre-rule tx should have NULL split_rule_id but got %', stamped_id;
  END IF;
END $$;

-- ── 5. Backfill mechanics ────────────────────────────────────────────────────
-- Disable trigger → INSERT (lands without stamp) → verify NULL →
-- re-run backfill UPDATE → verify stamped.
DO $$
DECLARE
  so_jid      UUID := '00000000-0000-4000-8000-00000000534f';
  so_rule_id  UUID;
  v_id        UUID;
  txn_id      UUID;
  pre_stamp   UUID;
  post_stamp  UUID;
BEGIN
  SELECT id INTO so_rule_id
    FROM public.revenue_split_rule
   WHERE jurisdiction_id = so_jid AND effective_to IS NULL;

  INSERT INTO public.vessels (
    name, imo_number, mmsi, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots,
    jurisdiction_id
  ) VALUES (
    'Test Vessel 085-backfill', '9085005', '085000005', 'T085E', 'SO',
    'CARGO', 5000, 8000, 14.0,
    so_jid
  ) RETURNING id INTO v_id;

  -- Bypass trigger to simulate a row that pre-existed the trigger
  ALTER TABLE public.transactions DISABLE TRIGGER transactions_stamp_split_rule;

  INSERT INTO public.transactions (
    vessel_id, mode, vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd,
    status, collections_status, document_type,
    rate_usd_per_tco2, jurisdiction_id
  ) VALUES (
    v_id, 'MARITIME', 'Test Vessel 085-backfill', '9085005',
    'ENTRY_TAX', 12.00, 480.00,
    'PENDING', 'CURRENT', 'PROFORMA',
    40.00, so_jid
  ) RETURNING id INTO txn_id;

  ALTER TABLE public.transactions ENABLE TRIGGER transactions_stamp_split_rule;

  -- Assert: without trigger, split_rule_id is NULL
  SELECT split_rule_id INTO pre_stamp FROM public.transactions WHERE id = txn_id;
  IF pre_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (case 5a): expected NULL before backfill but got %', pre_stamp;
  END IF;

  -- Re-run the backfill UPDATE from the migration
  UPDATE public.transactions t
     SET split_rule_id = r.id
    FROM public.revenue_split_rule r
   WHERE t.split_rule_id IS NULL
     AND r.jurisdiction_id = t.jurisdiction_id
     AND r.effective_from <= t.created_at
     AND (r.effective_to IS NULL OR r.effective_to > t.created_at);

  -- Assert: now stamped with the SO rule
  SELECT split_rule_id INTO post_stamp FROM public.transactions WHERE id = txn_id;
  IF post_stamp IS DISTINCT FROM so_rule_id THEN
    RAISE EXCEPTION 'TEST FAILED (case 5b): expected SO rule % after backfill but got %', so_rule_id, post_stamp;
  END IF;
END $$;

ROLLBACK;
SELECT '085 transactions split rule: PASS' AS test_result;
