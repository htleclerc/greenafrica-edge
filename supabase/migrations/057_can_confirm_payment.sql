-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 057: can_confirm_payment() — authorization matrix from spec §7.2
-- Reusable from RLS policies AND server-action gate. Single source of truth.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_confirm_payment(
  p_payment_id UUID,
  p_profile_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_rail        public.payment_rail;
  v_status      public.payment_status_v7;
  v_declared_by UUID;
  v_role        public.user_role;
BEGIN
  SELECT rail, status, declared_by INTO v_rail, v_status, v_declared_by
    FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND OR v_status NOT IN ('INITIATED', 'PROCESSING') THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles
    WHERE id = p_profile_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- WALLET and STRIPE are system-confirmed (trigger / webhook), never human
  IF v_rail IN ('WALLET', 'STRIPE') THEN
    RETURN FALSE;
  END IF;

  -- NETTING and BANK_GUARANTEE require SUPERADMIN
  IF v_rail IN ('NETTING', 'BANK_GUARANTEE') THEN
    RETURN v_role = 'SUPERADMIN';
  END IF;

  -- CASH requires 4-eyes: FINANCE_ADMIN/SUPERADMIN AND ≠ declarer
  IF v_rail = 'CASH' THEN
    RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN')
       AND v_declared_by IS DISTINCT FROM p_profile_id;
  END IF;

  -- Default rails (WIRE_TRANSFER, MOBILE_MONEY, CHEQUE, LC, THIRD_PARTY):
  -- FINANCE_ADMIN or SUPERADMIN
  RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.can_confirm_payment(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_confirm_payment(UUID, UUID) IS
  'Plan 7C: encodes authorization matrix from spec §7.2. Reused from payments RLS confirm policy and server actions.';

-- DOWN:
-- DROP FUNCTION public.can_confirm_payment(UUID, UUID);
