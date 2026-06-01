-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 072: GreenGate v8 — denormalise jurisdiction_id onto operator + money rail
--
-- Phase 0a (cont.) of the multi-tenant restructuring. Model B (decided in review):
-- an operator (shipowners) is SINGLE-JURISDICTION; payments / wallets / wallet_ledger /
-- refunds / owner_notifications INHERIT that jurisdiction (denormalised) so RLS / the
-- TenantScopedClient wrapper can filter with a direct equality, no joins.
--
-- ADDITIVE + BACKWARD-COMPATIBLE — existing rows backfilled to Somaliland via a constant
-- DEFAULT (expand step; dropped in the contract migration once every write path sets
-- jurisdiction_id explicitly). NO RLS policy is changed here.
--
-- ENFORCEMENT lands NEXT, in two pieces (the Wedge-2 cross-tenant isolation gate):
--   • TenantScopedClient wrapper — the ONLY guard for wallets/wallet_ledger/refunds/
--     owner_notifications, which have RLS enabled but ZERO policies (all access is
--     service-role today). The wrapper injects jurisdiction_id on every query.
--   • mig 072b — staff jurisdiction RLS filter on the POLICIED tables
--     (transactions/payments/vessels/arrival_alerts/shipowners) + isolation pg tests.
--
-- Why split: the RLS policy rewrites are security-critical DROP+reCREATE and only matter
-- once a 2nd jurisdiction exists (Wedge 2). They get their own focused unit + isolation
-- test. This migration is the safe, additive prerequisite for both.
--
-- INDEX NOTE: see mig 071 — plain CREATE INDEX (small tables); CONCURRENTLY for large prod.
-- ─────────────────────────────────────────────────────────────────────────────

-- Operator (shipowners) gets its home jurisdiction (Model B: single-jurisdiction operator).
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

-- Money rail inherits the operator's jurisdiction (denormalised for direct-filter RLS/wrapper).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

ALTER TABLE public.wallet_ledger
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

ALTER TABLE public.owner_notifications
  ADD COLUMN IF NOT EXISTS jurisdiction_id UUID NOT NULL
    DEFAULT '00000000-0000-4000-8000-00000000534f' REFERENCES public.jurisdictions(id);

COMMENT ON COLUMN public.shipowners.jurisdiction_id IS
  'GreenGate v8 (Model B): the operator''s home jurisdiction. A group operating in multiple countries registers one operator per country. money-rail rows inherit this value.';
COMMENT ON COLUMN public.payments.jurisdiction_id IS
  'GreenGate v8 tenant discriminator (inherited from operator/transaction). DEFAULT (Somaliland) is a transitional expand-step net; dropped in the contract migration. Enforced by RLS (mig 072b) + TenantScopedClient.';
COMMENT ON COLUMN public.wallet_ledger.jurisdiction_id IS
  'GreenGate v8 tenant discriminator. wallet_ledger is append-only; jurisdiction is set at INSERT from the wallet''s operator and never changes.';

-- ── indexes (tenant-prefixed; see mig 071 INDEX NOTE) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_shipowners_jurisdiction     ON public.shipowners(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_payments_jurisdiction       ON public.payments(jurisdiction_id, status);
CREATE INDEX IF NOT EXISTS idx_wallets_jurisdiction        ON public.wallets(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_jurisdiction  ON public.wallet_ledger(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_refunds_jurisdiction        ON public.refunds(jurisdiction_id, status);
CREATE INDEX IF NOT EXISTS idx_notif_jurisdiction          ON public.owner_notifications(jurisdiction_id);

-- DOWN:
-- DROP INDEX IF EXISTS public.idx_notif_jurisdiction, public.idx_refunds_jurisdiction,
--   public.idx_wallet_ledger_jurisdiction, public.idx_wallets_jurisdiction,
--   public.idx_payments_jurisdiction, public.idx_shipowners_jurisdiction;
-- ALTER TABLE public.owner_notifications DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.refunds             DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.wallet_ledger       DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.wallets             DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.payments            DROP COLUMN IF EXISTS jurisdiction_id;
-- ALTER TABLE public.shipowners          DROP COLUMN IF EXISTS jurisdiction_id;
