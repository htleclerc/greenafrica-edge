BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test'),
  ('33333333-3333-3333-3333-333333333333', 'fin@test');

-- Auto-trigger inserts profiles; delete them so we can re-insert with explicit roles
DELETE FROM public.profiles WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test', 'A', 'SHIPOWNER',     true),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test', 'B', 'SHIPOWNER',     true),
  ('33333333-3333-3333-3333-333333333333', 'fin@test',     'F', 'FINANCE_ADMIN', true);

-- GreenGate v8 (mig 073): the staff "see all" payment clause is now jurisdiction-filtered
-- via current_jurisdiction_ids(). The mig 071 backfill only covered profiles existing at
-- migration time, so grant this test's FINANCE_ADMIN a membership in the seeded Somaliland
-- jurisdiction (mig 071) — the jurisdiction the payments below carry via the mig 072 DEFAULT.
INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-4000-8000-00000000534f');

INSERT INTO public.shipowners (id, name, account_state, official_email, preferred_language, profile_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OwnerA', 'ACTIVE', 'owner-a@test', 'en', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'OwnerB', 'ACTIVE', 'owner-b@test', 'en', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 100, 'USD', 100, 'WIRE_TRANSFER', 'INITIATED'),
  ('b0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 200, 'USD', 200, 'WIRE_TRANSFER', 'INITIATED');

-- Owner A reads only own payments
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.payments;
  ASSERT v_count = 1, format('owner_a should see 1 payment, got %s', v_count);
  PERFORM 1 FROM public.payments WHERE id = 'a0000000-0000-0000-0000-000000000001';
  ASSERT FOUND, 'owner_a should see own payment';
END $$;

-- Owner A cannot see owner B's payment (RLS blocks visibility)
DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.payments WHERE id = 'b0000000-0000-0000-0000-000000000002';
  ASSERT v_count = 0, 'owner_a should not see owner_b payment';
END $$;

-- Owner A cannot flip status to CONFIRMED (only CANCELLED is allowed by WITH CHECK)
DO $$
DECLARE v_status TEXT;
  v_error_msg TEXT := '';
BEGIN
  -- Try to flip to CONFIRMED — should be blocked by WITH CHECK policy
  BEGIN
    UPDATE public.payments SET status='CONFIRMED'
      WHERE id = 'a0000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
  END;
  ASSERT v_error_msg LIKE '%row-level security policy%',
    format('expected RLS policy error, got: %s', v_error_msg);

  -- Verify status is still INITIATED
  SELECT status INTO v_status FROM public.payments
    WHERE id = 'a0000000-0000-0000-0000-000000000001';
  ASSERT v_status = 'INITIATED', format('owner cannot flip to CONFIRMED, got %s', v_status);

  -- But CAN flip to CANCELLED
  UPDATE public.payments SET status='CANCELLED'
    WHERE id = 'a0000000-0000-0000-0000-000000000001';
  SELECT status INTO v_status FROM public.payments
    WHERE id = 'a0000000-0000-0000-0000-000000000001';
  ASSERT v_status = 'CANCELLED', format('owner can flip to CANCELLED, got %s', v_status);
END $$;

-- FINANCE_ADMIN reads everything
SET LOCAL "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.payments;
  ASSERT v_count = 2, format('finance_admin should see 2 payments, got %s', v_count);
END $$;

ROLLBACK;
