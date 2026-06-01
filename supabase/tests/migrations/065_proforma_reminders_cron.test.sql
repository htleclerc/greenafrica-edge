BEGIN;

-- 1. Function exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_proc
    WHERE proname = 'enqueue_proforma_reminders';
  ASSERT n = 1, format('expected enqueue_proforma_reminders, got %s', n);
END $$;

-- 2. Cron job exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM cron.job
    WHERE jobname = 'proforma-reminders-daily';
  ASSERT n = 1, format('expected cron job, got %s', n);
END $$;

-- 3. Function inserts notifications for PROFORMA aged 3 days
-- Seed: shipowner + vessel + 3-day-old PROFORMA + 7-day-old PROFORMA + 1-day-old PROFORMA
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local');
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local', 'A', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TestCo', 'ACTIVE', 'en');
INSERT INTO public.vessels (id, imo_number, name, jurisdiction_country, shipowner_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '9999999', 'TEST', 'KE', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd, status,
   document_type, transaction_type, shipowner_id, invoice_ref, created_at)
  VALUES
  ('d0000003-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-OLD-3D',
   NOW() - INTERVAL '3 days' - INTERVAL '2 hours'),
  ('d0000007-0000-0000-0000-000000000007', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-OLD-7D',
   NOW() - INTERVAL '7 days' - INTERVAL '2 hours'),
  ('d0000001-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-NEW-1D',
   NOW() - INTERVAL '1 day');

-- Call the function
SELECT public.enqueue_proforma_reminders();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.owner_notifications
    WHERE kind = 'PROFORMA_REMINDER' AND shipowner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT n = 2, format('expected 2 PROFORMA_REMINDER (3d + 7d), got %s', n);
END $$;

-- 4. Idempotency: re-running the same day does not duplicate
SELECT public.enqueue_proforma_reminders();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.owner_notifications
    WHERE kind = 'PROFORMA_REMINDER' AND shipowner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT n = 2, format('expected idempotent, still 2 PROFORMA_REMINDER, got %s', n);
END $$;

-- 5. PAID transactions are NOT reminded
UPDATE public.transactions SET status='PAID' WHERE id='d0000003-0000-0000-0000-000000000003';
INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd, status,
   document_type, transaction_type, shipowner_id, invoice_ref, created_at)
  VALUES
  ('d0000300-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PAID',  -- already paid
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-PAID-3D',
   NOW() - INTERVAL '3 days' - INTERVAL '3 hours');

SELECT public.enqueue_proforma_reminders();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.owner_notifications
    WHERE kind = 'PROFORMA_REMINDER'
      AND body_params->>'invoice_ref' = 'INV-PAID-3D';
  ASSERT n = 0, format('expected no reminder for PAID transaction, got %s', n);
END $$;

ROLLBACK;
