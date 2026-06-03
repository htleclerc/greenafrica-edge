-- Test 077: transactions polymorphic (air) — structure + behavioral asset CHECK
BEGIN;

-- ── Part 1: structural ───────────────────────────────────────────────────────
DO $$
BEGIN
  -- aircraft_id column present
  PERFORM 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='transactions' AND column_name='aircraft_id';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.aircraft_id column is missing';
  END IF;

  -- vessel_id is now nullable (DROP NOT NULL)
  IF (SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='transactions' AND column_name='vessel_id') <> 'YES' THEN
    RAISE EXCEPTION 'TEST FAILED: transactions.vessel_id is still NOT NULL';
  END IF;

  -- mode-discriminated asset CHECK present + validated
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
      WHERE conname='transactions_asset_per_mode'
        AND conrelid='public.transactions'::regclass
        AND contype='c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'TEST FAILED: transactions_asset_per_mode CHECK missing or not validated';
  END IF;
END $$;

-- ── Part 2: behavioral — AIR transaction with aircraft_id + NULL vessel_id SUCCEEDS;
--           AIR with NULL aircraft_id RAISES (CHECK enforced). ─────────────────
DO $$
DECLARE
  so_jid   UUID := '00000000-0000-4000-8000-00000000534f';
  ac_id    UUID;
  txn_id   UUID;
  raised   BOOLEAN := FALSE;
BEGIN
  -- Seed a Somaliland aircraft for the FK.
  INSERT INTO public.aircraft (icao24, registration, icao_type, engine_type, mtow_kg, jurisdiction_id)
    VALUES ('a077e1', '6O-T77', 'A320', 'CFM56-5B', 78000, so_jid)
    RETURNING id INTO ac_id;

  -- (a) AIR PROFORMA with aircraft_id + NULL vessel_id + the NOT NULL maritime
  --     columns (vessel_name/vessel_imo as the aircraft's registration/icao24,
  --     emissions_tco2, tax_amount_usd, transaction_type) SUCCEEDS.
  INSERT INTO public.transactions (
    aircraft_id, vessel_id, mode,
    vessel_name, vessel_imo,
    transaction_type, emissions_tco2, tax_amount_usd,
    status, collections_status, document_type,
    rate_usd_per_tco2, jurisdiction_id
  ) VALUES (
    ac_id, NULL, 'AIR',
    '6O-T77', 'a077e1',
    'ENTRY_TAX', 2.60, 104.00,
    'PENDING', 'CURRENT', 'PROFORMA',
    40.00, so_jid
  ) RETURNING id INTO txn_id;

  IF txn_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: AIR transaction with aircraft_id + NULL vessel_id did not insert';
  END IF;

  -- (b) AIR with NULL aircraft_id violates transactions_asset_per_mode.
  BEGIN
    INSERT INTO public.transactions (
      aircraft_id, vessel_id, mode,
      vessel_name, vessel_imo,
      transaction_type, emissions_tco2, tax_amount_usd,
      status, collections_status, document_type,
      rate_usd_per_tco2, jurisdiction_id
    ) VALUES (
      NULL, NULL, 'AIR',
      'NO-AIRCRAFT', 'none',
      'ENTRY_TAX', 1.00, 40.00,
      'PENDING', 'CURRENT', 'PROFORMA',
      40.00, so_jid
    );
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED: AIR transaction with NULL aircraft_id was accepted (CHECK not enforced)';
  END IF;
END $$;

ROLLBACK;
SELECT '077 GreenGate transactions polymorphic (air): PASS' AS test_result;
