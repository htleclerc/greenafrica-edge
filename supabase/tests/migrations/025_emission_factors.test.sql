BEGIN;

-- Enum emission_factor_source
DO $$ BEGIN
  ASSERT (SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
           WHERE t.typname='emission_factor_source')
         = ARRAY['EU_MRV','IMO_CATEGORY','FALLBACK'],
    'emission_factor_source enum missing or wrong';
END $$;

-- Table
DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name='emission_factors' AND table_schema='public'),
    'emission_factors table missing';
END $$;

-- CHECK constraint: EU_MRV requires imo_number
DO $$ BEGIN
  BEGIN
    INSERT INTO public.emission_factors (source, grams_co2_per_nm)
    VALUES ('EU_MRV', 100);
    RAISE EXCEPTION 'check constraint should reject EU_MRV without imo_number';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.emission_factors (source, grams_co2_per_nm)
    VALUES ('IMO_CATEGORY', 100);
    RAISE EXCEPTION 'check constraint should reject IMO_CATEGORY without vessel_category';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END $$;

-- Seeds
DO $$ BEGIN
  ASSERT (SELECT COUNT(*) FROM public.emission_factors WHERE source='IMO_CATEGORY') >= 6,
    'IMO_CATEGORY seeds missing (expected 6+)';
  ASSERT (SELECT COUNT(*) FROM public.emission_factors WHERE source='FALLBACK') = 1,
    'FALLBACK seed missing or duplicated';
END $$;

-- Cascade lookup query: insert EU_MRV row for IMO 1234567 then verify priority
DO $$
DECLARE v_result UUID;
BEGIN
  INSERT INTO public.emission_factors (source, imo_number, grams_co2_per_nm)
  VALUES ('EU_MRV', '1234567', 50000);

  -- Simulate cascade: prefer EU_MRV for this IMO
  SELECT id INTO v_result
    FROM public.emission_factors
   WHERE active = TRUE
     AND (
       (source = 'EU_MRV' AND imo_number = '1234567') OR
       (source = 'IMO_CATEGORY' AND vessel_category = 'CARGO'
         AND 10000 BETWEEN COALESCE(gt_min,0) AND COALESCE(gt_max,9999999)) OR
       (source = 'FALLBACK')
     )
   ORDER BY CASE source WHEN 'EU_MRV' THEN 1 WHEN 'IMO_CATEGORY' THEN 2 ELSE 3 END
   LIMIT 1;

  ASSERT (SELECT source::text FROM public.emission_factors WHERE id = v_result) = 'EU_MRV',
    'cascade should have picked EU_MRV for matching IMO';
END $$;

ROLLBACK;
