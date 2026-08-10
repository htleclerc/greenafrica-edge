-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 115 : vessel_identity_candidates
--
-- Une ligne = UN NAVIRE DISTINCT issu d'un export d'escales VesselFinder (ou
-- d'une saisie manuelle), jamais un mouvement portuaire. La déduplication par
-- IMO est faite en amont par le parseur, qui retient le mouvement le plus récent.
--
-- Aucune créance n'est portée ici : la table n'est pas scopée par juridiction.
-- Les propositions ne sont JAMAIS appliquées automatiquement — un humain apparie.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.vessel_identity_candidates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_label            TEXT NOT NULL,
  source                 TEXT NOT NULL
                           CHECK (source IN ('VESSELFINDER_PORTCALLS', 'MANUAL')),

  -- identité
  imo_number             TEXT NOT NULL,
  mmsi                   TEXT,
  call_sign              TEXT,
  vessel_name            TEXT NOT NULL,
  flag_code              CHAR(2),
  type_raw               TEXT,
  category               public.vessel_category,
  gross_tonnage          INTEGER,
  deadweight             INTEGER,
  build_year             INTEGER,
  last_seen_at           TEXT,

  -- contacts (trois niveaux, cf. décision D4 : manager → owner → ISM)
  manager_name           TEXT,
  manager_country        TEXT,
  manager_email          TEXT,
  owner_name             TEXT,
  owner_country          TEXT,
  owner_email            TEXT,
  ism_manager_name       TEXT,
  ism_manager_email      TEXT,

  -- garde sanctions, posée à l'import
  contact_blocked        BOOLEAN NOT NULL DEFAULT FALSE,
  contact_blocked_reason TEXT,

  -- cycle de vie
  status                 TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'MATCHED', 'CONFLICT', 'REJECTED')),
  matched_vessel_id      UUID REFERENCES public.vessels(id),
  matched_by             UUID REFERENCES public.profiles(id),
  matched_at             TIMESTAMPTZ,
  imported_by            UUID REFERENCES public.profiles(id),
  imported_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_vic_batch_imo
  ON public.vessel_identity_candidates(batch_label, imo_number);
CREATE INDEX idx_vic_pending
  ON public.vessel_identity_candidates(batch_label, status)
  WHERE status = 'PENDING';

ALTER TABLE public.vessel_identity_candidates ENABLE ROW LEVEL SECURITY;

-- Personnel uniquement. Aucun armateur ne voit cette table : elle contient les
-- coordonnées de tiers et le drapeau de blocage sanctions.
CREATE POLICY vic_staff_all ON public.vessel_identity_candidates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    )
  );

COMMENT ON TABLE public.vessel_identity_candidates IS
  'Candidats d''identité navire issus d''un export d''escales VesselFinder. Un candidat n''est jamais appliqué automatiquement : l''appariement est une assertion humaine tracée dans audit_logs.';
COMMENT ON COLUMN public.vessel_identity_candidates.contact_blocked IS
  'Vrai si l''une des trois sociétés correspond à une entité sous sanctions (OFAC/UN). L''e-mail n''est alors jamais proposé comme destinataire.';

-- DOWN:
-- DROP TABLE IF EXISTS public.vessel_identity_candidates;
