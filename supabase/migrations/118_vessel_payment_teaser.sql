-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 : consultation publique par IMO/MMSI (teaser sans montant)
-- Spec : docs/superpowers/specs/2026-08-12-onboarding-paiement-armateurs-design.md
-- ─────────────────────────────────────────────────────────────────────────────

-- vessels n'a d'index que sur imo_number (mig 003). La recherche accepte aussi
-- le MMSI ; sans index, un balayage séquentiel sur un chemin public non
-- authentifié est un levier de déni de service.
CREATE INDEX IF NOT EXISTS idx_vessels_mmsi ON public.vessels(mmsi) WHERE mmsi IS NOT NULL;

-- Rattachement self-service d'un armateur (vérification du code envoyé à son
-- adresse officielle). Absent de l'enum de base (003) et de ses extensions
-- (016, 092, 105) — ajouté ici pour la ligne d'audit de verifyVesselAccessCode.
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SHIPOWNER_SELF_CLAIM';

-- Marqueur explicite d'armateur de regroupement. Voir G2 dans le spec : ces
-- lignes ne représentent aucune entité réelle et ne doivent jamais ouvrir un
-- accès par code. Aujourd'hui « À identifier » n'a pas d'official_email et se
-- trouve exclu de fait — ce drapeau rend la protection intentionnelle plutôt
-- qu'accidentelle, et la maintient si une adresse de repli y est un jour saisie.
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.shipowners.is_placeholder IS
'TRUE pour les armateurs de regroupement ne correspondant à aucune entité réelle
(ex. « À identifier - IMO lookup en cours », seed arm-014 : 83 pro-formas,
1,63 M USD en attente d''appariement). Exclut la ligne du rattachement public
par code — voir vessel_payment_teaser et spec 2026-08-12.';

-- Backfill unique, au moment de la migration, plutôt qu'un filtre par motif
-- rejoué à chaque requête. Le libellé provient du seed 01_armateurs.json
-- (arm-014.nom_legal). Le staff peut ensuite basculer le drapeau à la main.
UPDATE public.shipowners
   SET is_placeholder = TRUE
 WHERE name ILIKE 'À identifier%'
    OR name ILIKE 'A identifier%';

-- Statuts « à régler » : PENDING, PARTIALLY_PAID, OVERDUE.
-- Exclus volontairement : PAID, EXEMPT, VOID, CREDIT_NOTE_ISSUED (rien à devoir)
-- et DISPUTED (avis sous contestation — le compter comme dû contredirait la
-- procédure de contestation publiée sur /legal-basis).
CREATE OR REPLACE FUNCTION public.vessel_payment_teaser(p_identifier TEXT)
RETURNS TABLE (
    vessel_name       TEXT,
    imo_number        TEXT,
    port_call         TEXT,
    outstanding_count INT,
    earliest_due_date TIMESTAMPTZ,
    has_overdue       BOOLEAN,
    claimable         BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH v AS (
        SELECT ve.id, ve.name, ve.imo_number, ve.port_call
        FROM public.vessels ve
        WHERE ve.imo_number = p_identifier
           OR ve.mmsi       = p_identifier
        LIMIT 1
    ),
    t AS (
        SELECT tx.shipowner_id, tx.status, tx.due_date, tx.created_at
        FROM public.transactions tx
        JOIN v ON v.id = tx.vessel_id
        WHERE tx.status IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
    )
    SELECT
        v.name,
        v.imo_number,
        v.port_call,
        (SELECT COUNT(*)::INT FROM t),
        (SELECT MIN(t.due_date) FROM t),
        (SELECT COALESCE(BOOL_OR(t.status = 'OVERDUE'), FALSE) FROM t),
        -- claimable : l'armateur du dernier avis porte-t-il un e-mail
        -- exploitable ? Booléen seul — ni l'adresse ni le nom ne sortent d'ici.
        -- COALESCE : un navire sans avis en attente n'a pas d'armateur résolu
        -- ici ; on renvoie FALSE, jamais NULL, pour que l'appelant n'ait qu'un
        -- seul cas à traiter.
        COALESCE((
            SELECT s.official_email IS NOT NULL
               AND s.official_email <> ''
               AND s.is_placeholder = FALSE
            FROM t
            JOIN public.shipowners s ON s.id = t.shipowner_id
            ORDER BY t.created_at DESC
            LIMIT 1
        ), FALSE)
    FROM v;
$$;

-- Verrou : révoquer d'abord de PUBLIC, n'accorder qu'à anon/authenticated.
REVOKE ALL ON FUNCTION public.vessel_payment_teaser(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vessel_payment_teaser(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.vessel_payment_teaser(TEXT) IS
'Consultation publique par IMO/MMSI. NE JAMAIS ajouter de montant, de référence
de pro-forma, de nom d''armateur ni d''e-mail à cette projection : elle est
appelée avec la clé anon depuis une page publique, sur un espace d''identifiants
entièrement énumérable. Voir spec 2026-08-12.';

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.vessel_payment_teaser(TEXT);
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS is_placeholder;
-- DROP INDEX IF EXISTS public.idx_vessels_mmsi;
