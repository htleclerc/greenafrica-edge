BEGIN;

DO $$
DECLARE
  v_finance1 UUID;
  v_finance2 UUID;
  v_superadmin UUID;
  v_agent UUID;
  v_shipowner UUID;
  v_wire_payment UUID := gen_random_uuid();
  v_cash_payment UUID := gen_random_uuid();
  v_netting_payment UUID := gen_random_uuid();
  v_wallet_payment UUID := gen_random_uuid();
BEGIN
  -- Activate seeded profiles (they're created with is_active=false)
  UPDATE public.profiles SET is_active = true
    WHERE id = '00000000-0000-0000-0000-000000000002' RETURNING id INTO v_finance1;
  UPDATE public.profiles SET is_active = true
    WHERE id = '00000000-0000-0000-0000-000000000003' RETURNING id INTO v_agent;
  UPDATE public.profiles SET is_active = true
    WHERE id = '00000000-0000-0000-0000-000000000004' RETURNING id INTO v_superadmin;

  -- Create a second FINANCE_ADMIN for 4-eyes testing
  INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'finance2@test',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(), NOW(), NOW(),
    jsonb_build_object('full_name', 'Finance Admin 2', 'role', 'FINANCE_ADMIN', 'is_active', true),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '', '', '', '', ''
  ) RETURNING id INTO v_finance2;

  -- Create a shipowner for payments
  INSERT INTO public.shipowners (id, name, account_state, preferred_language)
    VALUES (gen_random_uuid(), 'Test Co', 'ACTIVE', 'en')
    RETURNING id INTO v_shipowner;

  -- WIRE_TRANSFER initiated by finance1: any FINANCE_ADMIN can confirm
  INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                               amount_usd_minor, rail, status)
    VALUES (v_wire_payment, v_shipowner, v_finance1, 100000, 'USD', 100000, 'WIRE_TRANSFER', 'INITIATED');

  ASSERT public.can_confirm_payment(v_wire_payment, v_finance2) IS TRUE,
    'WIRE: any FINANCE_ADMIN can confirm';
  ASSERT public.can_confirm_payment(v_wire_payment, v_agent) IS FALSE,
    'WIRE: SHIPPING_AGENT cannot confirm';

  -- CASH declared by finance1: only finance2 (≠ declarer) can confirm (4-eyes)
  INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                               amount_usd_minor, rail, status)
    VALUES (v_cash_payment, v_shipowner, v_finance1, 50000, 'USD', 50000, 'CASH', 'INITIATED');

  ASSERT public.can_confirm_payment(v_cash_payment, v_finance1) IS FALSE,
    'CASH: same person cannot self-confirm (4-eyes)';
  ASSERT public.can_confirm_payment(v_cash_payment, v_finance2) IS TRUE,
    'CASH: different FINANCE_ADMIN can confirm';

  -- NETTING: only SUPERADMIN
  INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                               amount_usd_minor, rail, status)
    VALUES (v_netting_payment, v_shipowner, v_finance1, 200000, 'USD', 200000, 'NETTING', 'INITIATED');

  ASSERT public.can_confirm_payment(v_netting_payment, v_finance1) IS FALSE,
    'NETTING: FINANCE_ADMIN cannot confirm';
  ASSERT public.can_confirm_payment(v_netting_payment, v_superadmin) IS TRUE,
    'NETTING: SUPERADMIN can confirm';

  -- WALLET + STRIPE: nobody (system-only / auto)
  INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                               amount_usd_minor, rail, status)
    VALUES (v_wallet_payment, v_shipowner, NULL, 1000, 'USD', 1000, 'WALLET', 'INITIATED');

  ASSERT public.can_confirm_payment(v_wallet_payment, v_superadmin) IS FALSE,
    'WALLET: even SUPERADMIN cannot manually confirm';
END $$;

ROLLBACK;
