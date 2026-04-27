-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 044 — Plan 8: destination_match_proposals
--
-- Holds fuzzy-match candidates from the AIS Destination field that didn't
-- match the allow-list outright. Reviewed manually by SUPERADMIN/PORT_OFFICER
-- in /admin/origin-port-proposals. Approving merges the variant into
-- app_config.arrival.origin_port_allow_list.
--
-- INSERT happens only via service_role from the Go originport.Watcher;
-- humans never insert directly. SELECT/UPDATE are gated by RLS.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.destination_proposal_status
  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE public.destination_match_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi               text NOT NULL,
  imo_number         text,
  vessel_name        text,
  raw_destination    text NOT NULL,
  normalized         text NOT NULL,
  matched_port_guess text,
  fuzzy_score        int  NOT NULL,
  status             public.destination_proposal_status NOT NULL DEFAULT 'PENDING',
  decided_by         uuid REFERENCES public.profiles(id),
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX destination_match_proposals_unique_pending_idx
  ON public.destination_match_proposals (mmsi, normalized)
  WHERE status = 'PENDING';

ALTER TABLE public.destination_match_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "officers read destination proposals"
  ON public.destination_match_proposals FOR SELECT
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('SUPERADMIN','PORT_OFFICER','FINANCE_ADMIN')
  );

CREATE POLICY "officers resolve destination proposals"
  ON public.destination_match_proposals FOR UPDATE
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid())
      IN ('SUPERADMIN','PORT_OFFICER')
  );

-- Defence-in-depth: no INSERT policy → only service_role can insert.
