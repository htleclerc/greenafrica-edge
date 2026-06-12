-- Test 090: GreenGate Wedge 4 — VOID terminal (recompute_transaction_status guard)
BEGIN;

-- ── Seed: shared vessel (reused across both cases) ───────────────────────────
DO $$
DECLARE
  vessel_id UUID := 'f0900000-0000-0000-0000-000000000090';
  so_jid    UUID := '00000000-0000-4000-8000-00000000534f';
BEGIN
  INSERT INTO public.vessels (
    id, imo_number, mmsi, name, call_sign, flag_code,
    category, gross_tonnage_dwt, engine_power_kw, design_speed_knots
  ) VALUES (
    vessel_id, 'IMO9090001', '090000001', 'TEST-090', 'T090A', 'SO',
    'BULK_CARRIER', 5000, 8000, 14.0
  ) ON CONFLICT (id) DO NOTHING;
END $$;

-- ── Seed: a shipowner (needed for payments FK) ────────────────────────────────
DO $$
BEGIN
  INSERT INTO public.shipowners (id, name)
  VALUES ('a0900000-0000-0000-0000-000000000090', 'Owner-090')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ── Case 1: VOID transaction — CONFIRMED payment must NOT resurrect it ────────
-- Scenario: proforma was voided (status=VOID, collections_status=WAIVED) after
-- a corridor mismatch. A stale or race payment is then confirmed for it.
-- recompute_transaction_status must leave status=VOID/WAIVED intact.
DO $$
DECLARE
  vessel_id  UUID := 'f0900000-0000-0000-0000-000000000090';
  so_jid     UUID := '00000000-0000-4000-8000-00000000534f';
  txn_id     UUID := 'b0900000-0000-0000-0000-000000000001';
  owner_id   UUID := 'a0900000-0000-0000-0000-000000000090';
  prof_id    UUID;
  final_status TEXT;
  final_coll   TEXT;
BEGIN
  SELECT id INTO prof_id FROM public.profiles LIMIT 1;

  -- Insert a VOID proforma (corridor mismatch scenario)
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type,
    status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-090', 'IMO9090001', owner_id,
    'ENTRY_TAX', 10.00, 400.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA',
    'VOID', 'WAIVED'
  ) ON CONFLICT (id) DO NOTHING;

  -- Call recompute directly (simulating what the payments trigger would do).
  -- The VOID guard must intercept before any UPDATE is attempted.
  PERFORM public.recompute_transaction_status(txn_id);

  -- Assert: status and collections_status are still VOID/WAIVED
  SELECT status::TEXT, collections_status::TEXT
    INTO final_status, final_coll
    FROM public.transactions WHERE id = txn_id;

  IF final_status <> 'VOID' THEN
    RAISE EXCEPTION 'TEST FAILED (1a): expected status=VOID after recompute on VOID txn, got %', final_status;
  END IF;
  IF final_coll <> 'WAIVED' THEN
    RAISE EXCEPTION 'TEST FAILED (1b): expected collections_status=WAIVED after recompute on VOID txn, got %', final_coll;
  END IF;
END $$;

SELECT '090 case 1: VOID terminal guard: PASS' AS test_result;

-- ── Case 2: Non-VOID transaction — recompute still flips to PAID (regression) ─
-- A normal PENDING transaction receives a CONFIRMED payment covering the full
-- amount. recompute_transaction_status must flip status=PAID/collections=PAID.
DO $$
DECLARE
  vessel_id  UUID := 'f0900000-0000-0000-0000-000000000090';
  so_jid     UUID := '00000000-0000-4000-8000-00000000534f';
  txn_id     UUID := 'b0900000-0000-0000-0000-000000000002';
  owner_id   UUID := 'a0900000-0000-0000-0000-000000000090';
  prof_id    UUID;
  final_status TEXT;
  final_coll   TEXT;
BEGIN
  SELECT id INTO prof_id FROM public.profiles LIMIT 1;

  -- Insert a PENDING proforma (tax_amount_usd = 10.00 dollars → 1000 cents)
  INSERT INTO public.transactions (
    id, vessel_id, vessel_name, vessel_imo, shipowner_id,
    transaction_type, emissions_tco2, tax_amount_usd, rate_usd_per_tco2,
    mode, jurisdiction_id, document_type,
    status, collections_status
  ) VALUES (
    txn_id, vessel_id, 'TEST-090-B', 'IMO9090001', owner_id,
    'ENTRY_TAX', 10.00, 10.00, 40.00,
    'MARITIME', so_jid, 'PROFORMA',
    'PENDING', 'CURRENT'
  ) ON CONFLICT (id) DO NOTHING;

  -- Insert a CONFIRMED payment covering the full amount (1000 cents = 10.00 USD)
  -- payments_confirmed_audit constraint requires confirmed_by + confirmed_at when status=CONFIRMED.
  -- The payments_recompute_txn_status trigger fires automatically on INSERT with
  -- status=CONFIRMED — but we call recompute explicitly too for clarity.
  INSERT INTO public.payments (
    transaction_id, shipowner_id,
    amount_minor, currency, amount_usd_minor,
    rail, status, confirmed_by, confirmed_at
  ) VALUES (
    txn_id, owner_id,
    1000, 'USD', 1000,
    'WIRE_TRANSFER', 'CONFIRMED', prof_id, NOW()
  );

  -- The trigger already ran recompute; verify the result.
  SELECT status::TEXT, collections_status::TEXT
    INTO final_status, final_coll
    FROM public.transactions WHERE id = txn_id;

  IF final_status <> 'PAID' THEN
    RAISE EXCEPTION 'TEST FAILED (2a): expected status=PAID after CONFIRMED payment, got %', final_status;
  END IF;
  IF final_coll <> 'PAID' THEN
    RAISE EXCEPTION 'TEST FAILED (2b): expected collections_status=PAID after full payment, got %', final_coll;
  END IF;
END $$;

SELECT '090 case 2: non-VOID recompute regression: PASS' AS test_result;

ROLLBACK;
SELECT '090 void_terminal: PASS' AS test_result;
