-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 117 : index unique PARTIEL sur (batch_label, imo_number)
--
-- La spécification annonçait un index unique *partiel* ; la migration 115 a
-- livré un index total. La différence n'est pas cosmétique : sous l'index
-- total, une ligne déjà traitée continue d'interdire toute nouvelle ligne de
-- même (lot, IMO). Une saisie manuelle utilise `batch_label =
-- 'saisie-manuelle-<imo>'` : corriger une faute de frappe sur le nom du navire
-- devient donc DÉFINITIVEMENT impossible, et l'opérateur reçoit le message
-- brut de Postgres.
--
-- La garde utile est la déduplication des candidats *en attente* : deux lignes
-- pendantes pour le même IMO dans le même lot n'ont aucun sens, et c'est ce
-- qui bloque le redépôt du même export. Une fois le candidat MATCHED,
-- CONFLICT ou REJECTED, il n'est plus une proposition ouverte et ne doit plus
-- verrouiller la table.
--
-- La 115 n'est pas modifiée : elle est peut-être déjà appliquée ailleurs.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_vic_batch_imo;

CREATE UNIQUE INDEX idx_vic_batch_imo_pending
  ON public.vessel_identity_candidates(batch_label, imo_number)
  WHERE status = 'PENDING';

COMMENT ON INDEX public.idx_vic_batch_imo_pending IS
  'Unicité (lot, IMO) limitée aux candidats PENDING : empêche le redépôt du même export tant que les propositions sont ouvertes, sans figer à vie une saisie manuelle corrigée.';

-- DOWN:
-- DROP INDEX IF EXISTS public.idx_vic_batch_imo_pending;
-- CREATE UNIQUE INDEX idx_vic_batch_imo
--   ON public.vessel_identity_candidates(batch_label, imo_number);
