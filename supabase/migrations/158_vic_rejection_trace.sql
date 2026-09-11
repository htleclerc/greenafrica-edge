-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 158 : tracer le rejet d'un candidat d'identité
--
-- `vessel_identity_candidates.status` accepte 'REJECTED' depuis la mig 115,
-- mais RIEN n'a jamais pu poser cette valeur : aucune action ne l'écrit, aucun
-- bouton ne l'appelle. Le statut existait sur le papier et nulle part ailleurs.
--
-- Ce trou a une conséquence concrète. L'index unique partiel de la mig 117 ne
-- verrouille que les candidats PENDING, précisément pour qu'une saisie manuelle
-- fautive puisse être refaite. Mais sans moyen de SORTIR de PENDING autrement
-- qu'en appariant, la ligne fautive reste pendante à vie et continue d'interdire
-- toute nouvelle ligne de même (lot, IMO). Corriger une faute de frappe sur le
-- nom d'un navire restait donc impossible — l'échappatoire prévue par la 117
-- était condamnée faute de porte pour l'emprunter.
--
-- Le rejet doit se tracer comme l'appariement se trace. `matched_by` et
-- `matched_at` disent qui a apparié et quand ; réutiliser ces colonnes pour un
-- refus mentirait sur ce qui s'est passé — une ligne REJECTED porterait un
-- « matched_by » alors que personne n'a rien apparié. D'où trois colonnes
-- propres, symétriques des trois autres.
--
-- `rejection_reason` est libre et facultatif. Le motif d'un refus n'est pas
-- énumérable à l'avance (doublon, faute de frappe, navire hors périmètre,
-- export obsolète) et une liste fermée pousserait l'opérateur à choisir la
-- case la moins fausse plutôt qu'à dire ce qui s'est réellement passé.
--
-- Aucun backfill : il n'existe aucune ligne REJECTED, la table est vide en
-- production (0 ligne au 2026-09-10).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessel_identity_candidates
  ADD COLUMN IF NOT EXISTS rejected_by       UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS rejected_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT;

COMMENT ON COLUMN public.vessel_identity_candidates.rejected_by IS
  'Officier ayant écarté la proposition. Symétrique de matched_by : un refus n''est pas un appariement et ne doit pas s''écrire dans les colonnes de l''appariement.';
COMMENT ON COLUMN public.vessel_identity_candidates.rejected_at IS
  'Horodatage du rejet.';
COMMENT ON COLUMN public.vessel_identity_candidates.rejection_reason IS
  'Motif libre et facultatif. Volontairement non énuméré : une liste fermée ferait choisir la case la moins fausse au lieu de dire ce qui s''est passé.';

-- DOWN:
-- ALTER TABLE public.vessel_identity_candidates
--   DROP COLUMN IF EXISTS rejection_reason,
--   DROP COLUMN IF EXISTS rejected_at,
--   DROP COLUMN IF EXISTS rejected_by;
