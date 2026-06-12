-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 089: GreenGate v8 Wedge 4 — transactions fiscal columns immutable
--
-- FISCAL AUDIT FINDING: tariff rates (mig 088) and split rules (mig 081/085) are
-- now trigger-guarded, but the INVOICES themselves — the rows in public.transactions
-- that capture the fiscal snapshot at issuance — remain mutable by convention only.
-- A FINANCE_ADMIN with "FOR ALL" RLS can overwrite tax_amount_usd, emissions_tco2,
-- jurisdiction_id, or tariff_id on any issued invoice and those edits flow live into
-- the settlement view (mig 086) without any DB-layer resistance.
--
-- FIX: BEFORE UPDATE trigger on public.transactions that enforces three categories:
--
--   FROZEN — columns set at INSERT and never legitimately changed thereafter.
--     Changes are rejected with ERRCODE = 'insufficient_privilege'.
--
--   FIRST-WRITE-ONLY — columns that start NULL and may be written exactly once
--     (NULL → value). The change is allowed when OLD IS NULL; a second write
--     (value → different value) is rejected.
--
--   FREE — columns with proven, production-critical UPDATE paths. All others
--     may be updated freely (status transitions, pdf urls, escalation stamps,
--     proof files, etc.).
--
-- FULL COLUMN INVENTORY (42 columns as of mig 089; due_date is GENERATED STORED):
--
--   FROZEN (23) — set at INSERT, no post-insert updater exists in production:
--     id                       — PK, set by DB at INSERT (no production updater)
--     vessel_id                — asset FK, set at INSERT
--     vessel_name              — INPUT to content_hash; freezing the hash output
--                                but not the input was inconsistent
--     vessel_imo               — INPUT to content_hash; same rationale as vessel_name
--     transaction_type         — ENTRY_TAX / EXEMPTION, set at INSERT
--     emissions_tco2           — Go-computed at INSERT
--     tax_amount_usd           — fiscal amount, Go-computed at INSERT, never re-priced
--     rate_usd_per_tco2        — snapshot of tariff rate at issuance
--     distance_eez_nm          — Go-computed geofence measurement at INSERT
--     tariff_id                — snapshot FK, stamped by pipeline INSERT; mig 080 backfill
--     split_rule_id            — snapshot FK, stamped by BEFORE INSERT trigger; mig 085 backfill
--     jurisdiction_id          — tenant discriminator, set at INSERT, never re-assigned
--     mode                     — transport mode discriminator, set at INSERT
--     document_type            — PROFORMA / FINAL / CREDIT_NOTE, set at INSERT
--     related_transaction_id   — back-ref to proforma, set at INSERT on FINAL rows
--     aircraft_id              — asset FK, set at INSERT
--     created_at               — immutable timestamp
--     breakdown_json           — calc breakdown snapshot; T6 (corridor guard) stamps the
--                                RECONCILIATION row at INSERT, no post-insert updater exists
--     emission_factor_used_id  — fiscal snapshot FK (same class as tariff_id); mig 025 seed
--     partial_paid_usd         — mig 022 one-time backfill ONLY (sets existing PAID rows to
--                                tax_amount_usd); the recompute RPC (mig 051) does NOT write
--                                this column — it computes paid totals from the payments table
--                                directly; no production UPDATE path exists post-mig-022
--     port_call                — set at INSERT from vessel.port_call snapshot, no updater
--     arrival_alert_id         — FK set at INSERT, no post-insert reassignment
--     ref                      — minted by mig 006 BEFORE INSERT trigger (seq-based human ref);
--                                no production UPDATE path exists
--
--   FIRST-WRITE-ONLY (6) — NULL → value allowed once; change once set → reject:
--     invoice_ref              — minted by /invoices/generate or /payments/create (null→val)
--     content_hash             — minted by /invoices/generate (null→val)
--     verify_signature         — minted by /invoices/generate (null→val)
--     shipowner_id             — mig 070 NULL→value backfill; claim flow writes vessels,
--                                not transactions directly; FREE re-pointing a PAID invoice's
--                                shipowner is the exact fraud class this lock targets
--     debtor_profile_id        — mig 022 NULL→value backfill; triage NULL→assign is the only
--                                proven write path; re-assigning on a PAID invoice = fraud risk
--     agent_profile_id         — mig 026 NULL→value assignment; no production re-point path
--
--   GENERATED (1) — self-protected by PostgreSQL STORED column semantics:
--     due_date                 — GENERATED ALWAYS AS (created_at + 30d expr) STORED;
--                                PostgreSQL rejects any direct UPDATE attempt automatically
--
--   FREE (12) — proven, production-critical UPDATE paths exist:
--     status                   — recompute_transaction_status RPC, mark-paid, paymentService
--     collections_status       — recompute_transaction_status RPC (mig 051), cron backfill
--     paid_at                  — mark-paid, recompute_transaction_status
--     settlement_effective_at  — recompute_transaction_status RPC (mig 051)
--     invoice_pdf_url          — proformaPipelineService, reconcilePipelineService, /invoices/generate
--     receipt_pdf_url          — mark-paid route
--     proforma_sent_at         — /invoices/generate (send email path, first-time stamp)
--     payment_proof_files      — /transactions/[id]/proof routes (append/remove)
--     escalated_to_owner_at    — escalateToOwner action
--     escalated_to_owner_email — escalateToOwner action
--     escalated_by             — escalateToOwner action
--     owner_escalation_due_at  — unpaid-escalation cron (mig 037 fn, also direct UPDATE in cron)
--
-- ESCAPE HATCH for backfill migrations:
--   SET LOCAL app.transactions_allow_backfill = 'on';
--   (transaction-scoped; auto-resets at transaction boundary)
--   SEMANTICS: under the hatch, every column check is reduced to first-write semantics
--   (NULL → value is allowed for any column). Modifying an already-set frozen value
--   is STILL rejected even with the hatch active — the hatch only opens the NULL slot,
--   it does not grant unconditional write access to frozen data.
--
-- MAINTENANCE: keep this trigger in sync when adding new columns to transactions.
-- Pattern from mig 081 (split rule DELETE/TRUNCATE) and 088 (tariff invariants).
--
-- DOWN:
--   DROP TRIGGER IF EXISTS transactions_fiscal_immutable  ON public.transactions;
--   DROP TRIGGER IF EXISTS transactions_no_delete         ON public.transactions;
--   DROP TRIGGER IF EXISTS transactions_no_truncate       ON public.transactions;
--   DROP FUNCTION IF EXISTS public.transactions_fiscal_immutable_guard();
--   DROP FUNCTION IF EXISTS public.transactions_delete_guard();
--   DROP FUNCTION IF EXISTS public.transactions_truncate_guard();
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. BEFORE UPDATE — fiscal column immutability ────────────────────────────
CREATE OR REPLACE FUNCTION public.transactions_fiscal_immutable_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  allow_backfill BOOLEAN;
BEGIN
  -- Escape hatch: migration-era backfill operations may set this session variable.
  -- SEMANTICS: reduces every check to first-write semantics (NULL → value allowed).
  -- An already-set frozen value is STILL rejected even with the hatch active —
  -- the hatch only opens the NULL slot; unconditional overwrite of frozen data
  -- remains blocked to prevent the hatch from being a bypass vector.
  allow_backfill := (current_setting('app.transactions_allow_backfill', true) = 'on');

  -- ── FROZEN: set at INSERT, never legitimately changed post-insert ───────────
  -- Under the backfill hatch, frozen checks become first-write-only (NULL → value
  -- is permitted; non-NULL → different value is still rejected).

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    IF NOT (allow_backfill AND OLD.id IS NULL) THEN
      RAISE EXCEPTION 'transactions: id is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.vessel_id IS DISTINCT FROM OLD.vessel_id THEN
    IF NOT (allow_backfill AND OLD.vessel_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: vessel_id is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.vessel_name IS DISTINCT FROM OLD.vessel_name THEN
    IF NOT (allow_backfill AND OLD.vessel_name IS NULL) THEN
      RAISE EXCEPTION 'transactions: vessel_name is frozen after INSERT — it is an INPUT to content_hash; freezing the hash output but not the input was inconsistent'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.vessel_imo IS DISTINCT FROM OLD.vessel_imo THEN
    IF NOT (allow_backfill AND OLD.vessel_imo IS NULL) THEN
      RAISE EXCEPTION 'transactions: vessel_imo is frozen after INSERT — it is an INPUT to content_hash'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.transaction_type IS DISTINCT FROM OLD.transaction_type THEN
    IF NOT (allow_backfill AND OLD.transaction_type IS NULL) THEN
      RAISE EXCEPTION 'transactions: transaction_type is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.emissions_tco2 IS DISTINCT FROM OLD.emissions_tco2 THEN
    IF NOT (allow_backfill AND OLD.emissions_tco2 IS NULL) THEN
      RAISE EXCEPTION 'transactions: emissions_tco2 is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.tax_amount_usd IS DISTINCT FROM OLD.tax_amount_usd THEN
    IF NOT (allow_backfill AND OLD.tax_amount_usd IS NULL) THEN
      RAISE EXCEPTION 'transactions: tax_amount_usd is frozen after INSERT — fiscal amount cannot be re-priced post-issuance'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.rate_usd_per_tco2 IS DISTINCT FROM OLD.rate_usd_per_tco2 THEN
    IF NOT (allow_backfill AND OLD.rate_usd_per_tco2 IS NULL) THEN
      RAISE EXCEPTION 'transactions: rate_usd_per_tco2 is frozen after INSERT — tariff rate snapshot cannot be overwritten'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.distance_eez_nm IS DISTINCT FROM OLD.distance_eez_nm THEN
    IF NOT (allow_backfill AND OLD.distance_eez_nm IS NULL) THEN
      RAISE EXCEPTION 'transactions: distance_eez_nm is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.tariff_id IS DISTINCT FROM OLD.tariff_id THEN
    IF NOT (allow_backfill AND OLD.tariff_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: tariff_id is frozen after INSERT — tariff snapshot FK cannot be reassigned'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.split_rule_id IS DISTINCT FROM OLD.split_rule_id THEN
    IF NOT (allow_backfill AND OLD.split_rule_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: split_rule_id is frozen after INSERT — split rule snapshot FK cannot be reassigned'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.jurisdiction_id IS DISTINCT FROM OLD.jurisdiction_id THEN
    IF NOT (allow_backfill AND OLD.jurisdiction_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: jurisdiction_id is frozen after INSERT — tenant discriminator cannot be re-assigned'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.mode IS DISTINCT FROM OLD.mode THEN
    IF NOT (allow_backfill AND OLD.mode IS NULL) THEN
      RAISE EXCEPTION 'transactions: mode is frozen after INSERT — transport mode discriminator cannot be changed'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.document_type IS DISTINCT FROM OLD.document_type THEN
    IF NOT (allow_backfill AND OLD.document_type IS NULL) THEN
      RAISE EXCEPTION 'transactions: document_type is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.related_transaction_id IS DISTINCT FROM OLD.related_transaction_id THEN
    IF NOT (allow_backfill AND OLD.related_transaction_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: related_transaction_id is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.aircraft_id IS DISTINCT FROM OLD.aircraft_id THEN
    IF NOT (allow_backfill AND OLD.aircraft_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: aircraft_id is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    IF NOT (allow_backfill AND OLD.created_at IS NULL) THEN
      RAISE EXCEPTION 'transactions: created_at is frozen after INSERT'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.breakdown_json IS DISTINCT FROM OLD.breakdown_json THEN
    IF NOT (allow_backfill AND OLD.breakdown_json IS NULL) THEN
      RAISE EXCEPTION 'transactions: breakdown_json is frozen after INSERT — calculation breakdown snapshot cannot be overwritten'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.emission_factor_used_id IS DISTINCT FROM OLD.emission_factor_used_id THEN
    IF NOT (allow_backfill AND OLD.emission_factor_used_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: emission_factor_used_id is frozen after INSERT — fiscal snapshot FK, same class as tariff_id'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.partial_paid_usd IS DISTINCT FROM OLD.partial_paid_usd THEN
    IF NOT (allow_backfill AND OLD.partial_paid_usd IS NULL) THEN
      RAISE EXCEPTION 'transactions: partial_paid_usd is frozen after INSERT — only writer was the mig 022 one-time backfill; the recompute_transaction_status RPC (mig 051) computes paid totals from the payments table directly and does NOT write this column'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.port_call IS DISTINCT FROM OLD.port_call THEN
    IF NOT (allow_backfill AND OLD.port_call IS NULL) THEN
      RAISE EXCEPTION 'transactions: port_call is frozen after INSERT — vessel.port_call snapshot at issuance, no post-insert updater'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.arrival_alert_id IS DISTINCT FROM OLD.arrival_alert_id THEN
    IF NOT (allow_backfill AND OLD.arrival_alert_id IS NULL) THEN
      RAISE EXCEPTION 'transactions: arrival_alert_id is frozen after INSERT — FK set at INSERT, no post-insert reassignment'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.ref IS DISTINCT FROM OLD.ref THEN
    IF NOT (allow_backfill AND OLD.ref IS NULL) THEN
      RAISE EXCEPTION 'transactions: ref is frozen after INSERT — minted by mig 006 BEFORE INSERT trigger, no production UPDATE path'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ── FIRST-WRITE-ONLY: NULL → value allowed; change once set → reject ────────
  -- Under the backfill hatch, first-write-only columns behave identically
  -- (the hatch adds no extra privilege here — same NULL → value semantics apply).

  -- invoice_ref: minted by /invoices/generate or /payments/create
  IF OLD.invoice_ref IS NOT NULL AND NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref THEN
    RAISE EXCEPTION 'transactions: invoice_ref is first-write-only — once set it cannot be changed (distributed PDFs carry this ref in their QR code)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- content_hash: SHA-256 of canonical invoice payload, minted by /invoices/generate
  IF OLD.content_hash IS NOT NULL AND NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    RAISE EXCEPTION 'transactions: content_hash is first-write-only — overwriting it would invalidate already-distributed PDF QR codes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- verify_signature: HMAC for edge verification, minted by /invoices/generate
  IF OLD.verify_signature IS NOT NULL AND NEW.verify_signature IS DISTINCT FROM OLD.verify_signature THEN
    RAISE EXCEPTION 'transactions: verify_signature is first-write-only — overwriting it would break PDF verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- shipowner_id: mig 070 NULL→value backfill; FREE re-pointing on a PAID invoice
  -- is the exact fraud class (re-directing settlement) this lock targets
  IF OLD.shipowner_id IS NOT NULL AND NEW.shipowner_id IS DISTINCT FROM OLD.shipowner_id THEN
    RAISE EXCEPTION 'transactions: shipowner_id is first-write-only — re-pointing on an already-assigned invoice would redirect settlement attribution'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- debtor_profile_id: mig 022 NULL→value backfill; triage NULL→assign is the only
  -- proven write path; re-assigning on a PAID invoice would corrupt credit ledger
  IF OLD.debtor_profile_id IS NOT NULL AND NEW.debtor_profile_id IS DISTINCT FROM OLD.debtor_profile_id THEN
    RAISE EXCEPTION 'transactions: debtor_profile_id is first-write-only — re-assigning on an already-attributed invoice would corrupt the credit ledger'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- agent_profile_id: mig 026 NULL→value assignment; no production re-point path
  IF OLD.agent_profile_id IS NOT NULL AND NEW.agent_profile_id IS DISTINCT FROM OLD.agent_profile_id THEN
    RAISE EXCEPTION 'transactions: agent_profile_id is first-write-only — no production re-point path exists'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_fiscal_immutable
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_fiscal_immutable_guard();

-- ── 2. DELETE guard ───────────────────────────────────────────────────────────
-- Production flows never DELETE transactions (test fixtures use ROLLBACK).
-- Mirror the mig 081/088 pattern exactly.
CREATE OR REPLACE FUNCTION public.transactions_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'transactions: DELETE forbidden — fiscal rows are permanent'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER transactions_no_delete
  BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.transactions_delete_guard();

-- ── 3. TRUNCATE guard ─────────────────────────────────────────────────────────
-- Statement-level, mirrors mig 081/088 pattern exactly.
-- NOTE: PostgreSQL will raise 0A000 (feature_not_supported) before this trigger
-- fires if FK-dependent child tables exist and TRUNCATE CASCADE is not used —
-- either way TRUNCATE is blocked.
CREATE OR REPLACE FUNCTION public.transactions_truncate_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'transactions: TRUNCATE forbidden — fiscal rows are permanent'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER transactions_no_truncate
  BEFORE TRUNCATE ON public.transactions
  FOR EACH STATEMENT EXECUTE FUNCTION public.transactions_truncate_guard();
