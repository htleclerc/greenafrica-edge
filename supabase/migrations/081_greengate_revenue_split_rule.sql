-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 081: GreenGate v8 Wedge 2 — revenue_split_rule (decision D3)
--
-- Versioned, signed concessionaire/sovereign revenue split per jurisdiction.
-- D3 rules: append-only (a change = INSERT new row + close previous effective_to);
-- every invoice references the rule applicable at ISSUANCE date (settlement
-- application deferred — out of W2 scope). Initial value = 100% escrowed to the
-- sovereign until the Min. Finance agreement is formalised (prevents premature
-- settlement). signature_hash reserved for D2 anchoring (decision 3A).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.revenue_split_rule (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_id     UUID NOT NULL REFERENCES public.jurisdictions(id),
  effective_from      TIMESTAMPTZ NOT NULL,
  effective_to        TIMESTAMPTZ,                -- NULL = current rule
  concessionaire_pct  NUMERIC(5,2) NOT NULL CHECK (concessionaire_pct BETWEEN 0 AND 100),
  sovereign_pct       NUMERIC(5,2) NOT NULL CHECK (sovereign_pct BETWEEN 0 AND 100),
  contract_ref        TEXT NOT NULL,
  signature_hash      TEXT NOT NULL,
  signed_by           TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (concessionaire_pct + sovereign_pct = 100),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT revenue_split_no_overlap EXCLUDE USING gist (
    jurisdiction_id WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  )
);

-- Append-only guard: a change is an INSERT of a new row + closing previous effective_to.
-- DELETE is always forbidden.
-- UPDATE is allowed ONLY when:
--   • every column except effective_to is unchanged (IS DISTINCT FROM checks)
--   • AND OLD.effective_to IS NULL (only closing the current/open rule is permitted)
-- Once a row is closed (effective_to IS NOT NULL) it is fully immutable.
CREATE OR REPLACE FUNCTION public.revenue_split_rule_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'revenue_split_rule append-only: DELETE forbidden';
  END IF;

  -- UPDATE path
  IF OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'revenue_split_rule append-only: only closing effective_to (NULL -> value) is allowed';
  END IF;

  IF (
    NEW.jurisdiction_id    IS DISTINCT FROM OLD.jurisdiction_id    OR
    NEW.effective_from     IS DISTINCT FROM OLD.effective_from     OR
    NEW.concessionaire_pct IS DISTINCT FROM OLD.concessionaire_pct OR
    NEW.sovereign_pct      IS DISTINCT FROM OLD.sovereign_pct      OR
    NEW.contract_ref       IS DISTINCT FROM OLD.contract_ref       OR
    NEW.signature_hash     IS DISTINCT FROM OLD.signature_hash     OR
    NEW.signed_by          IS DISTINCT FROM OLD.signed_by          OR
    NEW.created_at         IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'revenue_split_rule append-only: only closing effective_to (NULL -> value) is allowed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER revenue_split_rule_append_only
  BEFORE UPDATE OR DELETE ON public.revenue_split_rule
  FOR EACH ROW EXECUTE FUNCTION public.revenue_split_rule_guard();

ALTER TABLE public.revenue_split_rule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read split rules" ON public.revenue_split_rule FOR SELECT
  USING (
    public.is_admin_or_officer()
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
  );

CREATE POLICY "superadmin writes split rules" ON public.revenue_split_rule FOR ALL
  USING (public.get_user_role() = 'SUPERADMIN')
  WITH CHECK (public.get_user_role() = 'SUPERADMIN');

-- Seed Somaliland: 100% escrowed to sovereign until Ministry of Finance agreement is formalised.
-- Prevents any premature settlement split from taking effect.
INSERT INTO public.revenue_split_rule
  (jurisdiction_id, effective_from, concessionaire_pct, sovereign_pct,
   contract_ref, signature_hash, signed_by)
VALUES
  ('00000000-0000-4000-8000-00000000534f', NOW(), 0, 100,
   'ESCROW_PENDING_MINFIN', 'PENDING', 'solide')
ON CONFLICT DO NOTHING;

-- DOWN (DESTRUCTIVE: drops the contractual split history — revert all invoice FK references first):
-- DROP TRIGGER IF EXISTS revenue_split_rule_append_only ON public.revenue_split_rule;
-- DROP FUNCTION IF EXISTS public.revenue_split_rule_guard();
-- DROP TABLE IF EXISTS public.revenue_split_rule;
