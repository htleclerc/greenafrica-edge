BEGIN;

-- L'index total de la 115 doit avoir disparu au profit de l'index partiel.
DO $$
BEGIN
  ASSERT (SELECT to_regclass('public.idx_vic_batch_imo') IS NULL),
    'l''index unique total idx_vic_batch_imo doit avoir été remplacé';

  ASSERT (SELECT to_regclass('public.idx_vic_batch_imo_pending') IS NOT NULL),
    'l''index unique partiel idx_vic_batch_imo_pending doit exister';

  ASSERT (SELECT indexdef LIKE '%WHERE (status = ''PENDING''::text)%'
          FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_vic_batch_imo_pending'),
    'l''index doit être partiel, restreint aux candidats PENDING';
END $$;

-- Deux candidats PENDING de même (lot, IMO) restent refusés : c'est la garde
-- qui empêche le redépôt du même export d'escales.
INSERT INTO public.vessel_identity_candidates
  (batch_label, source, imo_number, vessel_name, imported_by)
VALUES ('portcalls.csv', 'VESSELFINDER_PORTCALLS', '7504158', 'TRUST 1', NULL);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, imported_by)
    VALUES ('portcalls.csv', 'VESSELFINDER_PORTCALLS', '7504158', 'TRUST 1 BIS', NULL);
    ASSERT FALSE, 'un IMO dupliqué parmi les candidats PENDING aurait dû être refusé';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- Une fois le premier candidat sorti de PENDING, une nouvelle saisie du même
-- IMO redevient possible : c'est exactement la correction de faute de frappe
-- que l'index total interdisait à vie.
INSERT INTO public.vessel_identity_candidates
  (batch_label, source, imo_number, vessel_name, status, imported_by)
VALUES ('saisie-manuelle-9424223', 'MANUAL', '9424223', 'NYALA', 'REJECTED', NULL);

INSERT INTO public.vessel_identity_candidates
  (batch_label, source, imo_number, vessel_name, imported_by)
VALUES ('saisie-manuelle-9424223', 'MANUAL', '9424223', 'NYALA STAR', NULL);

DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM public.vessel_identity_candidates
          WHERE batch_label = 'saisie-manuelle-9424223') = 2,
    'la saisie corrigée doit coexister avec la saisie rejetée';
END $$;

ROLLBACK;
