-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 146 : l'échéance devient une donnée, et le navire porte son agent
--
-- ── 1. due_date ──────────────────────────────────────────────────────────────
--
-- `due_date` était une colonne GÉNÉRÉE : created_at + 31 jours − 1 µs, en heure
-- de Mogadiscio (mig 022). Le NET-30 était donc une propriété du schéma, pas
-- une donnée — impossible d'émettre à un autre terme.
--
-- Le rappel final du 27/08/2026 casse cette hypothèse : les 86 pro-formas
-- distribuées aux débiteurs annoncent une échéance au 10/09/2026, soit 15
-- jours. Insérées telles quelles, elles s'afficheraient au portail avec une
-- échéance au 26/09 — seize jours après la date que le débiteur a sous les
-- yeux. Un écart pareil désarme la relance : il suffit d'ouvrir le portail
-- pour opposer une autre date à la mise en demeure, et la rampe huissier
-- devient contestable.
--
-- La colonne est donc dégénérée. Trois précautions pour que rien ne bouge
-- ailleurs :
--
--   a. DROP EXPRESSION conserve les valeurs déjà calculées — les 656 lignes
--      existantes gardent exactement l'échéance qu'elles affichaient hier.
--   b. Un BEFORE INSERT reconduit le NET-30 quand l'appelant ne dit rien.
--      Toute la chaîne d'émission (pipeline Go, /invoices/generate, seeds)
--      continue donc sans modification. Un DEFAULT ne pouvait pas faire
--      l'affaire : une expression de défaut n'a pas le droit de lire une autre
--      colonne de la ligne.
--   c. Un BEFORE UPDATE la gèle. Sans lui, dégénérer la colonne serait une
--      régression fiscale : PostgreSQL protégeait `due_date` par sa seule
--      nature générée, et la mig 089 la classait « GENERATED — self-protected »
--      pour cette raison. Redevenue ordinaire, elle tomberait dans la catégorie
--      FREE, où un FINANCE_ADMIN pourrait repousser l'échéance d'une facture
--      émise. L'échéance est inscrite dans le PDF distribué : elle se fige au
--      même titre que le montant.
--
-- Le garde vit dans son propre déclencheur plutôt que dans la fonction de la
-- mig 089 : recopier quarante blocs pour en ajouter un ferait diverger les deux
-- inventaires au premier oubli. Les deux déclencheurs BEFORE UPDATE se
-- déclenchent l'un après l'autre par ordre alphabétique, et l'échappatoire de
-- backfill (`app.transactions_allow_backfill`) garde la même sémantique.
--
-- ── 2. vessels : agent local et fréquentation ────────────────────────────────
--
-- Le dossier de production du 27/08 apporte, pour 48 des 86 navires, l'agence
-- consignataire de Berbera, son correspondant et son téléphone — le seul canal
-- qui reste ouvert sur les dossiers dont l'armateur n'a pas d'adresse (38 sur
-- 86, 37 % du portefeuille). Sans colonne pour l'accueillir, cette donnée se
-- perdait à l'import.
--
-- Les noms restent génériques (`local_agent_*`) et non « berbera_* » : la
-- plateforme est multi-juridiction depuis le Wedge 2, et Djibouti aura ses
-- propres consignataires.
--
-- DOWN :
--   DROP TRIGGER IF EXISTS transactions_due_date_default  ON public.transactions;
--   DROP TRIGGER IF EXISTS transactions_due_date_frozen   ON public.transactions;
--   DROP FUNCTION IF EXISTS public.transactions_due_date_default();
--   DROP FUNCTION IF EXISTS public.transactions_due_date_frozen_guard();
--   ALTER TABLE public.vessels
--     DROP COLUMN IF EXISTS local_agent_name,
--     DROP COLUMN IF EXISTS local_agent_contact,
--     DROP COLUMN IF EXISTS local_agent_phone,
--     DROP COLUMN IF EXISTS registered_owner,
--     DROP COLUMN IF EXISTS last_port_call_on,
--     DROP COLUMN IF EXISTS port_calls_count;
--   -- La régénération de due_date exige de réécrire l'expression de la mig 022.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1a. Dégénération, valeurs conservées ─────────────────────────────────────
ALTER TABLE public.transactions
  ALTER COLUMN due_date DROP EXPRESSION IF EXISTS;

-- ── 1b. NET-30 par défaut quand l'appelant ne dit rien ───────────────────────
-- Expression reprise à l'identique de la mig 022 : fin de journée du 30e jour,
-- en heure de Mogadiscio. La valeur par défaut de created_at est appliquée
-- avant les déclencheurs BEFORE, elle est donc lisible ici.
CREATE OR REPLACE FUNCTION public.transactions_due_date_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.due_date IS NULL THEN
    NEW.due_date := (
      (date_trunc('day', (NEW.created_at AT TIME ZONE 'Africa/Mogadishu'))
        + INTERVAL '31 days') - INTERVAL '00:00:00.000001'
    ) AT TIME ZONE 'Africa/Mogadishu';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_due_date_default ON public.transactions;
CREATE TRIGGER transactions_due_date_default
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_due_date_default();

-- ── 1c. Gel après émission ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transactions_due_date_frozen_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  allow_backfill BOOLEAN;
BEGIN
  -- Même échappatoire que la mig 089, mêmes limites : elle n'ouvre que le
  -- créneau NULL → valeur, jamais l'écrasement d'une échéance déjà posée.
  allow_backfill := (current_setting('app.transactions_allow_backfill', true) = 'on');

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    IF NOT (allow_backfill AND OLD.due_date IS NULL) THEN
      RAISE EXCEPTION 'transactions: due_date is frozen after INSERT — the distributed PDF carries this date'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_due_date_frozen ON public.transactions;
CREATE TRIGGER transactions_due_date_frozen
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_due_date_frozen_guard();

-- ── 2. Agent consignataire et fréquentation du port ──────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS local_agent_name    TEXT,
  ADD COLUMN IF NOT EXISTS local_agent_contact TEXT,
  ADD COLUMN IF NOT EXISTS local_agent_phone   TEXT,
  -- Propriétaire inscrit au registre, distinct de l'armateur débiteur : sur 21
  -- dossiers sur 74 le débiteur relancé est le manager ou l'ISM, pas lui.
  ADD COLUMN IF NOT EXISTS registered_owner    TEXT,
  ADD COLUMN IF NOT EXISTS last_port_call_on   DATE,
  ADD COLUMN IF NOT EXISTS port_calls_count    INTEGER;

COMMENT ON COLUMN public.vessels.local_agent_name IS
  'Agence consignataire au port de la juridiction. Canal de dernier recours quand l''armateur n''a pas d''adresse connue.';
COMMENT ON COLUMN public.vessels.registered_owner IS
  'Propriétaire au registre. Information, pas débiteur : le débiteur est shipowner_id.';
COMMENT ON COLUMN public.transactions.due_date IS
  'Échéance de règlement. NET-30 par défaut (déclencheur transactions_due_date_default), explicite à l''émission si le terme diffère. Gelée après INSERT — elle figure sur le PDF distribué.';
