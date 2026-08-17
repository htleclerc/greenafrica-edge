BEGIN;

DO $$
BEGIN
  ASSERT (SELECT to_regclass('public.vessel_identity_candidates') IS NOT NULL),
    'la table vessel_identity_candidates doit exister';

  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vessel_identity_candidates'::regclass),
    'RLS doit être activée';

  ASSERT (SELECT COUNT(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'vessel_identity_candidates') >= 1,
    'au moins une policy RLS doit exister';
END $$;

-- un candidat valide s'insère
INSERT INTO public.vessel_identity_candidates
  (batch_label, source, imo_number, vessel_name, imported_by)
VALUES ('test.csv', 'VESSELFINDER_PORTCALLS', '7504158', 'TRUST 1', NULL);

-- le même IMO deux fois dans le même lot est refusé
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, imported_by)
    VALUES ('test.csv', 'VESSELFINDER_PORTCALLS', '7504158', 'TRUST 1 BIS', NULL);
    ASSERT FALSE, 'un IMO dupliqué dans un même lot aurait dû être refusé';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- une source hors liste est refusée
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, imported_by)
    VALUES ('test.csv', 'EQUASIS', '9235957', 'RASHA', NULL);
    ASSERT FALSE, 'une source inconnue aurait dû être refusée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- un statut hors liste est refusé
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, status, imported_by)
    VALUES ('test.csv', 'MANUAL', '9167057', 'MAYAR', 'WHATEVER', NULL);
    ASSERT FALSE, 'un statut inconnu aurait dû être refusé';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
