-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — membres d'un compte armateur
-- Migration 135
--
-- BESOIN
-- Un armateur doit pouvoir faire travailler des collègues sur son compte : le
-- comptable paie, l'exploitation conteste, quelqu'un ajoute un navire. Jusqu'ici
-- `shipowners.profile_id` est 1:1 — un compte, une personne — et la seule
-- alternative était de partager les identifiants.
--
-- CE QUI BLOQUAIT
-- `current_shipowner_id()` (mig 058) résout l'armateur par
-- `shipowners.profile_id = auth.uid()` et porte le RLS de tout le rail
-- monétaire. Une douzaine d'autres policies font le même test en clair, sous la
-- forme `EXISTS (… shipowners s WHERE s.id = X AND s.profile_id = auth.uid())`
-- — qui est exactement `X = current_shipowner_id()`, écrit à la main.
--
-- Deux familles, donc, pour une seule règle. Cette migration les ramène à la
-- fonction, PUIS étend la fonction. Les policies suivent sans être réécrites une
-- seconde fois, et une règle d'accès cesse d'exister en douze exemplaires.
--
-- UNE SEULE APPARTENANCE ACTIVE PAR PERSONNE
-- `current_shipowner_id()` rend UN identifiant. Autoriser deux appartenances
-- actives rendrait son `LIMIT 1` non déterministe : la même personne verrait un
-- dossier ou l'autre selon le plan d'exécution. L'index partiel ci-dessous rend
-- ce cas impossible plutôt que de le laisser arbitrer au hasard. Travailler sur
-- deux comptes demandera un sélecteur, comme pour le staff multi-juridiction.
--
-- PRIVILÈGES
-- Drapeaux additifs, jamais un rôle : c'est la règle posée par la mig 130. Ils
-- vivent ICI et non sur `profiles` — une colonne de privilège sur `profiles` est
-- auto-attribuable par `PATCH /rest/v1/profiles?id=eq.<self>` à moins d'être
-- inscrite dans le verrou de la mig 119, et ce verrou ne protège pas ce qu'on
-- oublie d'y ajouter. Sur `owner_members`, l'absence de policy d'UPDATE suffit.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. La table ──────────────────────────────────────────────────────────────
CREATE TABLE public.owner_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id  UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,

  -- Drapeaux additifs. Tous FAUX par défaut : un membre invité voit le compte,
  -- il n'agit dessus que sur décision explicite du titulaire.
  can_pay             BOOLEAN NOT NULL DEFAULT FALSE,
  can_dispute         BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_vessels  BOOLEAN NOT NULL DEFAULT FALSE,
  can_invite          BOOLEAN NOT NULL DEFAULT FALSE,

  -- Qui a ouvert la porte. La délégation est transitive (un membre portant
  -- can_invite peut inviter) : sans cette colonne, on ne saurait plus remonter
  -- la chaîne quand un accès est contesté.
  invited_by    UUID REFERENCES public.profiles(id),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,

  CONSTRAINT owner_members_revoked_iff_inactive
    CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);

-- Une seule appartenance ACTIVE par personne — cf. l'en-tête. Partiel : on garde
-- l'historique des appartenances révoquées, qui est la trace d'un accès passé.
CREATE UNIQUE INDEX owner_members_one_active_per_profile
  ON public.owner_members(profile_id) WHERE active;

CREATE INDEX idx_owner_members_shipowner
  ON public.owner_members(shipowner_id) WHERE active;

COMMENT ON TABLE public.owner_members IS
  'mig 135 : personnes autorisées à agir sur un compte armateur, avec leurs sous-permissions. Une seule appartenance active par profil — current_shipowner_id() rend un identifiant unique.';

-- ── 2. La fonction porteuse ──────────────────────────────────────────────────
-- La propriété l'emporte : quelqu'un qui possède un dossier ET qui est membre
-- d'un autre reste sur le sien. Sans cette préséance, accepter une invitation
-- lui ferait silencieusement changer de compte.
CREATE OR REPLACE FUNCTION public.current_shipowner_id() RETURNS UUID AS $$
  SELECT COALESCE(
    (SELECT id FROM public.shipowners WHERE profile_id = auth.uid() LIMIT 1),
    (SELECT shipowner_id FROM public.owner_members
      WHERE profile_id = auth.uid() AND active LIMIT 1)
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

/**
 * Sous-permissions de l'appelant sur le compte qu'il consulte.
 *
 * Le TITULAIRE les a toutes : il ne s'invite pas lui-même, aucune ligne
 * `owner_members` ne le décrit, et exiger qu'il s'en crée une serait un piège à
 * comptes verrouillés. Un membre n'a que ce qui lui a été coché.
 */
CREATE OR REPLACE FUNCTION public.owner_privileges()
RETURNS TABLE (can_pay BOOLEAN, can_dispute BOOLEAN, can_manage_vessels BOOLEAN, can_invite BOOLEAN)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = ''
-- Chaque branche est PARENTHÉSÉE : un `LIMIT` ne peut pas précéder directement
-- un `UNION`, il se rattacherait à l'union entière et non à sa branche.
-- Les deux branches s'excluent (le `NOT EXISTS` de la seconde), si bien que la
-- fonction rend une ligne ou zéro — jamais deux.
AS $$
  (SELECT TRUE, TRUE, TRUE, TRUE
     FROM public.shipowners
    WHERE profile_id = auth.uid()
    LIMIT 1)
  UNION ALL
  (SELECT m.can_pay, m.can_dispute, m.can_manage_vessels, m.can_invite
     FROM public.owner_members m
    WHERE m.profile_id = auth.uid() AND m.active
      AND NOT EXISTS (SELECT 1 FROM public.shipowners s WHERE s.profile_id = auth.uid())
    LIMIT 1);
$$;

GRANT EXECUTE ON FUNCTION public.current_shipowner_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_privileges()     TO authenticated, service_role;

-- ── 3. RLS sur la table elle-même ────────────────────────────────────────────
ALTER TABLE public.owner_members ENABLE ROW LEVEL SECURITY;

-- Chacun voit la composition de SON compte : le titulaire comme les membres.
-- Savoir qui d'autre a accès fait partie du compte.
CREATE POLICY owner_members_select ON public.owner_members
  FOR SELECT TO authenticated
  USING (
    shipowner_id = public.current_shipowner_id()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.is_active = TRUE
         AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    )
  );

-- Aucune policy d'INSERT/UPDATE/DELETE : inviter et révoquer passent par les
-- actions serveur, qui vérifient `can_invite` et journalisent. Une policy
-- d'écriture ici laisserait un membre s'octroyer `can_pay` sur sa propre ligne.

-- ── 4. Les policies armateur passent toutes par la fonction ──────────────────
-- Douze exemplaires d'une même règle deviennent douze appels. Chacune conserve
-- ses AUTRES branches (staff, agent) telles quelles : seule la branche armateur
-- change de forme, pas de portée — pour le titulaire, le résultat est identique.

DROP POLICY IF EXISTS "shipowner reads self" ON public.shipowners;
CREATE POLICY "shipowner reads self"
  ON public.shipowners FOR SELECT
  USING (id = public.current_shipowner_id());

DROP POLICY IF EXISTS "shipowner reads own vessels" ON public.vessels;
CREATE POLICY "shipowner reads own vessels"
  ON public.vessels FOR SELECT
  USING (shipowner_id = public.current_shipowner_id());

DROP POLICY IF EXISTS "shipowner reads own transactions" ON public.transactions;
CREATE POLICY "shipowner reads own transactions"
  ON public.transactions FOR SELECT
  USING (shipowner_id = public.current_shipowner_id());

DROP POLICY IF EXISTS "shipowner reads own vessel alerts" ON public.arrival_alerts;
CREATE POLICY "shipowner reads own vessel alerts"
  ON public.arrival_alerts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.vessels v
     WHERE v.id = arrival_alerts.vessel_id
       AND v.shipowner_id = public.current_shipowner_id()
  ));

DROP POLICY IF EXISTS "shipowners read own reminders" ON public.collection_reminders;
CREATE POLICY "shipowners read own reminders"
  ON public.collection_reminders FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.id = collection_reminders.transaction_id
       AND t.shipowner_id = public.current_shipowner_id()
  ));

DROP POLICY IF EXISTS "owner reads own statements" ON public.owner_statements;
CREATE POLICY "owner reads own statements"
  ON public.owner_statements FOR SELECT
  USING (shipowner_id = public.current_shipowner_id());

DROP POLICY IF EXISTS "operators + staff see aircraft" ON public.aircraft;
CREATE POLICY "operators + staff see aircraft"
  ON public.aircraft FOR SELECT
  USING (
    operator_id = public.current_shipowner_id()
    OR ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
         AND jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
  );

DROP POLICY IF EXISTS "Users see positions of visible aircraft" ON public.aircraft_positions;
CREATE POLICY "Users see positions of visible aircraft"
  ON public.aircraft_positions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.aircraft a
      WHERE a.id = aircraft_positions.aircraft_id
        AND (
          a.operator_id = public.current_shipowner_id()
          OR ( public.get_user_role() IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
               AND a.jurisdiction_id = ANY(public.current_jurisdiction_ids()) )
        )
    )
  );

-- ── 5. Les écritures, elles, exigent la sous-permission ──────────────────────
-- La lecture est commune à tous les membres ; agir ne l'est pas. Les deux
-- policies d'INSERT ci-dessous sont le filet côté base — les actions serveur
-- vérifient déjà, mais une policy qui laisserait passer rendrait ce contrôle
-- contournable par un appel PostgREST direct.

DROP POLICY IF EXISTS disputes_insert_own ON public.disputes;
CREATE POLICY disputes_insert_own ON public.disputes
  FOR INSERT WITH CHECK (
    submitted_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.transactions t
       WHERE t.id = disputes.transaction_id
         AND (
           t.agent_profile_id = auth.uid()
           OR ( t.shipowner_id = public.current_shipowner_id()
                AND (SELECT p.can_dispute FROM public.owner_privileges() p) )
         )
    )
  );

-- Déclarer un paiement passe par `payments` : `shipowner_payment_intents` a été
-- retirée par la mig 062, remplacée par la table polymorphe de la mig 048.
--
-- La condition de portée est déjà `current_shipowner_id()`, donc elle s'étend
-- aux membres d'elle-même ; ce qui manque est la sous-permission. Les autres
-- conditions sont reprises À L'IDENTIQUE — le statut initial et la liste des
-- rails sont des règles du rail monétaire, pas des règles d'appartenance.
DROP POLICY IF EXISTS payments_owner_insert ON public.payments;
CREATE POLICY payments_owner_insert ON public.payments
  FOR INSERT
  WITH CHECK (
    shipowner_id = public.current_shipowner_id()
    AND status = 'INITIATED'::public.payment_status_v7
    AND rail = ANY (ARRAY[
      'WIRE_TRANSFER'::public.payment_rail,
      'MOBILE_MONEY'::public.payment_rail,
      'THIRD_PARTY'::public.payment_rail,
      'WALLET'::public.payment_rail
    ])
    AND (SELECT p.can_pay FROM public.owner_privileges() p)
  );

-- DOWN:
-- Rétablir la forme mig 058 de current_shipowner_id() ANNULE l'accès des
-- membres ; supprimer la table ensuite, jamais avant (les policies la lisent).
-- CREATE OR REPLACE FUNCTION public.current_shipowner_id() RETURNS UUID AS $$
--   SELECT id FROM public.shipowners WHERE profile_id = auth.uid() LIMIT 1;
-- $$ LANGUAGE SQL STABLE SECURITY DEFINER;
-- Restaurer aussi payments_owner_insert sans la sous-permission :
--   DROP POLICY IF EXISTS payments_owner_insert ON public.payments;
--   CREATE POLICY payments_owner_insert ON public.payments FOR INSERT
--     WITH CHECK (shipowner_id = public.current_shipowner_id()
--       AND status = 'INITIATED'::public.payment_status_v7
--       AND rail = ANY (ARRAY['WIRE_TRANSFER','MOBILE_MONEY','THIRD_PARTY','WALLET']::public.payment_rail[]));
-- DROP POLICY IF EXISTS owner_members_select ON public.owner_members;
-- DROP FUNCTION IF EXISTS public.owner_privileges();
-- DROP TABLE IF EXISTS public.owner_members;
-- Les dix policies réécrites ci-dessus retrouvent alors leur portée d'origine
-- sans être retouchées : elles interrogent la fonction, pas la table.
