-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 058: RLS policies on payments + payment_proofs
-- Plan 7A enabled RLS but added no policies. This migration unlocks the table
-- for owner reads/inserts/cancels and admin reads/updates.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: shipowner_id for current auth.uid()
-- Lookup via shipowners.profile_id = auth.uid()
CREATE OR REPLACE FUNCTION public.current_shipowner_id() RETURNS UUID AS $$
  SELECT id FROM public.shipowners
   WHERE profile_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.current_shipowner_id() TO authenticated, service_role;

-- ── public.payments ─────────────────────────────────────────────────────────

CREATE POLICY payments_owner_select ON public.payments FOR SELECT
  TO authenticated
  USING (shipowner_id = public.current_shipowner_id());

CREATE POLICY payments_admin_select ON public.payments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
  ));

CREATE POLICY payments_owner_insert ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    shipowner_id = public.current_shipowner_id()
    AND status = 'INITIATED'
    AND rail IN ('WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET')
  );

CREATE POLICY payments_admin_insert ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- Owner can CANCEL own INITIATED payment (status flip only, no other field change)
CREATE POLICY payments_owner_cancel ON public.payments FOR UPDATE
  TO authenticated
  USING (
    shipowner_id = public.current_shipowner_id()
    AND status = 'INITIATED'
  )
  WITH CHECK (
    shipowner_id = public.current_shipowner_id()
    AND status = 'CANCELLED'
  );

-- Admin UPDATE — server actions enforce can_confirm_payment; RLS just gates
-- which roles can issue UPDATE at all
-- Note: this policy gates which roles can issue UPDATE; it does NOT validate
-- the resulting status transition. Server actions (confirmPayment, rejectPayment)
-- call public.can_confirm_payment() (mig 057) to enforce the authorization
-- matrix from spec §7.2 before issuing the UPDATE. Direct PostgREST UPDATE
-- calls would bypass that gate — keep all admin status transitions behind a
-- server action.
CREATE POLICY payments_admin_update ON public.payments FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- ── public.payment_proofs ───────────────────────────────────────────────────

CREATE POLICY payment_proofs_owner_select ON public.payment_proofs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payments pmt
     WHERE pmt.id = payment_proofs.payment_id
       AND pmt.shipowner_id = public.current_shipowner_id()
  ));

CREATE POLICY payment_proofs_admin_select ON public.payment_proofs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
  ));

CREATE POLICY payment_proofs_owner_insert ON public.payment_proofs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payments pmt
     WHERE pmt.id = payment_proofs.payment_id
       AND pmt.shipowner_id = public.current_shipowner_id()
       AND pmt.status = 'INITIATED'
  ));

CREATE POLICY payment_proofs_admin_insert ON public.payment_proofs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- DOWN:
-- DROP POLICY payments_owner_select ON public.payments;
-- DROP POLICY payments_admin_select ON public.payments;
-- DROP POLICY payments_owner_insert ON public.payments;
-- DROP POLICY payments_admin_insert ON public.payments;
-- DROP POLICY payments_owner_cancel ON public.payments;
-- DROP POLICY payments_admin_update ON public.payments;
-- DROP POLICY payment_proofs_owner_select ON public.payment_proofs;
-- DROP POLICY payment_proofs_admin_select ON public.payment_proofs;
-- DROP POLICY payment_proofs_owner_insert ON public.payment_proofs;
-- DROP POLICY payment_proofs_admin_insert ON public.payment_proofs;
-- DROP FUNCTION public.current_shipowner_id();
