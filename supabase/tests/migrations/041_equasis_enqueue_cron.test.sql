BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 041 tests — Equasis enqueue cron + function
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Function exists with the right signature
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'equasis_enqueue_pending'
  ), 'equasis_enqueue_pending function missing';
END $$;

-- 2. Cron entry registered
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM cron.job
   WHERE jobname = 'equasis-enqueue';
  ASSERT n = 1, format('expected exactly 1 equasis-enqueue cron job, got %s', n);
END $$;

-- 3. Function no-ops when feature flag is OFF
DO $$
DECLARE
  v_was_enabled BOOLEAN;
  v_count INT;
BEGIN
  SELECT (value #>> '{}')::boolean INTO v_was_enabled
    FROM public.app_config WHERE key = 'feature.equasis_scraper_enabled';

  -- Force OFF
  UPDATE public.app_config
     SET value = 'false'::jsonb
   WHERE key = 'feature.equasis_scraper_enabled';

  SELECT public.equasis_enqueue_pending() INTO v_count;
  ASSERT v_count = 0, format('expected 0 enqueued when flag OFF, got %s', v_count);

  -- Restore
  UPDATE public.app_config
     SET value = COALESCE(to_jsonb(v_was_enabled), 'false'::jsonb)
   WHERE key = 'feature.equasis_scraper_enabled';
END $$;

-- 4. SECURITY DEFINER set so service_role can invoke through RLS-bound paths
DO $$
DECLARE prosec BOOLEAN;
BEGIN
  SELECT prosecdef INTO prosec
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'equasis_enqueue_pending';
  ASSERT prosec = TRUE, 'equasis_enqueue_pending should be SECURITY DEFINER';
END $$;

ROLLBACK;
