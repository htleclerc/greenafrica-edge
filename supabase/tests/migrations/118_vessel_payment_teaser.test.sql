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
  --
  -- created_at explicite : la mig 089 rend shipowner_id first-write-only
  -- (BEFORE UPDATE sur transactions), donc le cas G2 ci-dessous ne peut plus
  -- re-pointer cette ligne — il insère une DEUXIÈME transaction plus récente
  -- à la place. La RPC résout par ORDER BY created_at DESC LIMIT 1 ; fixer
  -- created_at ici rend « plus récent » déterministe plutôt que dépendant de
  -- la résolution de l'horloge entre deux INSERT successifs.
  INSERT INTO public.transactions (
    vessel_id, vessel_name, vessel_imo, transaction_type,
    emissions_tco2, tax_amount_usd, status, shipowner_id, created_at
  ) VALUES (v_vessel, 'MV TEASER TEST', '1110001', 'ENTRY_TAX',
            100.00, 12400.00, 'PENDING', v_owner, NOW() - INTERVAL '1 hour');

  -- Recherche par IMO
  SELECT * INTO r FROM public.vessel_payment_teaser('1110001');
  ASSERT r.vessel_name = 'MV TEASER TEST', 'le navire doit être trouvé par IMO';
  ASSERT r.outstanding_count = 1, 'un avis PENDING doit être compté';
  ASSERT r.has_overdue = FALSE, 'aucun avis échu attendu';
  ASSERT r.claimable = TRUE, 'AGENT_CLAIM ouvre l''accès direct (décision PO)';

  -- ── G1 : la projection ne contient aucun champ financier ni nominatif ──────
  -- Vérifiée sur la ligne RÉELLEMENT produite par la RPC, pas sur
  -- information_schema.columns : une fonction RETURNS TABLE n'enregistre
  -- aucune ligne dans ce catalogue (ses colonnes de sortie vivent dans
  -- pg_proc.proallargtypes/proargmodes/proargnames), donc un filtre
  -- information_schema ne matche jamais rien et ne garde rien. row_to_json
  -- sur le RECORD retourné exerce la projection vivante : si demain
  -- quelqu'un ajoute tax_amount_usd (ou tout autre champ de la liste
  -- interdite) au RETURNS TABLE, cette clé apparaît dans le JSON et
  -- l'assertion casse.
  SELECT COUNT(*) INTO n
  FROM jsonb_object_keys(row_to_json(r)::jsonb) AS k
  WHERE k IN (
    'tax_amount_usd', 'amount_usd', 'invoice_ref', 'owner_name',
    'official_email', 'shipowner_id', 'partial_paid_usd'
  );
  ASSERT n = 0,
    'G1 VIOLÉE : vessel_payment_teaser expose un champ financier ou nominatif';

  -- Recherche par MMSI — même résultat
  SELECT * INTO r FROM public.vessel_payment_teaser('111000111');
  ASSERT r.imo_number = '1110001', 'le navire doit être trouvé par MMSI';

  -- ── G2 : un armateur placeholder n'est jamais claimable, MÊME avec e-mail ──
  -- C'est ce cas qui distingue la garde intentionnelle de la coïncidence de
  -- données : on renseigne délibérément une adresse sur le placeholder.
  --
  -- shipowner_id est first-write-only (mig 089) : re-pointer la transaction
  -- existante par UPDATE est rejeté par le trigger. On insère à la place une
  -- SECONDE transaction, plus récente, qui porte le placeholder dès l'INSERT
  -- — la RPC (ORDER BY created_at DESC LIMIT 1 sur les avis en attente) la
  -- retient alors comme la plus récente pour ce navire.
  INSERT INTO public.shipowners (name, account_state, official_email, is_placeholder)
  VALUES ('À identifier - test', 'GHOST', 'fourre-tout@example.org', TRUE)
  RETURNING id INTO v_ghost;

  INSERT INTO public.transactions (
    vessel_id, vessel_name, vessel_imo, transaction_type,
    emissions_tco2, tax_amount_usd, status, shipowner_id, created_at
  ) VALUES (v_vessel, 'MV TEASER TEST', '1110001', 'ENTRY_TAX',
            50.00, 6200.00, 'PENDING', v_ghost, NOW());

  SELECT * INTO r FROM public.vessel_payment_teaser('1110001');
  ASSERT r.outstanding_count = 2, 'les deux avis PENDING doivent être comptés';
  ASSERT r.claimable = FALSE,
    'G2 VIOLÉE : un armateur is_placeholder ouvre le rattachement par code — '
    'la garde doit tenir MÊME quand ce placeholder porte un official_email '
    '(si elle ne tenait que par absence d''adresse, retirer '
    's.is_placeholder = FALSE de la RPC ne changerait rien à ce test ; c''est '
    'précisément ce que ce fixture, avec son e-mail renseigné, exclut)';

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
