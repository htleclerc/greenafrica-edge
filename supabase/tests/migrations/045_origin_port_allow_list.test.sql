BEGIN;

-- 1. Allow-list key exists in app_config
DO $$
DECLARE v jsonb;
BEGIN
  SELECT value INTO v FROM public.app_config
   WHERE key='arrival.origin_port_allow_list';
  ASSERT v IS NOT NULL, 'origin_port_allow_list key missing';

  -- 2. BERBERA bucket has at least 5 variants
  ASSERT jsonb_array_length(v->'BERBERA') >= 5,
    format('BERBERA expected ≥5 variants, got %s',
           jsonb_array_length(v->'BERBERA'));

  -- 3. ZEILA bucket has at least 2 variants
  ASSERT jsonb_array_length(v->'ZEILA') >= 2,
    format('ZEILA expected ≥2 variants, got %s',
           jsonb_array_length(v->'ZEILA'));

  -- 4. Canonical name is the first variant in each bucket (matcher convention)
  ASSERT v->'BERBERA'->>0 = 'BERBERA',
    'BERBERA[0] should be canonical name';
  ASSERT v->'ZEILA'->>0 = 'ZEILA',
    'ZEILA[0] should be canonical name';
END $$;

-- 5. Idempotent: re-running INSERT ... ON CONFLICT DO NOTHING shouldn't dup
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.app_config
   WHERE key='arrival.origin_port_allow_list';
  ASSERT n = 1, format('expected 1 row, got %s', n);
END $$;

ROLLBACK;
