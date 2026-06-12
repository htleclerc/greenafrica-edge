-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 087: GreenGate Wedge 4 — money-rail jurisdiction RLS net
--
-- DEFENSE-IN-DEPTH: wallets / wallet_ledger / refunds / owner_notifications all
-- had RLS ENABLED (migs 050/052/053) but ZERO policies. The TenantScopedClient
-- wrapper was the SOLE guard against cross-jurisdiction money leaks. One forgotten
-- platform-client read = data leak with no DB backstop.
--
-- mig 072 added jurisdiction_id NOT NULL to all four tables. This migration adds
-- the missing DB-layer policies. ADDITIVE — service-role bypasses RLS entirely,
-- so all existing server-action write paths are unaffected.
--
-- INSERT / UPDATE / DELETE intentionally have no policies on these tables: writes
-- stay service-role-only (TenantScopedClient). The policies below guard SELECT only.
--
-- ALSO: webhook idempotency backstop on payments (carried from Wedge-4 T2 review):
-- a partial UNIQUE index on external_reference for MOBILE_MONEY + THIRD_PARTY rails.
-- Refs are namespaced '<provider>:<id>' since W4-T2. Stripe keeps its own rail-scoped
-- partial index (mig 063) and is excluded from this one.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── public.wallets ───────────────────────────────────────────────────────────

-- Staff (admin / officer) sees wallets in their jurisdiction(s) only.
CREATE POLICY wallets_staff_select ON public.wallets FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

-- Shipowner sees their own wallet only.
CREATE POLICY wallets_owner_select ON public.wallets FOR SELECT
  TO authenticated
  USING (shipowner_id = public.current_shipowner_id());

-- ── public.wallet_ledger ─────────────────────────────────────────────────────

-- Staff sees ledger entries for wallets in their jurisdiction(s) only.
CREATE POLICY wallet_ledger_staff_select ON public.wallet_ledger FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

-- Shipowner sees ledger entries for their own wallet only.
CREATE POLICY wallet_ledger_owner_select ON public.wallet_ledger FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.wallets w
       WHERE w.id = wallet_ledger.wallet_id
         AND w.shipowner_id = public.current_shipowner_id()
    )
  );

-- ── public.refunds ───────────────────────────────────────────────────────────

-- Staff sees refunds in their jurisdiction(s) only.
CREATE POLICY refunds_staff_select ON public.refunds FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

-- Shipowner sees their own refunds only.
CREATE POLICY refunds_owner_select ON public.refunds FOR SELECT
  TO authenticated
  USING (shipowner_id = public.current_shipowner_id());

-- ── public.owner_notifications ───────────────────────────────────────────────

-- Staff sees notifications in their jurisdiction(s) only.
CREATE POLICY owner_notifications_staff_select ON public.owner_notifications FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

-- Shipowner sees their own notifications only.
CREATE POLICY owner_notifications_owner_select ON public.owner_notifications FOR SELECT
  TO authenticated
  USING (shipowner_id = public.current_shipowner_id());

-- ── payments: webhook idempotency uniqueness (W4-T2) ────────────────────────

-- Webhook idempotency backstop: refs are namespaced '<provider>:<id>' (W4-T2);
-- Stripe keeps its own rail-scoped partial index (mig 063).
CREATE UNIQUE INDEX IF NOT EXISTS payments_external_ref_unique
  ON public.payments(external_reference)
  WHERE external_reference IS NOT NULL AND rail IN ('MOBILE_MONEY', 'THIRD_PARTY');

COMMENT ON INDEX public.payments_external_ref_unique IS
  'W4: webhook idempotency backstop for MOBILE_MONEY + THIRD_PARTY rails. refs are namespaced <provider>:<id>. Stripe excluded (mig 063 has its own partial index).';

-- DOWN:
-- DROP POLICY owner_notifications_owner_select ON public.owner_notifications;
-- DROP POLICY owner_notifications_staff_select ON public.owner_notifications;
-- DROP POLICY refunds_owner_select ON public.refunds;
-- DROP POLICY refunds_staff_select ON public.refunds;
-- DROP POLICY wallet_ledger_owner_select ON public.wallet_ledger;
-- DROP POLICY wallet_ledger_staff_select ON public.wallet_ledger;
-- DROP POLICY wallets_owner_select ON public.wallets;
-- DROP POLICY wallets_staff_select ON public.wallets;
-- DROP INDEX IF EXISTS public.payments_external_ref_unique;
