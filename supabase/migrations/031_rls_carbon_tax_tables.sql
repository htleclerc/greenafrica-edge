-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 : RLS policies for carbon tax tables + SHIPOWNER role
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'SHIPOWNER';

-- Helper function: is caller admin?
CREATE OR REPLACE FUNCTION public.is_admin_or_officer()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.role IN ('SUPERADMIN','PORT_OFFICER','FINANCE_ADMIN','MANAGER')
  );
$$;

-- ── arrival_alerts ─────────────────────────────────────────────────────────
ALTER TABLE public.arrival_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read all alerts"
  ON public.arrival_alerts FOR SELECT
  USING (public.is_admin_or_officer());

CREATE POLICY "agents read UNCLAIMED alerts"
  ON public.arrival_alerts FOR SELECT
  USING (
    status = 'UNCLAIMED'
    AND EXISTS (SELECT 1 FROM public.profiles p
                 WHERE p.id = auth.uid() AND p.role = 'SHIPPING_AGENT')
  );

CREATE POLICY "agents read own claimed alerts"
  ON public.arrival_alerts FOR SELECT
  USING (matched_agent_id = auth.uid());

CREATE POLICY "admins write all alerts"
  ON public.arrival_alerts FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

-- ── shipowners ─────────────────────────────────────────────────────────────
ALTER TABLE public.shipowners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full shipowners"
  ON public.shipowners FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

CREATE POLICY "agents read shipowners"
  ON public.shipowners FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles p
             WHERE p.id = auth.uid() AND p.role = 'SHIPPING_AGENT')
  );

CREATE POLICY "shipowner reads self"
  ON public.shipowners FOR SELECT
  USING (profile_id = auth.uid());

-- ── owner_agent_mappings ───────────────────────────────────────────────────
ALTER TABLE public.owner_agent_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full mappings"
  ON public.owner_agent_mappings FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

CREATE POLICY "agent reads own mappings"
  ON public.owner_agent_mappings FOR SELECT
  USING (agent_profile_id = auth.uid());

-- ── emission_factors ───────────────────────────────────────────────────────
ALTER TABLE public.emission_factors ENABLE ROW LEVEL SECURITY;

-- Public read is fine: these are reference data.
CREATE POLICY "anyone reads factors"
  ON public.emission_factors FOR SELECT
  USING (TRUE);

CREATE POLICY "admins write factors"
  ON public.emission_factors FOR INSERT
  WITH CHECK (public.is_admin_or_officer());

CREATE POLICY "admins update factors"
  ON public.emission_factors FOR UPDATE
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

-- ── equasis_scrape_proposals (dormant, admin-only) ─────────────────────────
ALTER TABLE public.equasis_scrape_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins full scrape proposals"
  ON public.equasis_scrape_proposals FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());
