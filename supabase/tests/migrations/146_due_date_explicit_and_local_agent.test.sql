BEGIN;

-- 1. due_date n'est plus une colonne generee : c'est ce qui autorise un terme
--    autre que le NET-30.
DO $$
BEGIN
  ASSERT (SELECT is_generated = 'NEVER'
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'transactions'
            AND column_name = 'due_date'),
    'due_date ne doit plus etre une colonne generee';
END $$;

-- Contexte commun aux insertions de test.
CREATE TEMP TABLE t_ctx AS
  SELECT (SELECT id FROM public.vessels LIMIT 1)       AS vessel_id,
         (SELECT id FROM public.jurisdictions LIMIT 1) AS jurisdiction_id;

-- 2. Sans echeance fournie, le NET-30 est reconduit a l'identique : toute la
--    chaine d'emission existante continue sans modification.
DO $$
DECLARE c RECORD; d TIMESTAMPTZ; created TIMESTAMPTZ;
BEGIN
  SELECT * INTO c FROM t_ctx;

  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
     document_type, transaction_type, status, invoice_ref, jurisdiction_id,
     created_at)
  VALUES (c.vessel_id, 'TEST NET30', '1111111', 1, 1, 'PROFORMA', 'ENTRY_TAX',
          'PENDING', 'PRO-TEST-146-001', c.jurisdiction_id,
          '2026-08-27T09:00:00+03:00')
  RETURNING due_date, created_at INTO d, created;

  -- Fin de journee du 30e jour, en heure de Mogadiscio.
  ASSERT (d AT TIME ZONE 'Africa/Mogadishu')::date = DATE '2026-09-26',
    format('NET-30 attendu au 2026-09-26, obtenu %s', d);
END $$;

-- 3. Une echeance explicite est conservee telle quelle : c'est le terme a 15
--    jours du rappel final du 27/08, celui qu'annonce le PDF distribue.
DO $$
DECLARE c RECORD; d TIMESTAMPTZ;
BEGIN
  SELECT * INTO c FROM t_ctx;

  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
     document_type, transaction_type, status, invoice_ref, jurisdiction_id,
     created_at, due_date)
  VALUES (c.vessel_id, 'TEST 15J', '2222222', 1, 1, 'PROFORMA', 'ENTRY_TAX',
          'PENDING', 'PRO-TEST-146-002', c.jurisdiction_id,
          '2026-08-27T09:00:00+03:00', '2026-09-10T23:59:59.999+03:00')
  RETURNING due_date INTO d;

  ASSERT (d AT TIME ZONE 'Africa/Mogadishu')::date = DATE '2026-09-10',
    format('echeance explicite attendue au 2026-09-10, obtenue %s', d);
END $$;

-- 4. L'echeance est gelee apres emission. Sans ce verrou, degenerer la colonne
--    aurait ouvert une regression fiscale : la nature generee etait sa seule
--    protection (mig 089), et un FINANCE_ADMIN aurait pu repousser l'echeance
--    d'une facture deja distribuee.
DO $$
BEGIN
  BEGIN
    UPDATE public.transactions
       SET due_date = '2026-12-31T23:59:59+03:00'
     WHERE invoice_ref = 'PRO-TEST-146-002';
    ASSERT FALSE, 'le report d''une echeance emise aurait du etre refuse';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- 5. Le statut reste librement modifiable : le gel ne doit pas deborder sur
--    les colonnes que la mig 089 declare libres.
DO $$
BEGIN
  UPDATE public.transactions SET status = 'VOID' WHERE invoice_ref = 'PRO-TEST-146-002';
  ASSERT (SELECT status = 'VOID' FROM public.transactions WHERE invoice_ref = 'PRO-TEST-146-002'),
    'le statut doit rester modifiable';
END $$;

-- 6. Les colonnes de l'agent consignataire existent et acceptent la donnee du
--    dossier de production. C'est le seul canal ouvert sur les 35 dossiers
--    sans adresse connue.
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT vessel_id INTO v_id FROM t_ctx;

  UPDATE public.vessels
     SET local_agent_name    = 'AGENCE CONSIGNATAIRE FICTIVE',
         local_agent_contact = 'CONTACT FICTIF',
         local_agent_phone   = '+99 1 1004',
         registered_owner    = 'PROPRIETAIRE FICTIF',
         last_port_call_on   = DATE '2026-05-08',
         port_calls_count    = 6
   WHERE id = v_id;

  ASSERT (SELECT local_agent_name = 'AGENCE CONSIGNATAIRE FICTIVE' AND port_calls_count = 6
          FROM public.vessels WHERE id = v_id),
    'les colonnes d''agent consignataire doivent accepter la donnee du dossier';
END $$;

ROLLBACK;
