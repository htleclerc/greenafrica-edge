BEGIN;

INSERT INTO public.shipowners (name, official_email, official_email_source)
VALUES ('Test VF', 'a@b.com', 'VESSELFINDER_VERIFIED');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, official_email, official_email_source)
    VALUES ('Test KO', 'c@d.com', 'SOMETHING_ELSE');
    ASSERT FALSE, 'une source inconnue aurait dû rester refusée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
