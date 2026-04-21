-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020 : Add MANAGER role (platform sub-admin, ops-only)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- MANAGER is a sub-admin role that can run day-to-day platform operations
-- (vessels, alerts, validations, registrations, audit-read) but explicitly
-- CANNOT touch the money rail (tax-settings, revenue, payments, mark-paid)
-- nor RBAC settings (user creation, role edits).
--
-- Principle: "no money, no RBAC" — least privilege for daily-ops staff.
--
-- This migration:
--   1. Extends user_role enum with MANAGER (additive, non-transactional in PG12+)
--   2. Extends RLS policies to grant MANAGER read+write on ops tables
--      (vessels, vessel_positions, registration_requests)
--   3. Does NOT grant MANAGER any access to transactions, payment_config,
--      app_config, or any money-rail table — those policies stay unchanged.
--
-- Rollback strategy: feature flag `NEXT_PUBLIC_FEATURE_MANAGER_ROLE=false`
-- in env keeps MANAGER invisible in UI. Postgres enum values cannot be
-- removed cleanly — they stay in the type permanently, harmless if no
-- profile carries the value.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extend user_role enum ───────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE is non-transactional in PG12+ but safe here:
-- no existing row carries this value yet.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'MANAGER';

-- The public.get_user_role() helper from migration 001 returns user_role —
-- it transparently picks up the new value, no change needed.

-- ── RLS: vessels (MANAGER reads + writes, like PORT_OFFICER) ────────────────
DROP POLICY IF EXISTS "Officers can manage vessels" ON public.vessels;
CREATE POLICY "Officers and managers can manage vessels"
    ON public.vessels FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN', 'MANAGER')
    );

DROP POLICY IF EXISTS "Officers can update vessels" ON public.vessels;
CREATE POLICY "Officers and managers can update vessels"
    ON public.vessels FOR UPDATE
    USING (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN', 'MANAGER')
    );

-- The SELECT policy already permits MANAGER implicitly via the
-- "Shipping agents see own fleet" policy (which grants visibility to anyone
-- not in PORT_OFFICER/FINANCE_ADMIN/SUPERADMIN only if owner_id matches).
-- We need a separate SELECT grant for MANAGER to see all vessels:
DROP POLICY IF EXISTS "Shipping agents see own fleet" ON public.vessels;
CREATE POLICY "Vessel SELECT — agents see own, staff see all"
    ON public.vessels FOR SELECT
    USING (
        owner_id = auth.uid()
        OR public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER')
    );

-- ── RLS: vessel_positions (MANAGER write for AIS feed maintenance) ──────────
DROP POLICY IF EXISTS "Officers can insert positions" ON public.vessel_positions;
CREATE POLICY "Officers and managers can insert positions"
    ON public.vessel_positions FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN', 'MANAGER')
    );

DROP POLICY IF EXISTS "Users see positions of visible vessels" ON public.vessel_positions;
CREATE POLICY "Position SELECT — agents see own fleet, staff see all"
    ON public.vessel_positions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.vessels v
            WHERE v.id = vessel_positions.vessel_id
            AND (
                v.owner_id = auth.uid()
                OR public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER')
            )
        )
    );

-- ── RLS: registration_requests (MANAGER reads + approves) ───────────────────
-- MANAGER joins PORT_OFFICER and SUPERADMIN as approvers (per RBAC matrix).
DROP POLICY IF EXISTS "Admins can read all registrations" ON public.registration_requests;
CREATE POLICY "Admins and managers can read all registrations"
    ON public.registration_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.role IN ('SUPERADMIN', 'PORT_OFFICER', 'MANAGER')
        )
    );

DROP POLICY IF EXISTS "Admins can update registrations" ON public.registration_requests;
CREATE POLICY "Admins and managers can update registrations"
    ON public.registration_requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.role IN ('SUPERADMIN', 'PORT_OFFICER', 'MANAGER')
        )
    );

-- ── RLS: transactions (MANAGER stays EXCLUDED — money rail) ─────────────────
-- No policy change. MANAGER intentionally cannot insert/update/select
-- transactions outside its own (which is empty since MANAGER doesn't own
-- vessels). The "Finance can create transactions" policy and similar stay
-- limited to PORT_OFFICER/FINANCE_ADMIN/SUPERADMIN.

-- ── Documentation ───────────────────────────────────────────────────────────
COMMENT ON TYPE public.user_role IS
    'Platform roles. MANAGER added in migration 020 — sub-admin for ops, '
    'no money-rail access (no transactions, no payment_config, no tax-settings).';
