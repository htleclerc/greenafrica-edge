-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032 : RPC — alert_distance_final_nm
-- Sums haversine segments across vessel_positions between EEZ entry (arrived_at)
-- and EEZ exit (departed_eez_at) for a given arrival_alert. Returned unit: NM.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.alert_distance_final_nm(p_alert_id UUID)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH alert AS (
    SELECT vessel_id, arrived_at, departed_eez_at
      FROM public.arrival_alerts
     WHERE id = p_alert_id
       AND arrived_at IS NOT NULL
       AND departed_eez_at IS NOT NULL
  ),
  points AS (
    SELECT
      vp.lat,
      vp.lng,
      ROW_NUMBER() OVER (ORDER BY vp.recorded_at) AS rn
    FROM public.vessel_positions vp
    JOIN alert a
      ON vp.vessel_id = a.vessel_id
     AND vp.recorded_at >= a.arrived_at
     AND vp.recorded_at <= a.departed_eez_at
  ),
  segments AS (
    SELECT
      p1.lat AS lat1, p1.lng AS lng1,
      p2.lat AS lat2, p2.lng AS lng2
    FROM points p1
    JOIN points p2 ON p2.rn = p1.rn + 1
  )
  SELECT COALESCE(SUM(
    -- Haversine in NM: R_earth_nm * 2 * asin(sqrt(a))
    3440.065 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(lat2 - lat1) / 2), 2)
      + COS(RADIANS(lat1)) * COS(RADIANS(lat2))
        * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
    ))
  ), 0)
  FROM segments;
$$;

COMMENT ON FUNCTION public.alert_distance_final_nm IS
  'Compute total nautical miles transited inside the EEZ for a reconciled alert, summing haversine segments between vessel positions ordered by recorded_at.';
