-- Gardes du teaser public : la projection ne fuit rien, et un armateur de
-- regroupement n'ouvre jamais le rattachement par code.
BEGIN;

DO $$
DECLARE
  v_vessel UUID;
  v_owner  UUID;
  v_ghost  UUID;
  r        RECORD;
  n        INT;
BEGIN
  -- ── G1 : la projection ne contient aucun champ financier ni nominatif ──────
  SELECT COUNT(*) INTO n
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'vessel_payment_teaser'
    AND column_name IN (
      'tax_amount_usd', 'amount_usd', 'invoice_ref', 'owner_name',
      'official_email', 'shipowner_id', 'partial_paid_usd'
    );
  ASSERT n = 0,
    'G1 VIOLÉE : vessel_payment_teaser expose un champ financier ou nominatif';

  -- ── Fixture : navire + armateur réel avec e-mail ──────────────────────────
  INSERT INTO public.shipowners (name, account_state, official_email, official_email_source)
  VALUES ('Test Owner Claimable', 'GHOST', 'ops@test-owner.example', 'AGENT_CLAIM')
  RETURNING id INTO v_owner;

  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status, port_call
  ) VALUES ('111000111', '1110001', 'MV TEASER TEST', 'TSR1', 'SO', 'CARGO',
            40000, 15000, 13.0, 'APPROACHING', 'Berbera')
  RETURNING id INTO v_vessel;

  -- transaction_type : CARBON_TAX n'existe pas dans public.transaction_type
  -- (voir 003_core_domain_tables.sql : ENTRY_TAX, TRANSIT_FEE, PORT_STAY).
  -- ENTRY_TAX retenue ici, le test ne porte pas sur ce champ.
  INSERT INTO public.transactions (
    vessel_id, vessel_name, vessel_imo, transaction_type,
    emissions_tco2, tax_amount_usd, status, shipowner_id
  ) VALUES (v_vessel, 'MV TEASER TEST', '1110001', 'ENTRY_TAX',
            100.00, 12400.00, 'PENDING', v_owner);

  -- Recherche par IMO
  SELECT * INTO r FROM public.vessel_payment_teaser('1110001');
  ASSERT r.vessel_name = 'MV TEASER TEST', 'le navire doit être trouvé par IMO';
  ASSERT r.outstanding_count = 1, 'un avis PENDING doit être compté';
  ASSERT r.has_overdue = FALSE, 'aucun avis échu attendu';
  ASSERT r.claimable = TRUE, 'AGENT_CLAIM ouvre l''accès direct (décision PO)';

  -- Recherche par MMSI — même résultat
  SELECT * INTO r FROM public.vessel_payment_teaser('111000111');
  ASSERT r.imo_number = '1110001', 'le navire doit être trouvé par MMSI';

  -- ── G2 : un armateur placeholder n'est jamais claimable, MÊME avec e-mail ──
  -- C'est ce cas qui distingue la garde intentionnelle de la coïncidence de
  -- données : on renseigne délibérément une adresse sur le placeholder.
  INSERT INTO public.shipowners (name, account_state, official_email, is_placeholder)
  VALUES ('À identifier - test', 'GHOST', 'fourre-tout@example.org', TRUE)
  RETURNING id INTO v_ghost;

  UPDATE public.transactions SET shipowner_id = v_ghost WHERE vessel_id = v_vessel;

  SELECT * INTO r FROM public.vessel_payment_teaser('1110001');
  ASSERT r.claimable = FALSE,
    'G2 VIOLÉE : un armateur is_placeholder ouvre le rattachement par code';

  -- ── Navire inconnu : zéro ligne ───────────────────────────────────────────
  SELECT COUNT(*) INTO n FROM public.vessel_payment_teaser('0000000');
  ASSERT n = 0, 'un identifiant inconnu doit retourner zéro ligne';

  -- ── Backfill : le placeholder du seed est marqué ──────────────────────────
  SELECT COUNT(*) INTO n
  FROM public.shipowners
  WHERE name ILIKE 'À identifier%' AND is_placeholder = FALSE;
  ASSERT n = 0, 'le backfill a manqué une ligne « À identifier »';

  RAISE NOTICE 'mig 118 : toutes les assertions passent';
END $$;

ROLLBACK;
