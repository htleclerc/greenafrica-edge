-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 073: GreenGate v8 — staff jurisdiction RLS filter (the Wedge-2 gate)
--
-- Adds `jurisdiction_id = ANY(public.current_jurisdiction_ids())` to the BROAD
-- staff/officer/agent "see all" SELECT clauses on the policied tenant tables, so a
-- non-SUPERADMIN staff member can only see rows in their own jurisdiction. Owner /
-- relationship clauses (current_shipowner_id, owner_id, profile_id, matched_agent_id)
-- are LEFT UNCHANGED — they are already row-scoped and inherently single-jurisdiction
-- under Model B.
--
-- current_jurisdiction_ids() (mig 071): SUPERADMIN → all jurisdictions (filter is a
-- no-op); every other staff/agent → their user_jurisdictions memberships. Mig 071
-- backfilled ALL existing non-SUPERADMIN profiles to Somaliland, so this is
-- BEHAVIOUR-PRESERVING for the current single-tenant production.
--
-- This migration rewrites SELECT policies only (the primary cross-tenant read leak).
-- Write-path jurisdiction scoping is enforced at the app layer by the TenantScopedClient
-- wrapper (which stamps jurisdiction_id on inserts and filters updates/deletes).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── transactions (mig 004 "Users see relevant transactions") ─────────────────
DROP POLICY IF EXISTS "Users see relevant transactions" ON public.transactions;
CREATE POLICY "Users see relevant transactions"
  ON public.transactions FOR SELECT
  USING (
    ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
      AND jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
    OR EXISTS (
      SELECT 1 FROM public.vessels v
       WHERE v.id = transactions.vessel_id
         AND v.owner_id = auth.uid()
    )
  );

-- ── payments (mig 058 payments_admin_select) ─────────────────────────────────
DROP POLICY IF EXISTS payments_admin_select ON public.payments;
CREATE POLICY payments_admin_select ON public.payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
         AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
    )
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

-- ── vessels (mig 004 "Shipping agents see own fleet") ────────────────────────
DROP POLICY IF EXISTS "Shipping agents see own fleet" ON public.vessels;
CREATE POLICY "Shipping agents see own fleet"
  ON public.vessels FOR SELECT
  USING (
    owner_id = auth.uid()
    OR ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
         AND jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
  );

-- ── arrival_alerts (mig 031 admin "see all" + agent UNCLAIMED broad reads) ────
DROP POLICY IF EXISTS "admins read all alerts" ON public.arrival_alerts;
CREATE POLICY "admins read all alerts"
  ON public.arrival_alerts FOR SELECT
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

DROP POLICY IF EXISTS "agents read UNCLAIMED alerts" ON public.arrival_alerts;
CREATE POLICY "agents read UNCLAIMED alerts"
  ON public.arrival_alerts FOR SELECT
  USING (
    status = 'UNCLAIMED'
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
    AND EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role = 'SHIPPING_AGENT')
  );
-- "agents read own claimed alerts" (matched_agent_id = auth.uid()) stays unchanged.

-- ── shipowners (mig 031 admin FOR ALL + agent broad read) ────────────────────
DROP POLICY IF EXISTS "admins full shipowners" ON public.shipowners;
CREATE POLICY "admins full shipowners"
  ON public.shipowners FOR ALL
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  )
  WITH CHECK (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

DROP POLICY IF EXISTS "agents read shipowners" ON public.shipowners;
CREATE POLICY "agents read shipowners"
  ON public.shipowners FOR SELECT
  USING (
    jurisdiction_id = ANY(public.current_jurisdiction_ids())
    AND EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role = 'SHIPPING_AGENT')
  );
-- "shipowner reads self" (profile_id = auth.uid()) stays unchanged.

-- DOWN: restore the pre-073 policies (without the jurisdiction filter) — see
-- migrations 004 / 031 / 058 for the original definitions.
