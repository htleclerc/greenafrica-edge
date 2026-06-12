-- Test 087: money-rail jurisdiction RLS net
-- Verifies that wallets / wallet_ledger / refunds / owner_notifications carry the
-- two SELECT policies (staff jurisdiction-scoped + owner self-scope) and that they
-- enforce cross-tenant isolation correctly.
-- Also verifies the payments external_reference partial unique index (W4-T2).
BEGIN;

-- ── Part 1: structural — each of the four tables has ≥2 policies ─────────────
DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'wallets:wallets_staff_select',
    'wallets:wallets_owner_select',
    'wallet_ledger:wallet_ledger_staff_select',
    'wallet_ledger:wallet_ledger_owner_select',
    'refunds:refunds_staff_select',
    'refunds:refunds_owner_select',
    'owner_notifications:owner_notifications_staff_select',
    'owner_notifications:owner_notifications_owner_select'
  ];
  e TEXT; tbl TEXT; pol TEXT; def TEXT;
BEGIN
  FOREACH e IN ARRAY expected LOOP
    tbl := split_part(e, ':', 1);
    pol := split_part(e, ':', 2);
    SELECT pg_get_expr(polqual, polrelid) INTO def
      FROM pg_policy
     WHERE polname = pol
       AND polrelid = ('public.' || tbl)::regclass;
    IF def IS NULL THEN
      RAISE EXCEPTION 'TEST FAILED: policy "%" on table % is missing', pol, tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'Part 1: all 8 policies present — OK';
END $$;

-- ── Part 2: staff cross-jurisdiction isolation ────────────────────────────────
-- Seed a second jurisdiction (TST), a shipowner per side, wallet + ledger +
-- refund + notification per side. A PORT_OFFICER member of SO only must see the
-- SO rows and must NOT see the TST rows.
DO $$
DECLARE
  so_jid   UUID := '00000000-0000-4000-8000-00000000534f';   -- Somaliland (pre-seeded)
  tst_jid  UUID := '11111111-1111-4111-8111-111111111111';
  user_a   UUID := 'a1a1a1a1-0000-4000-8000-000000000001';   -- PORT_OFFICER, SO only
  so_own   UUID := 'b1b1b1b1-0000-4000-8000-000000000002';   -- shipowner in SO
  tst_own  UUID := 'c1c1c1c1-0000-4000-8000-000000000003';   -- shipowner in TST
  so_wlt   UUID := 'd1d1d1d1-0000-4000-8000-000000000004';
  tst_wlt  UUID := 'e1e1e1e1-0000-4000-8000-000000000005';
  adm_prof UUID := 'f1f1f1f1-0000-4000-8000-000000000006';   -- SUPERADMIN for ledger seed
  so_vsl   UUID := 'a8700001-0000-4000-8000-000000000001';   -- vessel for SO refund txn
  tst_vsl  UUID := 'a8700001-0000-4000-8000-000000000002';   -- vessel for TST refund txn
  so_txn   UUID := 'a8700002-0000-4000-8000-000000000001';   -- transaction for SO refund
  tst_txn  UUID := 'a8700002-0000-4000-8000-000000000002';   -- transaction for TST refund
  cnt      INT;
BEGIN
  -- 1. Seed TST jurisdiction
  INSERT INTO public.jurisdictions (id, code, name, status)
    VALUES (tst_jid, 'TST87', 'Test Country 087', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;

  -- 2. Seed a SUPERADMIN profile for use as created_by in ledger rows (service-role context).
  INSERT INTO auth.users (id, email) VALUES (adm_prof, 'adm87@test') ON CONFLICT DO NOTHING;
  DELETE FROM public.profiles WHERE id = adm_prof;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (adm_prof, 'adm87@test', 'Admin 87', 'SUPERADMIN', true);

  -- 3. Seed shipowners (one per side)
  INSERT INTO public.shipowners (id, name, account_state, official_email, preferred_language,
                                  jurisdiction_id)
    VALUES
      (so_own,  'Owner SO 87',  'ACTIVE', 'so87@test',  'en', so_jid),
      (tst_own, 'Owner TST 87', 'ACTIVE', 'tst87@test', 'en', tst_jid)
    ON CONFLICT (id) DO NOTHING;

  -- 4. Seed vessels + transactions (refunds.transaction_id is NOT NULL)
  INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category,
                               gross_tonnage_dwt, engine_power_kw, design_speed_knots,
                               jurisdiction_id)
    VALUES
      (so_vsl,  '8700087001', '870001001', 'Vessel SO 87',  'VSO87', 'SO', 'CARGO', 5000, 1000, 12.0, so_jid),
      (tst_vsl, '8700087002', '870001002', 'Vessel TST 87', 'VTT87', 'DJ', 'CARGO', 5000, 1000, 12.0, tst_jid)
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, transaction_type,
                                    emissions_tco2, tax_amount_usd, status,
                                    shipowner_id, jurisdiction_id)
    VALUES
      (so_txn,  so_vsl,  'Vessel SO 87',  '8700087001', 'ENTRY_TAX', 10.0, 100.0, 'PENDING', so_own,  so_jid),
      (tst_txn, tst_vsl, 'Vessel TST 87', '8700087002', 'ENTRY_TAX', 10.0, 100.0, 'PENDING', tst_own, tst_jid)
    ON CONFLICT (id) DO NOTHING;

  -- 5. Seed wallets
  INSERT INTO public.wallets (id, shipowner_id, jurisdiction_id)
    VALUES (so_wlt, so_own, so_jid), (tst_wlt, tst_own, tst_jid)
    ON CONFLICT (id) DO NOTHING;

  -- 6. Seed ledger rows (append-only trigger will fire; amounts are positive)
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by,
                                     jurisdiction_id)
    VALUES
      (so_wlt,  1000, 'TOPUP', adm_prof, so_jid),
      (tst_wlt, 2000, 'TOPUP', adm_prof, tst_jid);

  -- 7. Seed refunds (transaction_id is NOT NULL per mig 052)
  INSERT INTO public.refunds (transaction_id, shipowner_id, amount_usd_minor, refund_rail,
                               status, jurisdiction_id)
    VALUES
      (so_txn,  so_own,  500, 'WIRE_TRANSFER', 'REQUESTED', so_jid),
      (tst_txn, tst_own, 600, 'WIRE_TRANSFER', 'REQUESTED', tst_jid);

  -- 8. Seed notifications
  INSERT INTO public.owner_notifications
      (shipowner_id, kind, title_key, body_key, jurisdiction_id)
    VALUES
      (so_own,  'REFUND_ISSUED', 'notif.refund.title', 'notif.refund.body', so_jid),
      (tst_own, 'REFUND_ISSUED', 'notif.refund.title', 'notif.refund.body', tst_jid);

  -- 9. Seed staff user A (PORT_OFFICER, SO jurisdiction only)
  INSERT INTO auth.users (id, email) VALUES (user_a, 'a87@isolation.test') ON CONFLICT DO NOTHING;
  DELETE FROM public.profiles WHERE id = user_a;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (user_a, 'a87@isolation.test', 'Officer A 87', 'PORT_OFFICER', true);
  INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id)
    VALUES (user_a, so_jid) ON CONFLICT DO NOTHING;

  -- 9. Act as Officer A under RLS
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', user_a::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Wallets: must see SO, must NOT see TST
  SELECT COUNT(*) INTO cnt FROM public.wallets WHERE jurisdiction_id = tst_jid;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallets): SO officer sees TST wallet — cross-tenant leak';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.wallets WHERE jurisdiction_id = so_jid;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallets): SO officer cannot see own-jurisdiction wallet';
  END IF;

  -- Wallet ledger: must see SO, must NOT see TST
  SELECT COUNT(*) INTO cnt FROM public.wallet_ledger WHERE jurisdiction_id = tst_jid;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallet_ledger): SO officer sees TST ledger — cross-tenant leak';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.wallet_ledger WHERE jurisdiction_id = so_jid;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallet_ledger): SO officer cannot see own-jurisdiction ledger';
  END IF;

  -- Refunds: must see SO, must NOT see TST
  SELECT COUNT(*) INTO cnt FROM public.refunds WHERE jurisdiction_id = tst_jid;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (refunds): SO officer sees TST refund — cross-tenant leak';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.refunds WHERE jurisdiction_id = so_jid;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (refunds): SO officer cannot see own-jurisdiction refund';
  END IF;

  -- Owner notifications: must see SO, must NOT see TST
  SELECT COUNT(*) INTO cnt FROM public.owner_notifications WHERE jurisdiction_id = tst_jid;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (owner_notifications): SO officer sees TST notification — cross-tenant leak';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.owner_notifications WHERE jurisdiction_id = so_jid;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (owner_notifications): SO officer cannot see own-jurisdiction notification';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'Part 2: staff cross-jurisdiction isolation — OK';
END $$;

-- ── Part 3: owner self-scope ──────────────────────────────────────────────────
-- A SHIPOWNER profile linked to the SO shipowner sees their own wallet / ledger /
-- notifications but NOT the other shipowner's rows.
DO $$
DECLARE
  so_jid   UUID := '00000000-0000-4000-8000-00000000534f';
  tst_jid  UUID := '11111111-1111-4111-8111-111111111111';
  so_own   UUID := 'b1b1b1b1-0000-4000-8000-000000000002';
  tst_own  UUID := 'c1c1c1c1-0000-4000-8000-000000000003';
  so_wlt   UUID := 'd1d1d1d1-0000-4000-8000-000000000004';
  tst_wlt  UUID := 'e1e1e1e1-0000-4000-8000-000000000005';
  user_b   UUID := 'b2b2b2b2-0000-4000-8000-000000000010';  -- profile linked to SO shipowner
  cnt      INT;
BEGIN
  -- Create a profile linked to the SO shipowner
  INSERT INTO auth.users (id, email) VALUES (user_b, 'b87@owner.test') ON CONFLICT DO NOTHING;
  DELETE FROM public.profiles WHERE id = user_b;
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (user_b, 'b87@owner.test', 'Owner B 87', 'SHIPOWNER', true);

  -- Link profile to the SO shipowner row
  UPDATE public.shipowners SET profile_id = user_b WHERE id = so_own;

  -- Act as owner user_b
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', user_b::text)::text, true);
  SET LOCAL ROLE authenticated;

  -- Wallets: must see own (SO), must NOT see TST
  SELECT COUNT(*) INTO cnt FROM public.wallets WHERE id = so_wlt;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallets owner): owner cannot see own wallet';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.wallets WHERE id = tst_wlt;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallets owner): owner sees another shipowner wallet — leak';
  END IF;

  -- Wallet ledger: must see own wallet entries, not the other's
  SELECT COUNT(*) INTO cnt
    FROM public.wallet_ledger wl
   WHERE wl.wallet_id = so_wlt;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallet_ledger owner): owner cannot see own ledger entries';
  END IF;
  SELECT COUNT(*) INTO cnt
    FROM public.wallet_ledger wl
   WHERE wl.wallet_id = tst_wlt;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (wallet_ledger owner): owner sees another shipowner ledger — leak';
  END IF;

  -- Refunds: must see own, not the other's
  SELECT COUNT(*) INTO cnt FROM public.refunds WHERE shipowner_id = so_own;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (refunds owner): owner cannot see own refunds';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.refunds WHERE shipowner_id = tst_own;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (refunds owner): owner sees another shipowner refund — leak';
  END IF;

  -- Notifications: must see own, not the other's
  SELECT COUNT(*) INTO cnt FROM public.owner_notifications WHERE shipowner_id = so_own;
  IF cnt = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (owner_notifications owner): owner cannot see own notifications';
  END IF;
  SELECT COUNT(*) INTO cnt FROM public.owner_notifications WHERE shipowner_id = tst_own;
  IF cnt > 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (owner_notifications owner): owner sees another shipowner notification — leak';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'Part 3: owner self-scope isolation — OK';
END $$;

-- ── Part 4: payments external_reference uniqueness index ─────────────────────
-- A MOBILE_MONEY payment with ref 'paystack:abc123' must be unique;
-- a second with the same ref on the same rail → unique_violation.
-- The same ref on rail = STRIPE is allowed (partial index excludes STRIPE).
DO $$
DECLARE
  so_jid UUID := '00000000-0000-4000-8000-00000000534f';
  so_own UUID := 'b1b1b1b1-0000-4000-8000-000000000002';
  adm_prof UUID := 'f1f1f1f1-0000-4000-8000-000000000006';
  ext_ref  TEXT := 'paystack:TEST87_unique';
  err_code TEXT;
BEGIN
  -- Insert first MOBILE_MONEY payment with the ref
  INSERT INTO public.payments
    (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor,
     rail, status, external_reference, jurisdiction_id)
  VALUES
    (so_own, adm_prof, 500, 'USD', 500,
     'MOBILE_MONEY', 'INITIATED', ext_ref, so_jid);

  -- Insert second with the SAME ref on MOBILE_MONEY → must raise unique_violation
  BEGIN
    INSERT INTO public.payments
      (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor,
       rail, status, external_reference, jurisdiction_id)
    VALUES
      (so_own, adm_prof, 600, 'USD', 600,
       'MOBILE_MONEY', 'INITIATED', ext_ref, so_jid);
    RAISE EXCEPTION 'TEST FAILED (unique index): duplicate MOBILE_MONEY ref was accepted — idempotency broken';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- expected
  END;

  -- Same ref on STRIPE must be ALLOWED (the partial index excludes STRIPE)
  INSERT INTO public.payments
    (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor,
     rail, status, external_reference, jurisdiction_id)
  VALUES
    (so_own, adm_prof, 700, 'USD', 700,
     'STRIPE', 'INITIATED', ext_ref, so_jid);
  -- If no exception above, Stripe exclusion is working.

  RAISE NOTICE 'Part 4: payments_external_ref_unique index — OK';
END $$;

ROLLBACK;
SELECT '087 money rail rls: PASS' AS test_result;
