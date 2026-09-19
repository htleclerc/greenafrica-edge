-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 162: tighten payments admin RLS.
-- Before: payments_admin_insert had no row constraint; payments_admin_update
-- gated only on role (no WITH CHECK). A FINANCE_ADMIN's own JWT could write any
-- payment in any jurisdiction via direct PostgREST, bypassing the server-action
-- gates (can_confirm_payment, assertAdminCanActOn).
-- After: all admin UPDATEs go through the service-role client (no authenticated
-- UPDATE path remains), so payments_admin_update is dropped. The one remaining
-- authenticated-admin writer (recordManualPayment) only INSERTs INITIATED /
-- CONFIRMED rows, so payments_admin_insert is scoped to the admin's own
-- jurisdiction and to those two statuses.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS payments_admin_update ON public.payments;

DROP POLICY IF EXISTS payments_admin_insert ON public.payments;
CREATE POLICY payments_admin_insert ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.is_active = true
         AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
    )
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
    AND status IN ('INITIATED', 'CONFIRMED')
  );

-- DOWN:
-- DROP POLICY payments_admin_insert ON public.payments;
-- CREATE POLICY payments_admin_insert ON public.payments FOR INSERT TO authenticated
--   WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
--     AND p.is_active = true AND p.role IN ('FINANCE_ADMIN','SUPERADMIN')));
-- CREATE POLICY payments_admin_update ON public.payments FOR UPDATE TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
--     AND p.is_active = true AND p.role IN ('FINANCE_ADMIN','SUPERADMIN')));
