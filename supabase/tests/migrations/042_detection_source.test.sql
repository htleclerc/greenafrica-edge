BEGIN;

-- 1. detection_source enum exists with the 3 expected values
DO $$
BEGIN
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='detection_source' AND e.enumlabel='CORRIDOR_500NM')),
    'CORRIDOR_500NM enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='detection_source' AND e.enumlabel='ORIGINPORT')),
    'ORIGINPORT enum value missing';
  ASSERT (SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname='detection_source' AND e.enumlabel='NOA')),
    'NOA enum value missing';
END $$;

-- 2. arrival_alerts has the new column with NOT NULL + default
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='arrival_alerts'
       AND column_name='detection_source'
       AND is_nullable='NO'
       AND column_default LIKE '%CORRIDOR_500NM%'
  ), 'detection_source column missing or wrong default';
END $$;

-- 3. corridor-specific columns are now nullable
DO $$
DECLARE col text;
BEGIN
  FOR col IN SELECT unnest(ARRAY['detected_lat','detected_lng',
                                 'distance_to_port_nm','estimated_route_nm']) LOOP
    ASSERT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='arrival_alerts'
         AND column_name=col AND is_nullable='YES'
    ), format('column %I not nullable', col);
  END LOOP;
END $$;

-- 4. originport unclaimed index exists
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND indexname='arrival_alerts_originport_unclaimed_idx'
  ), 'originport_unclaimed index missing';
END $$;

-- 5. Backfill: any historical row has detection_source set (default applies)
DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM public.arrival_alerts
          WHERE detection_source IS NULL) = 0,
    'detection_source has NULLs after migration';
END $$;

ROLLBACK;
