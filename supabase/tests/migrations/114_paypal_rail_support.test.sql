BEGIN;

-- 1. L'index unique partiel existe
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_paypal_order';
  ASSERT n = 1, format('expected idx_payments_paypal_order, found %s', n);
END $$;

-- 2. Il est UNIQUE et restreint à rail='PAYPAL'
DO $$
DECLARE def TEXT;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_paypal_order';
  ASSERT def LIKE 'CREATE UNIQUE INDEX%', format('expected a UNIQUE index, got: %s', def);
  ASSERT def LIKE '%WHERE %rail%PAYPAL%', format('expected partial index on rail=PAYPAL, got: %s', def);
END $$;

-- 3. can_confirm_payment refuse la confirmation humaine d'un paiement PAYPAL.
--    On monte un jeu de données minimal : un profil FINANCE_ADMIN/SUPERADMIN
--    actif et une ligne payments PAYPAL en PROCESSING sur un shipowner existant.
DO $$
DECLARE
  v_admin      UUID;
  v_shipowner  UUID;
  v_payment    UUID;
BEGIN
  SELECT id INTO v_admin FROM public.profiles
    WHERE is_active = true AND role IN ('FINANCE_ADMIN','SUPERADMIN') LIMIT 1;
  SELECT id INTO v_shipowner FROM public.shipowners LIMIT 1;

  IF v_admin IS NULL OR v_shipowner IS NULL THEN
    RAISE NOTICE 'skipping can_confirm_payment assertion: no seed profile/shipowner';
    RETURN;
  END IF;

  INSERT INTO public.payments
      (shipowner_id, amount_minor, currency, amount_usd_minor, rail, status, external_reference)
  VALUES
      (v_shipowner, 100000, 'USD', 100000, 'PAYPAL', 'PROCESSING', 'ORDER-TEST-114')
  RETURNING id INTO v_payment;

  ASSERT public.can_confirm_payment(v_payment, v_admin) = FALSE,
    'can_confirm_payment must return FALSE for a PAYPAL payment (system-confirmed rail)';
END $$;

-- 4. La matrice d'autorisation préexistante n'a pas régressé : un rail par
--    défaut reste confirmable par un FINANCE_ADMIN/SUPERADMIN.
DO $$
DECLARE
  v_admin      UUID;
  v_shipowner  UUID;
  v_payment    UUID;
BEGIN
  SELECT id INTO v_admin FROM public.profiles
    WHERE is_active = true AND role IN ('FINANCE_ADMIN','SUPERADMIN') LIMIT 1;
  SELECT id INTO v_shipowner FROM public.shipowners LIMIT 1;

  IF v_admin IS NULL OR v_shipowner IS NULL THEN
    RAISE NOTICE 'skipping regression assertion: no seed profile/shipowner';
    RETURN;
  END IF;

  INSERT INTO public.payments
      (shipowner_id, amount_minor, currency, amount_usd_minor, rail, status)
  VALUES
      (v_shipowner, 100000, 'USD', 100000, 'WIRE_TRANSFER', 'INITIATED')
  RETURNING id INTO v_payment;

  ASSERT public.can_confirm_payment(v_payment, v_admin) = TRUE,
    'can_confirm_payment regression: WIRE_TRANSFER must stay confirmable by finance admin';
END $$;

-- 5. L'index interdit deux lignes pour le même ordre PayPal
DO $$
DECLARE
  v_shipowner UUID;
  v_dup       BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shipowner FROM public.shipowners LIMIT 1;
  IF v_shipowner IS NULL THEN
    RAISE NOTICE 'skipping uniqueness assertion: no seed shipowner';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.payments
        (shipowner_id, amount_minor, currency, amount_usd_minor, rail, status, external_reference)
    VALUES
        (v_shipowner, 100000, 'USD', 100000, 'PAYPAL', 'PROCESSING', 'ORDER-TEST-114');
  EXCEPTION WHEN unique_violation THEN
    v_dup := TRUE;
  END;

  ASSERT v_dup, 'expected unique_violation on duplicate PAYPAL external_reference';
END $$;

-- 6. La clé de feature flag est semée, à false
DO $$
DECLARE v JSONB;
BEGIN
  SELECT value INTO v FROM public.app_config
    WHERE key = 'feature.online_payment_paypal_enabled';
  ASSERT v IS NOT NULL, 'feature.online_payment_paypal_enabled not seeded';
  ASSERT v = 'false'::jsonb, format('expected flag false at install, got %s', v);
END $$;

ROLLBACK;
