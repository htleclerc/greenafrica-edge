-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 040 : Equasis proposals RLS + source column (Plan 7 Task 0)
-- ─────────────────────────────────────────────────────────────────────────────
-- mig 030 created equasis_scrape_proposals but did NOT enable RLS or add
-- policies. With the table activated by Plan 7 it must be locked down:
--
--   - Only PORT_OFFICER / MANAGER / SUPERADMIN can SELECT (review queue)
--   - Only PORT_OFFICER / MANAGER / SUPERADMIN can UPDATE (apply / reject)
--   - INSERT is service_role only (worker writes via the service key,
--     manual entry server actions also use service_role to bypass RLS).
--     We deliberately omit an INSERT policy so that any non-service-role
--     attempt (anon, agent, owner, …) is denied.
--
-- Also adds a `source` column ('manual' | 'fixture' | 'scraper') so the
-- review UI can show provenance, and a CHECK constraint preventing the
-- "applied=true with no reviewer" hole that mig 030 left open.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. source column ──────────────────────────────────────────────────────
ALTER TABLE public.equasis_scrape_proposals
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'fixture', 'scraper'));

COMMENT ON COLUMN public.equasis_scrape_proposals.source IS
  'Provenance of the proposal. ''manual'' = port officer paste; ''fixture'' = local HTML test fixtures (dev/CI); ''scraper'' = real Equasis fetch (gated by feature.equasis_scraper_enabled).';

-- ── 2. applied invariant ──────────────────────────────────────────────────
-- mig 030 allowed applied=true with reviewed_by/reviewed_at NULL. That's a
-- hole — applying a proposal MUST stamp who did it and when.
ALTER TABLE public.equasis_scrape_proposals
  ADD CONSTRAINT equasis_proposals_applied_requires_reviewer
    CHECK (
      applied = FALSE
      OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    );

-- ── 3. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.equasis_scrape_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "officers read equasis proposals"
  ON public.equasis_scrape_proposals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND role IN ('PORT_OFFICER', 'MANAGER', 'SUPERADMIN')
  ));

CREATE POLICY "officers resolve equasis proposals"
  ON public.equasis_scrape_proposals FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND role IN ('PORT_OFFICER', 'MANAGER', 'SUPERADMIN')
  ));

-- No INSERT policy — service_role (worker, server actions) bypasses RLS.
-- Anon, agents, owners, finance — none can write. Defence in depth.

-- ── DOWN ──────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "officers read equasis proposals" ON public.equasis_scrape_proposals;
-- DROP POLICY IF EXISTS "officers resolve equasis proposals" ON public.equasis_scrape_proposals;
-- ALTER TABLE public.equasis_scrape_proposals DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.equasis_scrape_proposals
--   DROP CONSTRAINT IF EXISTS equasis_proposals_applied_requires_reviewer,
--   DROP COLUMN IF EXISTS source;
