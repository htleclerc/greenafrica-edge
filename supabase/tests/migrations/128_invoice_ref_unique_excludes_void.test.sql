BEGIN;

-- 1. L'index doit être devenu partiel sur le statut.
DO $$
BEGIN
  ASSERT (SELECT to_regclass('public.idx_txn_invoice_ref') IS NOT NULL),
    'idx_txn_invoice_ref doit exister';

  ASSERT (SELECT indexdef LIKE '%<> ''VOID''%'
          FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_txn_invoice_ref'),
    'idx_txn_invoice_ref doit exclure les lignes VOID';
END $$;

-- Un navire et une juridiction de reference pour les insertions de test.
CREATE TEMP TABLE t_ctx AS
  SELECT (SELECT id FROM public.vessels LIMIT 1)       AS vessel_id,
         (SELECT id FROM public.jurisdictions LIMIT 1) AS jurisdiction_id;

-- 2. Deux lignes VIVANTES de meme invoice_ref restent refusees : c'est la
--    garde qui empeche qu'une reference designe deux factures a la fois.
DO $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM t_ctx;

  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
     document_type, transaction_type, status, invoice_ref, jurisdiction_id)
  VALUES (c.vessel_id, 'TEST A', '1111111', 1, 1, 'PROFORMA', 'ENTRY_TAX',
          'PENDING', 'PRO-TEST-000001', c.jurisdiction_id);

  BEGIN
    INSERT INTO public.transactions
      (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
       document_type, transaction_type, status, invoice_ref, jurisdiction_id)
    VALUES (c.vessel_id, 'TEST B', '2222222', 1, 1, 'PROFORMA', 'ENTRY_TAX',
            'PENDING', 'PRO-TEST-000001', c.jurisdiction_id);
    ASSERT FALSE, 'deux lignes vivantes de meme invoice_ref auraient du etre refusees';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- 3. Une fois la premiere ANNULEE, la reference redevient disponible : c'est
--    exactement la rebascule du livre du 19/08/2026. invoice_ref est en
--    ecriture unique et DELETE est interdit, donc VOID est le seul levier.
DO $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM t_ctx;

  UPDATE public.transactions SET status = 'VOID'
   WHERE invoice_ref = 'PRO-TEST-000001';

  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
     document_type, transaction_type, status, invoice_ref, jurisdiction_id)
  VALUES (c.vessel_id, 'TEST B', '2222222', 1, 1, 'PROFORMA', 'ENTRY_TAX',
          'PENDING', 'PRO-TEST-000001', c.jurisdiction_id);

  ASSERT (SELECT COUNT(*) FROM public.transactions
           WHERE invoice_ref = 'PRO-TEST-000001') = 2,
    'la ligne annulee et la nouvelle doivent coexister';

  ASSERT (SELECT COUNT(*) FROM public.transactions
           WHERE invoice_ref = 'PRO-TEST-000001' AND status <> 'VOID') = 1,
    'une seule ligne vivante doit porter la reference';
END $$;

-- 4. invoice_ref reste en ecriture unique : la mig 128 ne relache QUE
--    l'unicite, pas l'immuabilite. Sans quoi on pourrait renumeroter une
--    facture distribuee.
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET invoice_ref = 'PRO-TEST-999999'
     WHERE invoice_ref = 'PRO-TEST-000001' AND status <> 'VOID';
    ASSERT FALSE, 'invoice_ref doit rester en ecriture unique';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE '%first-write-only%',
      'l''erreur attendue est celle de la mig 089, obtenu : ' || SQLERRM;
  END;
END $$;

-- 5. DELETE reste interdit : la rebascule annule, elle ne supprime jamais.
DO $$
BEGIN
  BEGIN
    DELETE FROM public.transactions WHERE invoice_ref = 'PRO-TEST-000001';
    ASSERT FALSE, 'DELETE sur transactions doit rester interdit';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE '%DELETE forbidden%',
      'l''erreur attendue est celle de la mig 089, obtenu : ' || SQLERRM;
  END;
END $$;

ROLLBACK;
