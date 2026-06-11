-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 084: GreenGate v8 Wedge 2 — transactional tariff version creation
--
-- The admin "new tariff version" flow must close the current open version and
-- insert its successor ATOMICALLY: two PostgREST calls leave a real corruption
-- surface (close commits + insert fails → no ACTIVE tariff → fail-closed 422
-- outage; two-admin race → uncovered window). SECURITY DEFINER RPC with
-- SELECT ... FOR UPDATE serialises concurrent versioning per logical key.
-- Auth: the server action gates roles + jurisdiction membership BEFORE calling;
-- the function additionally re-checks the caller is FINANCE_ADMIN/SUPERADMIN.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_tariff_version(
  p_jurisdiction_id UUID,
  p_mode public.transport_mode,
  p_asset_category TEXT,          -- NULL = all categories
  p_rate NUMERIC,
  p_effective_from DATE,
  p_decree_ref TEXT,
  p_actor UUID
) RETURNS TABLE (new_id UUID, closed_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_open public.tariffs%ROWTYPE;
BEGIN
  -- Defense in depth: only finance roles may version tariffs.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor
                   AND p.is_active AND p.role IN ('FINANCE_ADMIN','SUPERADMIN')) THEN
    RAISE EXCEPTION 'create_tariff_version: forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'create_tariff_version: rate must be positive';
  END IF;
  IF p_effective_from <= CURRENT_DATE THEN
    -- Strictly future: same-day versioning would re-price proformas already
    -- issued today (as_of pinning is day-granular).
    RAISE EXCEPTION 'create_tariff_version: effective_from must be strictly future' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_open FROM public.tariffs t
   WHERE t.jurisdiction_id = p_jurisdiction_id AND t.mode = p_mode
     AND t.asset_category IS NOT DISTINCT FROM p_asset_category
     AND t.status = 'ACTIVE' AND t.effective_to IS NULL
   FOR UPDATE;

  IF FOUND THEN
    IF v_open.effective_from >= p_effective_from THEN
      RAISE EXCEPTION 'create_tariff_version: an open version starting % already exists at/after %',
        v_open.effective_from, p_effective_from USING ERRCODE = 'exclusion_violation';
    END IF;
    UPDATE public.tariffs SET effective_to = p_effective_from WHERE id = v_open.id;
    closed_id := v_open.id;
  END IF;

  INSERT INTO public.tariffs (jurisdiction_id, mode, asset_category, rate_per_tco2, currency,
                              effective_from, status, decree_ref, created_by)
  VALUES (p_jurisdiction_id, p_mode, p_asset_category, p_rate, 'USD',
          p_effective_from, 'ACTIVE', p_decree_ref, p_actor)
  RETURNING id INTO new_id;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.create_tariff_version(UUID, public.transport_mode, TEXT, NUMERIC, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tariff_version(UUID, public.transport_mode, TEXT, NUMERIC, DATE, TEXT, UUID) TO service_role;
-- DOWN: DROP FUNCTION IF EXISTS public.create_tariff_version(UUID, public.transport_mode, TEXT, NUMERIC, DATE, TEXT, UUID);
