-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 070: Promote SHIPPING_AGENT profiles to active shipowners
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Portal unification Phase 1. Every legacy armateur (profiles.role='SHIPPING_AGENT')
-- without a shipowners row gets one in account_state='ACTIVE', linked by profile_id.
-- This makes the existing middleware bounce them from /dashboard/* to /owner/*, and
-- lets requireOwner admit them. We also backfill transactions.shipowner_id for their
-- vessels so /owner/invoices (RLS keyed on shipowner_id) shows their existing invoices.
-- Vessels need no backfill: their owner RLS already keys on vessels.owner_id=auth.uid().
--
-- Precise rollback: the created shipowner ids and backfilled transaction ids are
-- recorded in app_config (migration_070_*) so the DOWN reverts EXACTLY these rows.

DO $$
DECLARE
  v_created     uuid[] := '{}';
  v_backfilled  uuid[] := '{}';
  v_row         record;
BEGIN
  -- 1. Create one ACTIVE shipowner per SHIPPING_AGENT profile that lacks one.
  FOR v_row IN
    INSERT INTO public.shipowners (name, profile_id, official_email, official_email_source, account_state)
    SELECT COALESCE(p.full_name, p.email, 'Shipowner'), p.id, p.email, 'AGENT_CLAIM', 'ACTIVE'
    FROM public.profiles p
    WHERE p.role = 'SHIPPING_AGENT'
      AND NOT EXISTS (SELECT 1 FROM public.shipowners s WHERE s.profile_id = p.id)
    RETURNING id
  LOOP
    v_created := array_append(v_created, v_row.id);
  END LOOP;

  -- 2. Backfill transactions.shipowner_id for vessels owned by the newly-created
  --    owners (only NULLs; never overwrite an existing attribution).
  FOR v_row IN
    UPDATE public.transactions t
    SET shipowner_id = s.id
    FROM public.shipowners s
    JOIN public.vessels v ON v.owner_id = s.profile_id
    WHERE t.vessel_id = v.id
      AND t.shipowner_id IS NULL
      AND s.id = ANY(v_created)
    RETURNING t.id
  LOOP
    v_backfilled := array_append(v_backfilled, v_row.id);
  END LOOP;

  -- 3. Record precise rollback markers.
  INSERT INTO public.app_config (key, value)
  VALUES
    ('migration_070_created_shipowners',      to_jsonb(v_created)),
    ('migration_070_backfilled_transactions', to_jsonb(v_backfilled))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RAISE NOTICE 'mig 070: created % shipowners, backfilled % transactions',
    array_length(v_created, 1), array_length(v_backfilled, 1);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (precise revert via recorded markers):
-- DO $$
-- DECLARE v_created uuid[]; v_backfilled uuid[];
-- BEGIN
--   SELECT array(SELECT jsonb_array_elements_text(value)::uuid) INTO v_created
--     FROM public.app_config WHERE key='migration_070_created_shipowners';
--   SELECT array(SELECT jsonb_array_elements_text(value)::uuid) INTO v_backfilled
--     FROM public.app_config WHERE key='migration_070_backfilled_transactions';
--   UPDATE public.transactions SET shipowner_id = NULL WHERE id = ANY(v_backfilled);
--   DELETE FROM public.shipowners WHERE id = ANY(v_created);
--   DELETE FROM public.app_config
--     WHERE key IN ('migration_070_created_shipowners','migration_070_backfilled_transactions');
-- END $$;
-- ─────────────────────────────────────────────────────────────────────────────
