-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — notifications du staff
-- Migration 133
--
-- BESOIN
-- Les armateurs ont de vraies notifications depuis la mig 053
-- (`owner_notifications`) : une ligne persistée, un `read_at`, un e-mail pour la
-- plupart des types. Le staff n'avait rien. Sa « cloche » recalculait un état
-- courant (inscriptions en attente, factures échues, navires non conformes)
-- toutes les 60 secondes — ce qui n'est pas une notification : on ne peut pas
-- savoir qu'un fait est arrivé, seulement qu'il dure encore, et le lu ne
-- survivait pas au rafraîchissement suivant.
--
-- MODÈLE — un événement, plusieurs lecteurs
-- Une notification d'armateur vise une entité (`shipowner_id`) : une ligne, un
-- lecteur, `read_at` sur la ligne. Une notification de staff vise une ÉQUIPE :
-- « 12 validations en attente » concerne qui est de service, pas une personne
-- nommée. Dupliquer la ligne par agent obligerait à connaître la liste des
-- destinataires à l'émission — et laisserait de côté celui qui rejoint l'équipe
-- le lendemain.
--
-- D'où deux tables : le fait d'un côté, l'état de lecture par personne de
-- l'autre. C'est la seule structure qui laisse deux agents traiter la même file
-- sans se marcher dessus.
--
-- PORTÉE
-- Chaque ligne porte sa juridiction (multi-pays, Wedge 2) et ses rôles
-- destinataires. Un même fait concerne souvent deux rôles — une escalade de
-- recouvrement intéresse le FINANCE_ADMIN qui la décide et le PORT_OFFICER qui
-- verra le navire au quai — d'où un tableau de rôles plutôt qu'une colonne.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Les types d'événements ────────────────────────────────────────────────
-- Volontairement peu nombreux : un type ne se crée que si son texte, son lien
-- profond et son destinataire diffèrent réellement d'un type existant.
CREATE TYPE public.staff_notification_kind AS ENUM (
  'VALIDATION_PENDING',       -- un élément est arrivé dans la file d'arbitrage
  'REGISTRATION_SUBMITTED',   -- une inscription attend une décision
  'COLLECTION_ESCALATED',     -- un dossier a franchi un palier de la rampe
  'DEBTOR_RESPONDED',         -- le débiteur a répondu (contestation, promesse…)
  'CASH_PAYMENT_RECORDED',    -- encaissement au guichet, en attente de validation
  'DISPUTE_OPENED'            -- un armateur conteste une facture
);

-- ── 2. Le fait ───────────────────────────────────────────────────────────────
CREATE TABLE public.staff_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id  UUID NOT NULL REFERENCES public.jurisdictions(id) ON DELETE CASCADE,
  kind             public.staff_notification_kind NOT NULL,
  -- Rôles destinataires. Un SUPERADMIN voit tout sans y figurer (cf. policy).
  audience_roles   public.user_role[] NOT NULL,
  title_key        TEXT NOT NULL,
  body_key         TEXT NOT NULL,
  body_params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  deep_link        TEXT,
  -- Empêche le doublon quand un émetteur repasse sur le même fait (retry d'action,
  -- cron rejoué). NULL = pas de dédup, chaque appel crée sa ligne.
  dedup_key        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT staff_notifications_audience_not_empty
    CHECK (array_length(audience_roles, 1) >= 1)
);

-- Un fait, une ligne : l'unicité porte sur la juridiction ET le type, deux
-- émetteurs différents pouvant légitimement réutiliser la même clé métier
-- (l'identifiant d'une transaction, par exemple).
CREATE UNIQUE INDEX idx_staff_notif_dedup
  ON public.staff_notifications(jurisdiction_id, kind, dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE INDEX idx_staff_notif_feed
  ON public.staff_notifications(jurisdiction_id, created_at DESC);

COMMENT ON TABLE public.staff_notifications IS
  'mig 133 : notifications du staff. Un fait, plusieurs lecteurs — l''état de lecture vit dans staff_notification_reads, jamais ici.';
COMMENT ON COLUMN public.staff_notifications.dedup_key IS
  'Clé métier stable (id de transaction, de proposition…). Rend l''émission idempotente sur un retry. NULL pour les faits sans identité propre.';

-- ── 3. L'état de lecture, par personne ───────────────────────────────────────
CREATE TABLE public.staff_notification_reads (
  notification_id  UUID NOT NULL REFERENCES public.staff_notifications(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, profile_id)
);

CREATE INDEX idx_staff_notif_reads_profile
  ON public.staff_notification_reads(profile_id);

COMMENT ON TABLE public.staff_notification_reads IS
  'mig 133 : « qui a lu quoi ». L''absence de ligne vaut non lu — on n''écrit qu''à la lecture.';

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_notification_reads ENABLE ROW LEVEL SECURITY;

-- Lecture : agent actif, dans une juridiction dont il est membre, et dont le
-- rôle figure parmi les destinataires. Le SUPERADMIN passe par
-- current_jurisdiction_ids(), qui lui rend toutes les juridictions (mig 071),
-- et court-circuite l'audience — il est destinataire de tout par construction.
CREATE POLICY staff_notifications_select ON public.staff_notifications
  FOR SELECT TO authenticated
  USING (
    jurisdiction_id = ANY(public.current_jurisdiction_ids())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.is_active = TRUE
         AND (p.role = 'SUPERADMIN' OR p.role = ANY(staff_notifications.audience_roles))
    )
  );

-- Aucune policy d'écriture : les faits sont émis par le service-role
-- (notifyStaff), jamais par un agent. Un agent qui pourrait s'écrire une
-- notification pourrait aussi s'en fabriquer une au nom d'un autre rôle.

-- Chacun ne lit et n'écrit que SES marques de lecture. `WITH CHECK` autant que
-- `USING` : sans lui, un agent pourrait marquer lu à la place d'un collègue.
CREATE POLICY staff_notification_reads_select ON public.staff_notification_reads
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY staff_notification_reads_insert ON public.staff_notification_reads
  FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY staff_notification_reads_delete ON public.staff_notification_reads
  FOR DELETE TO authenticated
  USING (profile_id = auth.uid());

-- ── 5. La vue de lecture ─────────────────────────────────────────────────────
-- `security_invoker` : la vue s'exécute avec les droits de l'appelant, donc les
-- policies ci-dessus s'appliquent. Sans cette option la vue appartiendrait au
-- propriétaire et rendrait les notifications de toutes les juridictions.
CREATE VIEW public.v_staff_notifications
WITH (security_invoker = true) AS
SELECT
  n.id,
  n.jurisdiction_id,
  n.kind,
  n.title_key,
  n.body_key,
  n.body_params,
  n.deep_link,
  n.created_at,
  r.read_at
FROM public.staff_notifications n
LEFT JOIN public.staff_notification_reads r
       ON r.notification_id = n.id
      AND r.profile_id = auth.uid();

COMMENT ON VIEW public.v_staff_notifications IS
  'mig 133 : le fil du staff pour l''agent courant, avec SON état de lecture. security_invoker : les policies de staff_notifications s''appliquent.';

GRANT SELECT ON public.v_staff_notifications TO authenticated, service_role;

-- DOWN:
-- DROP VIEW public.v_staff_notifications;
-- DROP TABLE public.staff_notification_reads;
-- DROP TABLE public.staff_notifications;
-- DROP TYPE public.staff_notification_kind;
