-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 088: GreenGate v8 Wedge 4 — tariff invariants pushed into the table
--
-- FISCAL AUDIT FINDINGS (I1 / I2): mig 080's tariffs_active_guard protects ACTIVE
-- rate fields against mutation but leaves three bypass surfaces:
--
--   BYPASS 1 — Round-trip status laundering (I1):
--     UPDATE status='DRAFT'  → ACTIVE guard skips (OLD=DRAFT on next)
--     UPDATE rate_per_tco2   → guard fires on OLD=DRAFT? NO — 080 guard only
--                              fires when OLD.status='ACTIVE'; once the row is
--                              DRAFT the rate is editable.
--     UPDATE status='ACTIVE' → re-activation, no rate check.
--     Three UPDATEs rewrite a historical decree rate without triggering any guard.
--     FIX: status-transition trigger blocks ACTIVE→DRAFT; only ACTIVE→ARCHIVED
--     is permitted. Re-activation (→ACTIVE) requires effective_from > CURRENT_DATE.
--
--   BYPASS 2 — Retro-INSERT of ACTIVE row (I2):
--     PostgREST INSERT of ACTIVE with effective_from <= CURRENT_DATE bypasses the
--     strictly-future rule in create_tariff_version RPC (mig 084). A retroactively-
--     dated category-specific ACTIVE row silently wins the as_of lookup over the
--     historical NULL-category row, re-pricing past reconciliations.
--     FIX: BEFORE INSERT trigger rejects ACTIVE rows with effective_from <= CURRENT_DATE.
--     ESCAPE HATCH: onboarding migrations that seed at decree dates (migs 080, 082)
--     must run BEFORE 088 in the chain (they do — verified by db reset).
--     Future onboarding migrations that need to seed past-dated ACTIVE rows must
--     wrap their INSERT with:
--       SET LOCAL app.tariffs_allow_retro = 'on';
--       INSERT INTO public.tariffs (...) VALUES (..., 'ACTIVE', ...);
--     The SET LOCAL is transaction-scoped and auto-resets at transaction boundary.
--
--   BYPASS 3 — Missing DELETE / TRUNCATE guards:
--     mig 081 (revenue_split_rule) guards both. tariffs had neither.
--     FIX: mirror the 081 pattern — row-level DELETE trigger + statement-level
--     TRUNCATE trigger, same ERRCODE = 'insufficient_privilege'.
--     The DELETE trigger also honors the app.tariffs_allow_retro escape hatch so
--     that Go test fixture cleanup (DELETE FROM public.tariffs WHERE …) can run
--     inside the same hatch transaction without poisoning subsequent test runs.
--
-- NOTE on ARCHIVED rows:
--   ARCHIVED rows are permanently out of the active lookup (Go filter: status='ACTIVE')
--   and reactivation requires a future effective_from (so ARCHIVED→ACTIVE is also
--   gated). Editing field values on ARCHIVED rows is therefore harmless and is left
--   permitted — no extra guard needed. The existing 080 guard still covers any
--   remaining ACTIVE field-mutation paths.
--
-- DOWN (in order):
--   DROP TRIGGER IF EXISTS tariffs_no_truncate        ON public.tariffs;
--   DROP TRIGGER IF EXISTS tariffs_delete_guard       ON public.tariffs;
--   DROP TRIGGER IF EXISTS tariffs_status_transitions ON public.tariffs;
--   DROP TRIGGER IF EXISTS tariffs_insert_guard       ON public.tariffs;
--   DROP FUNCTION IF EXISTS public.tariffs_truncate_guard();
--   DROP FUNCTION IF EXISTS public.tariffs_delete_guard();
--   DROP FUNCTION IF EXISTS public.tariffs_status_transition_guard();
--   DROP FUNCTION IF EXISTS public.tariffs_retro_insert_guard();
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Status-transition guard ────────────────────────────────────────────────
-- Complements (does NOT replace) the 080 tariffs_active_guard.
-- Rules:
--   a) ACTIVE → only ARCHIVED allowed (kills ACTIVE→DRAFT round-trip).
--   b) →ACTIVE re/activation from any non-ACTIVE status requires effective_from
--      strictly in the future (kills retro-reactivation and round-trip bypass).
CREATE OR REPLACE FUNCTION public.tariffs_status_transition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Rule (a): from ACTIVE, only ARCHIVED is a valid destination.
  IF OLD.status = 'ACTIVE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'tariffs: status transition ACTIVE→% is forbidden; only ACTIVE→ARCHIVED is allowed',
        NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Rule (b): activating (→ACTIVE) from a non-ACTIVE row requires future effective_from.
  IF NEW.status = 'ACTIVE' AND OLD.status <> 'ACTIVE' THEN
    IF NEW.effective_from <= CURRENT_DATE THEN
      RAISE EXCEPTION 'tariffs: cannot activate a row with effective_from % <= CURRENT_DATE; use a strictly-future date',
        NEW.effective_from
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tariffs_status_transitions
  BEFORE UPDATE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.tariffs_status_transition_guard();

-- ── 2. Retro-INSERT guard ──────────────────────────────────────────────────────
-- Blocks direct INSERT of an ACTIVE row with effective_from <= CURRENT_DATE.
-- Escape hatch: SET LOCAL app.tariffs_allow_retro = 'on' (transaction-scoped).
-- The mig 080 + 082 seeds run before this trigger is created in the migration
-- chain — verified by supabase db reset.
CREATE OR REPLACE FUNCTION public.tariffs_retro_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ACTIVE' AND NEW.effective_from <= CURRENT_DATE THEN
    IF current_setting('app.tariffs_allow_retro', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'tariffs: INSERT of ACTIVE row with retroactive effective_from % is forbidden; use create_tariff_version RPC for future-dated versions, or SET LOCAL app.tariffs_allow_retro = ''on'' for onboarding migrations',
        NEW.effective_from
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tariffs_insert_guard
  BEFORE INSERT ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.tariffs_retro_insert_guard();

-- ── 3. DELETE guard ───────────────────────────────────────────────────────────
-- Fiscal rows are permanent — mirrors mig 081 revenue_split_rule pattern exactly.
-- Escape hatch: same GUC as the INSERT guard.  Test fixtures and onboarding
-- rollback helpers may wrap DELETE in a transaction with
--   SET LOCAL app.tariffs_allow_retro = 'on';
-- to bypass this guard.  The GUC is transaction-scoped (SET LOCAL) so it
-- auto-resets at the transaction boundary and never leaks into production paths.
-- NULL-semantics note: current_setting(..., true) returns NULL when the GUC has
-- never been set — IS NOT DISTINCT FROM 'on' is FALSE for NULL, so the guard
-- still fires on unset GUC (fail-closed).
CREATE OR REPLACE FUNCTION public.tariffs_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.tariffs_allow_retro', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN OLD;  -- hatch active: allow DELETE (e.g. test fixture cleanup)
  END IF;
  RAISE EXCEPTION 'tariffs: DELETE forbidden — fiscal rows are permanent'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER tariffs_delete_guard
  BEFORE DELETE ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.tariffs_delete_guard();

-- ── 4. TRUNCATE guard ─────────────────────────────────────────────────────────
-- Statement-level, mirrors mig 081 exactly.
CREATE OR REPLACE FUNCTION public.tariffs_truncate_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tariffs: TRUNCATE forbidden — fiscal rows are permanent'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER tariffs_no_truncate
  BEFORE TRUNCATE ON public.tariffs
  FOR EACH STATEMENT EXECUTE FUNCTION public.tariffs_truncate_guard();
