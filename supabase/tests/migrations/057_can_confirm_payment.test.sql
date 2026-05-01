BEGIN;

-- seed: two finance admins + one superadmin + one shipping agent + one shipowner
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'finance1@test'),
  ('22222222-2222-2222-2222-222222222222', 'finance2@test'),
  ('33333333-3333-3333-3333-333333333333', 'super@test'),
  ('44444444-4444-4444-4444-444444444444', 'agent@test');

-- The on_auth_user_created trigger auto-creates profiles, but we need specific values.
-- Delete the auto-created ones and insert with exact role values.
DELETE FROM public.profiles WHERE id IN (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'
);

INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'finance1@test', 'F1', 'FINANCE_ADMIN', true),
  ('22222222-2222-2222-2222-222222222222', 'finance2@test', 'F2', 'FINANCE_ADMIN', true),
  ('33333333-3333-3333-3333-333333333333', 'super@test', 'S',  'SUPERADMIN',     true),
  ('44444444-4444-4444-4444-444444444444', 'agent@test', 'A',  'SHIPPING_AGENT', true);

INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Co', 'ACTIVE', 'en');

-- WIRE_TRANSFER initiated by finance1: any FINANCE_ADMIN can confirm
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('11111111-aaaa-aaaa-aaaa-111111111111',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          100000, 'USD', 100000, 'WIRE_TRANSFER', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  ) IS TRUE, 'WIRE: any FINANCE_ADMIN can confirm';
  ASSERT public.can_confirm_payment(
    '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid
  ) IS FALSE, 'WIRE: SHIPPING_AGENT cannot confirm';
END $$;

-- CASH declared by finance1: only finance2 (≠ declarer) can confirm (4-eyes)
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('22222222-aaaa-aaaa-aaaa-222222222222',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          50000, 'USD', 50000, 'CASH', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '22222222-aaaa-aaaa-aaaa-222222222222'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  ) IS FALSE, 'CASH: same person cannot self-confirm (4-eyes)';
  ASSERT public.can_confirm_payment(
    '22222222-aaaa-aaaa-aaaa-222222222222'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  ) IS TRUE, 'CASH: different FINANCE_ADMIN can confirm';
END $$;

-- NETTING: only SUPERADMIN
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('33333333-aaaa-aaaa-aaaa-333333333333',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          200000, 'USD', 200000, 'NETTING', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '33333333-aaaa-aaaa-aaaa-333333333333'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  ) IS FALSE, 'NETTING: FINANCE_ADMIN cannot confirm';
  ASSERT public.can_confirm_payment(
    '33333333-aaaa-aaaa-aaaa-333333333333'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid
  ) IS TRUE, 'NETTING: SUPERADMIN can confirm';
END $$;

-- WALLET + STRIPE: nobody (system-only / auto)
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('44444444-aaaa-aaaa-aaaa-444444444444',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          NULL, 1000, 'USD', 1000, 'WALLET', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '44444444-aaaa-aaaa-aaaa-444444444444'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid
  ) IS FALSE, 'WALLET: even SUPERADMIN cannot manually confirm';
END $$;

ROLLBACK;
