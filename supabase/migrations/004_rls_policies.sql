-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — Row Level Security Policies
-- Migration 004 : RLS for all domain tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: get current user's role (already created in 001)
-- public.get_user_role() returns user_role

-- ── Vessels RLS ─────────────────────────────────────────────────────────────

ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;

-- SHIPPING_AGENT: own fleet only
CREATE POLICY "Shipping agents see own fleet"
    ON public.vessels FOR SELECT
    USING (
        owner_id = auth.uid()
        OR public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    );

-- PORT_OFFICER / SUPERADMIN can insert/update vessels
CREATE POLICY "Officers can manage vessels"
    ON public.vessels FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN')
    );

CREATE POLICY "Officers can update vessels"
    ON public.vessels FOR UPDATE
    USING (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN')
    );

-- ── Vessel Positions RLS ────────────────────────────────────────────────────

ALTER TABLE public.vessel_positions ENABLE ROW LEVEL SECURITY;

-- Same visibility as vessels: shipping agents see own fleet positions
CREATE POLICY "Users see positions of visible vessels"
    ON public.vessel_positions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.vessels v
            WHERE v.id = vessel_positions.vessel_id
            AND (
                v.owner_id = auth.uid()
                OR public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
            )
        )
    );

-- System/officers can insert positions (AIS feed)
CREATE POLICY "Officers can insert positions"
    ON public.vessel_positions FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN')
    );

-- ── Transactions RLS ────────────────────────────────────────────────────────

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- SHIPPING_AGENT: own vessel transactions; others: all
CREATE POLICY "Users see relevant transactions"
    ON public.transactions FOR SELECT
    USING (
        public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
        OR EXISTS (
            SELECT 1 FROM public.vessels v
            WHERE v.id = transactions.vessel_id
            AND v.owner_id = auth.uid()
        )
    );

-- FINANCE_ADMIN / SUPERADMIN can create transactions
CREATE POLICY "Finance can create transactions"
    ON public.transactions FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    );

-- FINANCE_ADMIN / SUPERADMIN can update transactions
CREATE POLICY "Finance can update transactions"
    ON public.transactions FOR UPDATE
    USING (
        public.get_user_role() IN ('FINANCE_ADMIN', 'SUPERADMIN')
    );

-- ── Tax Configurations RLS ──────────────────────────────────────────────────

ALTER TABLE public.tax_configurations ENABLE ROW LEVEL SECURITY;

-- Everyone can read ACTIVE configs
CREATE POLICY "Anyone can read active tax configs"
    ON public.tax_configurations FOR SELECT
    USING (
        status = 'ACTIVE'
        OR public.get_user_role() IN ('FINANCE_ADMIN', 'SUPERADMIN')
    );

-- Only FINANCE_ADMIN / SUPERADMIN can write
CREATE POLICY "Finance can manage tax configs"
    ON public.tax_configurations FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('FINANCE_ADMIN', 'SUPERADMIN')
    );

CREATE POLICY "Finance can update tax configs"
    ON public.tax_configurations FOR UPDATE
    USING (
        public.get_user_role() IN ('FINANCE_ADMIN', 'SUPERADMIN')
    );

-- ── Exemptions RLS ──────────────────────────────────────────────────────────

ALTER TABLE public.exemptions ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read
CREATE POLICY "Authenticated users can read exemptions"
    ON public.exemptions FOR SELECT
    USING (
        public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
        OR EXISTS (
            SELECT 1 FROM public.vessels v
            WHERE v.id = exemptions.vessel_id
            AND v.owner_id = auth.uid()
        )
    );

-- PORT_OFFICER / SUPERADMIN can create exemptions
CREATE POLICY "Officers can create exemptions"
    ON public.exemptions FOR INSERT
    WITH CHECK (
        public.get_user_role() IN ('PORT_OFFICER', 'SUPERADMIN')
    );

-- ── Audit Logs RLS ──────────────────────────────────────────────────────────

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can insert (actions are logged automatically)
CREATE POLICY "Authenticated can insert audit logs"
    ON public.audit_logs FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- SHIPPING_AGENT: own entries only; others: all
CREATE POLICY "Users see relevant audit logs"
    ON public.audit_logs FOR SELECT
    USING (
        public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
        OR user_id = auth.uid()
    );

-- ── Carbon Projects RLS ─────────────────────────────────────────────────────

ALTER TABLE public.carbon_projects ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Authenticated can read projects"
    ON public.carbon_projects FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Only SUPERADMIN can write
CREATE POLICY "Superadmin can manage projects"
    ON public.carbon_projects FOR INSERT
    WITH CHECK (public.get_user_role() = 'SUPERADMIN');

CREATE POLICY "Superadmin can update projects"
    ON public.carbon_projects FOR UPDATE
    USING (public.get_user_role() = 'SUPERADMIN');
