BEGIN;

INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'NotifOwner');

DO $$
DECLARE nid UUID;
BEGIN
  -- 1. Happy path
  INSERT INTO public.owner_notifications (shipowner_id, kind, title_key, body_key, deep_link)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
          'PROFORMA_ISSUED',
          'OwnerNotifications.proforma_issued.title',
          'OwnerNotifications.proforma_issued.body',
          '/owner/invoices')
  RETURNING id INTO nid;

  -- 2. body_params JSONB defaults to {}
  PERFORM 1 FROM public.owner_notifications
    WHERE id = nid AND body_params = '{}'::jsonb;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: body_params not default empty';
  END IF;

  -- 3. Mark as read
  UPDATE public.owner_notifications SET read_at = NOW() WHERE id = nid;
  PERFORM 1 FROM public.owner_notifications WHERE id = nid AND read_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: read_at update failed';
  END IF;

  -- 4. Cascade delete on shipowner removal
  DELETE FROM public.shipowners WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  PERFORM 1 FROM public.owner_notifications WHERE shipowner_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: notifications not cascaded';
  END IF;
END $$;

ROLLBACK;
SELECT '053 owner notifications: PASS' AS test_result;
