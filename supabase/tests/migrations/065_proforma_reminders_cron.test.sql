BEGIN;

-- 1. Function exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_proc
    WHERE proname = 'enqueue_proforma_reminders';
  ASSERT n = 1, format('expected enqueue_proforma_reminders, got %s', n);
END $$;

-- 2. Le cron pg_cron a ete retire par la migration 110.
--
-- La 065 planifiait 'proforma-reminders-daily' ; la 110 l'a desactive
-- (cron.unschedule) quand la relance est passee au cron applicatif
-- /api/cron/collection-reminders, qui gere les paliers J3/J7. Ce fichier
-- s'execute apres TOUTE la chaine de migrations : l'etat correct ici est
-- donc l'absence du job. La fonction, elle, reste et est verifiee en 1.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM cron.job
    WHERE jobname = 'proforma-reminders-daily';
  ASSERT n = 0, format('le cron 065 doit avoir ete retire par la mig 110, trouve %s', n);
END $$;

-- 3. Function inserts notifications for PROFORMA aged 3 days
-- Seed: shipowner + vessel + 3-day-old PROFORMA + 7-day-old PROFORMA + 1-day-old PROFORMA
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local');
-- Auto-trigger (on_auth_user_created) already inserted a default profile; drop it
-- so we can re-insert with the explicit FINANCE_ADMIN role this test needs.
DELETE FROM public.profiles WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local', 'A', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TestCo', 'ACTIVE', 'en');
-- vessels has no `jurisdiction_country` column (jurisdiction_id, added by mig 071/072,
-- carries a DEFAULT so it can be omitted). Supply the NOT NULL columns the real schema
-- requires (mirrors the 064 fixture).
INSERT INTO public.vessels (
  id, imo_number, mmsi, name, call_sign, flag_code, category,
  gross_tonnage_dwt, engine_power_kw, design_speed_knots, shipowner_id
) VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '9999999', '999999999', 'TEST', 'TST', 'SO', 'CONTAINER',
  1000, 500, 10, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

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
-- collections_status must mirror status=PAID (enforce_status_collections_invariant, mig 022).
UPDATE public.transactions SET status='PAID', collections_status='PAID' WHERE id='d0000003-0000-0000-0000-000000000003';
INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd, status, collections_status,
   document_type, transaction_type, shipowner_id, invoice_ref, created_at)
  VALUES
  ('d0000300-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PAID', 'PAID',  -- already paid (status⇔collections_status invariant)
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
