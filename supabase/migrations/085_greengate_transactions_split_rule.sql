-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 085: GreenGate v8 Wedge 3 — split_rule_id snapshot on transactions
--
-- D3 issuance-date stamping: every invoice references the revenue-split rule
-- applicable at its ISSUANCE date. The trigger approach covers ALL insert paths
-- (TS server actions, Go calculator pipeline, legacy writes) without touching
-- application code. Backfill stamps existing rows by their created_at; rows
-- predating any rule stay NULL and are flagged by the settlement view (mig 086).
--
-- Design notes:
--   • SECURITY DEFINER required: revenue_split_rule has staff-only read RLS;
--     the trigger must stamp inserts for every caller role (service-role,
--     Go pool, anon edge functions) — not just staff.
--   • NULL is valid post-trigger: no rule covers the issuance instant
--     (pre-activation period or gap). The settlement view (mig 086) flags
--     these as UNATTRIBUTED — they are never silently zeroed.
--   • The mig 081 exclusion constraint guarantees at most one rule per
--     jurisdiction per instant → LIMIT 1 in the lookup is a safety guard,
--     not a disambiguation heuristic.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS split_rule_id UUID REFERENCES public.revenue_split_rule(id);

COMMENT ON COLUMN public.transactions.split_rule_id IS
  'Revenue split rule applicable at ISSUANCE (D3). Stamped by trigger at INSERT — never updated after issue. NULL = unattributed (no rule covered the issuance date; the settlement view flags it).';

-- SECURITY DEFINER: revenue_split_rule has staff-only read RLS; stamping must work
-- for every insert path (service-role, Go pool, legacy).
CREATE OR REPLACE FUNCTION public.transactions_stamp_split_rule()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.split_rule_id IS NULL THEN
    SELECT r.id INTO NEW.split_rule_id
      FROM public.revenue_split_rule r
     WHERE r.jurisdiction_id = NEW.jurisdiction_id
       AND r.effective_from <= COALESCE(NEW.created_at, NOW())
       AND (r.effective_to IS NULL OR r.effective_to > COALESCE(NEW.created_at, NOW()))
     LIMIT 1;   -- mig 081 exclusion constraint guarantees at most one rule per instant
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transactions_stamp_split_rule
  BEFORE INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_stamp_split_rule();

-- Backfill existing rows by their created_at (rows predating any rule stay NULL — flagged by the settlement view).
UPDATE public.transactions t
   SET split_rule_id = r.id
  FROM public.revenue_split_rule r
 WHERE t.split_rule_id IS NULL
   AND r.jurisdiction_id = t.jurisdiction_id
   AND r.effective_from <= t.created_at
   AND (r.effective_to IS NULL OR r.effective_to > t.created_at);

-- DOWN (DESTRUCTIVE: drops the issuance attribution on existing invoices):
-- DROP TRIGGER IF EXISTS transactions_stamp_split_rule ON public.transactions;
-- DROP FUNCTION IF EXISTS public.transactions_stamp_split_rule();
-- ALTER TABLE public.transactions DROP COLUMN IF EXISTS split_rule_id;
