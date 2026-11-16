-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 173 : chaque donnée métier porte son pays — tables filles
--
-- Vingt tables portent déjà `jurisdiction_id` (migs 071, 072, 087…). Neuf tables
-- métier ne le portaient pas : elles dépendent d'une table mère qui, elle, le
-- porte. Conséquences avant cette migration :
--
--   • leurs règles d'accès « personnel » ne regardaient que le rôle. Un agent
--     d'un pays lisait donc les litiges, exonérations, inspections, preuves de
--     paiement… d'un autre pays ;
--   • sortir les données d'un seul pays demandait une jointure différente par
--     table, donc un outil d'export fragile.
--
-- Cette migration, pour chacune des neuf tables :
--   1. ajoute `jurisdiction_id`, rempli depuis la table mère (jamais par une
--      constante : Djibouti existe déjà en base) ;
--   2. pose un déclencheur qui recopie le pays de la mère à chaque insertion ou
--      modification — la valeur envoyée par l'appelant est ignorée, on ne peut
--      donc pas ranger une ligne dans le pays d'à côté ;
--   3. ajoute une règle RESTRICTIVE : le personnel ne touche que les lignes de
--      ses pays. Les règles existantes restent telles quelles ; armateurs et
--      agents, dont l'accès passe par leur propre relation, ne sont pas visés.
--
-- Sans changement visible aujourd'hui : mig 071 a rattaché tout le personnel
-- existant au Somaliland, et un SUPERADMIN voit tous les pays.
--
-- Hors périmètre, volontairement :
--   • positions des navires et des aéronefs, candidats d'identité, cache MRV,
--     facteurs d'émission, taux de change : référentiels communs, pas des
--     données d'un pays ;
--   • staff_notification_reads : état de lecture personnel, déjà limité à son
--     propriétaire.
--
-- Rejouable : chaque étape est conditionnelle.
--
-- AVANT DE DÉPLOYER — personnel sans pays. La cloison se lit dans
-- `user_jurisdictions`. Un membre du personnel qui n'y a aucune ligne ne verra
-- plus AUCUNE ligne de ces neuf tables (il ne voit déjà plus les transactions
-- ni les paiements depuis la mig 073). Les invitations créent ce rattachement ;
-- seuls d'anciens comptes peuvent en manquer. La migration en signale le
-- nombre par un WARNING, sans s'arrêter. Pour les lister :
--
--   SELECT p.role, p.email FROM public.profiles p
--    WHERE p.role IN ('PORT_OFFICER','FINANCE_ADMIN','MANAGER') AND p.is_active
--      AND NOT EXISTS (SELECT 1 FROM public.user_jurisdictions u WHERE u.user_id = p.id);
-- ─────────────────────────────────────────────────────────────────────────────

-- Les ALTER TABLE ci-dessous prennent un verrou exclusif sur chaque table. Si
-- une transaction longue en tient déjà un, mieux vaut échouer vite et rejouer
-- que faire attendre toutes les requêtes derrière la migration.
SET lock_timeout = '10s';

DO $$
DECLARE
  orphans bigint;
BEGIN
  SELECT count(*) INTO orphans
    FROM public.profiles p
   WHERE p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER')
     AND p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.user_jurisdictions u WHERE u.user_id = p.id);
  IF orphans > 0 THEN
    RAISE WARNING 'mig 173 : % membre(s) du personnel actif(s) sans pays rattaché — ils ne verront aucune ligne des tables cloisonnées', orphans;
  END IF;
END $$;

-- Recopie le pays de la ligne mère. Arguments du déclencheur :
--   TG_ARGV[0] = table mère, TG_ARGV[1] = colonne de la clé vers la mère.
-- SECURITY DEFINER : la mère doit rester lisible même quand la RLS de
-- l'appelant la lui cacherait, sinon l'insertion échouerait à tort.
CREATE OR REPLACE FUNCTION public.stamp_jurisdiction_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_id uuid;
  v_jurisdiction uuid;
BEGIN
  v_parent_id := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  EXECUTE format('SELECT jurisdiction_id FROM public.%I WHERE id = $1', TG_ARGV[0])
     INTO v_jurisdiction
    USING v_parent_id;
  IF v_jurisdiction IS NULL THEN
    RAISE EXCEPTION 'stamp_jurisdiction_from_parent: % % introuvable ou sans pays (table %)',
      TG_ARGV[0], v_parent_id, TG_TABLE_NAME
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.jurisdiction_id := v_jurisdiction;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_jurisdiction_from_parent() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.stamp_jurisdiction_from_parent() IS
  'Déclencheur : recopie jurisdiction_id depuis la table mère (TG_ARGV[0]) par la clé TG_ARGV[1]. La valeur fournie par l''appelant est écrasée.';

DO $$
DECLARE
  -- table fille, colonne de la clé, table mère, portée de la cloison
  -- owner_members n'a, par contrat, aucune règle d'écriture (les invitations
  -- passent par des actions serveur, cf. test 135) : sa cloison ne porte donc
  -- que sur la lecture. Une règle restrictive n'ouvre de toute façon aucun droit.
  specs text[][] := ARRAY[
    ['collection_reminders', 'transaction_id', 'transactions', 'ALL'],
    ['collections_event',    'transaction_id', 'transactions', 'ALL'],
    ['dispute_intervals',    'transaction_id', 'transactions', 'ALL'],
    ['disputes',             'transaction_id', 'transactions', 'ALL'],
    ['exemptions',           'vessel_id',      'vessels',      'ALL'],
    ['inspections',          'vessel_id',      'vessels',      'ALL'],
    ['owner_agent_mappings', 'shipowner_id',   'shipowners',   'ALL'],
    ['owner_members',        'shipowner_id',   'shipowners',   'SELECT'],
    ['payment_proofs',       'payment_id',     'payments',     'ALL']
  ];
  child text; fk text; parent text; wall_cmd text;
  wall_check text;
  missing bigint;
BEGIN
  FOR i IN 1 .. array_length(specs, 1) LOOP
    child := specs[i][1]; fk := specs[i][2]; parent := specs[i][3]; wall_cmd := specs[i][4];

    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS jurisdiction_id uuid REFERENCES public.jurisdictions(id)',
      child);

    -- Remplissage depuis la mère. Les déclencheurs applicatifs sont suspendus le
    -- temps de l'opération : certaines de ces tables refusent toute modification
    -- (collections_event est un journal), et il ne s'agit pas d'un fait métier.
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', child);
    EXECUTE format(
      'UPDATE public.%1$I c SET jurisdiction_id = p.jurisdiction_id
         FROM public.%3$I p
        WHERE p.id = c.%2$I AND c.jurisdiction_id IS DISTINCT FROM p.jurisdiction_id',
      child, fk, parent);
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', child);

    EXECUTE format('SELECT count(*) FROM public.%I WHERE jurisdiction_id IS NULL', child) INTO missing;
    IF missing > 0 THEN
      RAISE EXCEPTION 'mig 173 : % ligne(s) de % sans pays après remplissage — mère sans pays ?', missing, child;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN jurisdiction_id SET NOT NULL', child);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (jurisdiction_id)',
      'idx_' || child || '_jurisdiction', child);

    -- Nom en « aa_ » : les déclencheurs BEFORE s'exécutent par ordre
    -- alphabétique, celui-ci doit passer avant tout contrôle qui lirait le pays.
    EXECUTE format('DROP TRIGGER IF EXISTS aa_stamp_jurisdiction ON public.%I', child);
    EXECUTE format(
      'CREATE TRIGGER aa_stamp_jurisdiction BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.stamp_jurisdiction_from_parent(%L, %L)',
      child, parent, fk);

    -- Cloison par pays pour le personnel. RESTRICTIVE : elle s'ajoute aux règles
    -- existantes sans les remplacer. Qui n'est pas du personnel passe sans
    -- condition ici et reste soumis à ces seules règles existantes.
    EXECUTE format('DROP POLICY IF EXISTS staff_jurisdiction_wall ON public.%I', child);
    -- Les deux fonctions sont enveloppées dans un (SELECT …) : Postgres les
    -- évalue alors une fois par requête, et non une fois par ligne lue.
    wall_check := CASE WHEN wall_cmd = 'SELECT' THEN '' ELSE
      ' WITH CHECK (NOT (SELECT public.is_admin_or_officer())
                OR jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))' END;
    EXECUTE format(
      'CREATE POLICY staff_jurisdiction_wall ON public.%I
         AS RESTRICTIVE FOR %s TO authenticated
         USING (NOT (SELECT public.is_admin_or_officer())
                OR jurisdiction_id = ANY ((SELECT public.current_jurisdiction_ids())::uuid[]))%s',
      child, wall_cmd, wall_check);

    EXECUTE format(
      'COMMENT ON COLUMN public.%I.jurisdiction_id IS %L',
      child,
      format('Pays de la ligne, recopié de %s par le déclencheur aa_stamp_jurisdiction. Ne se saisit pas.', parent));
  END LOOP;
END $$;

RESET lock_timeout;

-- Limite connue : si le pays d'une ligne MÈRE changeait après coup, ses filles
-- garderaient l'ancien jusqu'à leur prochaine modification. Rien ne le fait
-- aujourd'hui (une créance mal rattachée est annulée puis réémise, cf. mig 090).
-- Un outil qui déplacerait une mère d'un pays à l'autre devra reprendre ses filles.

-- DOWN :
-- DO $$ DECLARE t text; BEGIN
--   FOREACH t IN ARRAY ARRAY['collection_reminders','collections_event','dispute_intervals','disputes',
--     'exemptions','inspections','owner_agent_mappings','owner_members','payment_proofs'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS staff_jurisdiction_wall ON public.%I', t);
--     EXECUTE format('DROP TRIGGER IF EXISTS aa_stamp_jurisdiction ON public.%I', t);
--     EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS jurisdiction_id', t);
--   END LOOP; END $$;
-- DROP FUNCTION IF EXISTS public.stamp_jurisdiction_from_parent();
