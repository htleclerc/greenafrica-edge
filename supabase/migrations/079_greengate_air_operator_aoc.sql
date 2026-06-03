-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 079: GreenGate v8 — Wedge 1-E air operator identity (AOC)
-- Adds the air-mode operator identity field (mirror of imo_company_no) and
-- extends the proof_doc_type CHECK (mig 047) to accept the AOC certificate.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS aoc_number TEXT;

COMMENT ON COLUMN public.shipowners.aoc_number IS
  'GreenGate v8 W1-E: Air Operator Certificate number. Air-mode identity proof; admin pre-seeds the expected value on the GHOST operator so self-service auto-claim can match it. Air equivalent of imo_company_no.';

-- mig 047 created the constraint inline via ADD COLUMN, so PostgreSQL named it
-- shipowners_proof_doc_type_check. Drop + recreate with 'AOC' added.
ALTER TABLE public.shipowners DROP CONSTRAINT IF EXISTS shipowners_proof_doc_type_check;
ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_proof_doc_type_check
  CHECK (proof_doc_type IN ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER','AOC'));
-- DOWN: ALTER TABLE public.shipowners DROP CONSTRAINT IF EXISTS shipowners_proof_doc_type_check;
--       ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_proof_doc_type_check
--         CHECK (proof_doc_type IN ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER'));
--       ALTER TABLE public.shipowners DROP COLUMN IF EXISTS aoc_number;
