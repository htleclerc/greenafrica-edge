BEGIN;

-- Setup
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Owner');

INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots)
VALUES ('dddddddd-0000-0000-0000-000000000001', '9999999', '999999999', 'Test Vessel', 'TCALL', 'SO', 'CONTAINER', 5000, 1000, 12.5);

-- Note: existing transactions table requires vessel_id, vessel_name, vessel_imo NOT NULL, and uses tax_amount_usd (numeric dollars).
INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, shipowner_id, document_type, transaction_type, emissions_tco2, tax_amount_usd, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
    'dddddddd-0000-0000-0000-000000000001',
    'Test Vessel', '9999999',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX', 100.00, 100.00, 'PENDING');

INSERT INTO public.payments (id, transaction_id, shipowner_id, amount_minor, currency,
  amount_usd_minor, rail, status)
VALUES (
  'cccccccc-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  100, 'USD', 100, 'WIRE_TRANSFER', 'INITIATED'
);

-- Get a profile to use as uploaded_by
DO $$
DECLARE prof UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: no profile seeded — cannot proceed';
  END IF;

  -- 1. Happy path
  INSERT INTO public.payment_proofs (payment_id, storage_path, mime_type, size_bytes, uploaded_by)
  VALUES ('cccccccc-0000-0000-0000-000000000001', 'owner1/c.../proof.pdf',
          'application/pdf', 1024, prof);

  -- 2. size_bytes <= 0 rejected
  BEGIN
    INSERT INTO public.payment_proofs (payment_id, storage_path, mime_type, size_bytes, uploaded_by)
    VALUES ('cccccccc-0000-0000-0000-000000000001', 'p2', 'image/png', 0, prof);
    RAISE EXCEPTION 'TEST FAILED: size_bytes=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 3. size_bytes > 5 MB rejected
  BEGIN
    INSERT INTO public.payment_proofs (payment_id, storage_path, mime_type, size_bytes, uploaded_by)
    VALUES ('cccccccc-0000-0000-0000-000000000001', 'p3', 'application/pdf', 6*1024*1024, prof);
    RAISE EXCEPTION 'TEST FAILED: size_bytes >5MB accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. Cascade delete: deleting payment removes proofs
  DELETE FROM public.payments WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  PERFORM 1 FROM public.payment_proofs WHERE payment_id = 'cccccccc-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: payment_proofs not cascaded on payment delete';
  END IF;
END $$;

ROLLBACK;
SELECT '049 payment proofs: PASS' AS test_result;
