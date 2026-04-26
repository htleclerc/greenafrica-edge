-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 033 : SHIPOWNER read policies (follow-up from Plan 1 review)
-- ─────────────────────────────────────────────────────────────────────────────
-- A shipowner with a portal account (profile.role = SHIPOWNER and
-- shipowners.profile_id = auth.uid()) should see alerts and transactions
-- attached to their own vessels.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE POLICY "shipowner reads own vessel alerts"
  ON public.arrival_alerts FOR SELECT
  USING (EXISTS (
    SELECT 1
      FROM public.vessels v
      JOIN public.shipowners s ON s.id = v.shipowner_id
     WHERE v.id = arrival_alerts.vessel_id
       AND s.profile_id = auth.uid()
  ));

CREATE POLICY "shipowner reads own transactions"
  ON public.transactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipowners s
     WHERE s.id = transactions.shipowner_id
       AND s.profile_id = auth.uid()
  ));
