# Plan 7C-1 — Payments Backend Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the backend foundation for the multi-rail payments system so subsequent plans (7C-2 PayDialog, 7C-3 admin refonte, 7C-4 cash desk + receipts, 7C-5 cutover) can plug in UI without rewriting business logic. No UI changes in this plan.

**Architecture:** Three Postgres migrations add the authorization function, RLS policies, and wallet auto-apply trigger. Two TypeScript services (`fxRateService`, `paymentService`) plus five server actions (`initiatePayment`, `confirmPayment`, `rejectPayment`, `cancelPayment`, `applyWallet`) wrap the `payments` table created in Plan 7A (mig 048). Server actions are typed and unit-tested but no page imports them — that's 7C-2/7C-3.

**Tech Stack:** PostgreSQL 17 / Supabase / Next.js 16 server actions / Zod validation / TypeScript strict / Vitest / OpenExchangeRates API for FX. Reuses Plan 7A's `wallets`, `wallet_ledger`, `fx_rates`, `transactions.recompute_transaction_status()`, `audit_logs`.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §7.1-7.6.

**Predecessor:** Plan 7A (PR #17) — already merged. Plan 7B (PR #18/#19) — already merged. All migrations 047-056 must be applied before any task here runs.

**Successor:** Plan 7C-2 will consume the server actions written here from `<PayDialog>`. The actions are designed to be fully callable from the existing legacy admin UI via a feature flag if mid-migration testing is needed.

---

## File Structure

### Files to create

```
supabase/migrations/
├── 057_can_confirm_payment.sql              # authorization SQL function
├── 058_payments_rls.sql                     # RLS on payments + payment_proofs
└── 059_wallet_auto_apply.sql                # trigger + storage bucket

supabase/tests/migrations/
├── 057_can_confirm_payment.test.sql
├── 058_payments_rls.test.sql
└── 059_wallet_auto_apply.test.sql

frontend/src/
├── services/
│   ├── fxRateService.ts                     # lockRate() + OpenExchangeRates fetch
│   ├── fxRateService.test.ts
│   ├── paymentService.ts                    # typed read helpers
│   └── paymentService.test.ts
└── actions/
    ├── initiatePayment.ts                   # locks FX, INSERT INITIATED
    ├── initiatePayment.test.ts
    ├── confirmPayment.ts                    # auth-check + UPDATE CONFIRMED + recompute
    ├── confirmPayment.test.ts
    ├── rejectPayment.ts                     # admin → REJECTED + reason
    ├── rejectPayment.test.ts
    ├── cancelPayment.ts                     # armateur cancels own INITIATED
    ├── cancelPayment.test.ts
    ├── applyWallet.ts                       # transactional WALLET payment + ledger
    └── applyWallet.test.ts
```

### Files to modify

```
frontend/.env.example                         # add OPENEXCHANGE_RATES_API_KEY placeholder
```

### Test runners

```bash
# Postgres migration tests
./supabase/tests/run.sh migrations/057_can_confirm_payment.test.sql
./supabase/tests/run.sh migrations/058_payments_rls.test.sql
./supabase/tests/run.sh migrations/059_wallet_auto_apply.test.sql

# Frontend Vitest (single file)
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/actions/initiatePayment.test.ts

# Full vitest
npx vitest run
```

---

## Task 1: Migration 057 — `can_confirm_payment()` authorization function

**Files:**
- Create: `supabase/migrations/057_can_confirm_payment.sql`
- Create: `supabase/tests/migrations/057_can_confirm_payment.test.sql`

This function encodes the authorization matrix from spec §7.2:

| Rail | Confirmer |
|---|---|
| STRIPE | webhook (system) — function returns FALSE for human callers |
| WIRE_TRANSFER, MOBILE_MONEY, CHEQUE, LETTER_OF_CREDIT, THIRD_PARTY | FINANCE_ADMIN |
| CASH | FINANCE_ADMIN, AND must differ from `declared_by` (4-eyes) |
| NETTING, BANK_GUARANTEE | SUPERADMIN |
| WALLET | nobody (auto-confirmed at insert; function returns FALSE) |

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/057_can_confirm_payment.test.sql`:

```sql
BEGIN;

-- seed: two finance admins + one superadmin + one shipping agent + one shipowner
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'finance1@test'),
  ('22222222-2222-2222-2222-222222222222', 'finance2@test'),
  ('33333333-3333-3333-3333-333333333333', 'super@test'),
  ('44444444-4444-4444-4444-444444444444', 'agent@test');

INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'finance1@test', 'F1', 'FINANCE_ADMIN', true),
  ('22222222-2222-2222-2222-222222222222', 'finance2@test', 'F2', 'FINANCE_ADMIN', true),
  ('33333333-3333-3333-3333-333333333333', 'super@test', 'S',  'SUPERADMIN',     true),
  ('44444444-4444-4444-4444-444444444444', 'agent@test', 'A',  'SHIPPING_AGENT', true);

INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Co', 'ACTIVE', 'en');

-- WIRE_TRANSFER initiated by finance1: any FINANCE_ADMIN can confirm
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('11111111-aaaa-aaaa-aaaa-111111111111',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          100000, 'USD', 100000, 'WIRE_TRANSFER', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  ) IS TRUE, 'WIRE: any FINANCE_ADMIN can confirm';
  ASSERT public.can_confirm_payment(
    '11111111-aaaa-aaaa-aaaa-111111111111'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid
  ) IS FALSE, 'WIRE: SHIPPING_AGENT cannot confirm';
END $$;

-- CASH declared by finance1: only finance2 (≠ declarer) can confirm (4-eyes)
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('22222222-aaaa-aaaa-aaaa-222222222222',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          50000, 'USD', 50000, 'CASH', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '22222222-aaaa-aaaa-aaaa-222222222222'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  ) IS FALSE, 'CASH: same person cannot self-confirm (4-eyes)';
  ASSERT public.can_confirm_payment(
    '22222222-aaaa-aaaa-aaaa-222222222222'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  ) IS TRUE, 'CASH: different FINANCE_ADMIN can confirm';
END $$;

-- NETTING: only SUPERADMIN
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('33333333-aaaa-aaaa-aaaa-333333333333',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111',
          200000, 'USD', 200000, 'NETTING', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '33333333-aaaa-aaaa-aaaa-333333333333'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  ) IS FALSE, 'NETTING: FINANCE_ADMIN cannot confirm';
  ASSERT public.can_confirm_payment(
    '33333333-aaaa-aaaa-aaaa-333333333333'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid
  ) IS TRUE, 'NETTING: SUPERADMIN can confirm';
END $$;

-- WALLET + STRIPE: nobody (system-only / auto)
INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status)
  VALUES ('44444444-aaaa-aaaa-aaaa-444444444444',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          NULL, 1000, 'USD', 1000, 'WALLET', 'INITIATED');

DO $$ BEGIN
  ASSERT public.can_confirm_payment(
    '44444444-aaaa-aaaa-aaaa-444444444444'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid
  ) IS FALSE, 'WALLET: even SUPERADMIN cannot manually confirm';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run pg test to verify it fails**

Run: `./supabase/tests/run.sh migrations/057_can_confirm_payment.test.sql`
Expected: FAIL with `function public.can_confirm_payment(uuid, uuid) does not exist`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/057_can_confirm_payment.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 057: can_confirm_payment() — authorization matrix from spec §7.2
-- Reusable from RLS policies AND server-action gate. Single source of truth.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_confirm_payment(
  p_payment_id UUID,
  p_profile_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_rail        public.payment_rail;
  v_status      public.payment_status_v7;
  v_declared_by UUID;
  v_role        public.user_role;
BEGIN
  SELECT rail, status, declared_by INTO v_rail, v_status, v_declared_by
    FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND OR v_status NOT IN ('INITIATED', 'PROCESSING') THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles
    WHERE id = p_profile_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- WALLET and STRIPE are system-confirmed (trigger / webhook), never human
  IF v_rail IN ('WALLET', 'STRIPE') THEN
    RETURN FALSE;
  END IF;

  -- NETTING and BANK_GUARANTEE require SUPERADMIN
  IF v_rail IN ('NETTING', 'BANK_GUARANTEE') THEN
    RETURN v_role = 'SUPERADMIN';
  END IF;

  -- CASH requires 4-eyes: FINANCE_ADMIN/SUPERADMIN AND ≠ declarer
  IF v_rail = 'CASH' THEN
    RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN')
       AND v_declared_by IS DISTINCT FROM p_profile_id;
  END IF;

  -- Default rails (WIRE_TRANSFER, MOBILE_MONEY, CHEQUE, LC, THIRD_PARTY):
  -- FINANCE_ADMIN or SUPERADMIN
  RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.can_confirm_payment(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_confirm_payment(UUID, UUID) IS
  'Plan 7C: encodes authorization matrix from spec §7.2. Reused from payments RLS confirm policy and server actions.';

-- DOWN:
-- DROP FUNCTION public.can_confirm_payment(UUID, UUID);
```

- [ ] **Step 4: Run pg test to verify it passes**

Run: `./supabase/tests/run.sh migrations/057_can_confirm_payment.test.sql`
Expected: PASS, all DO blocks succeed

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/057_can_confirm_payment.sql \
        supabase/tests/migrations/057_can_confirm_payment.test.sql
git commit -m "feat(plan7c): mig 057 — can_confirm_payment() authorization matrix"
```

---

## Task 2: Migration 058 — RLS policies on `payments` and `payment_proofs`

**Files:**
- Create: `supabase/migrations/058_payments_rls.sql`
- Create: `supabase/tests/migrations/058_payments_rls.test.sql`

Plan 7A enabled RLS on `public.payments` but added no policies — service-role-only. This task adds the four policies needed for owner + admin operations.

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/058_payments_rls.test.sql`:

```sql
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test'),
  ('33333333-3333-3333-3333-333333333333', 'fin@test');

INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test', 'A', 'SHIPOWNER',     true),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test', 'B', 'SHIPOWNER',     true),
  ('33333333-3333-3333-3333-333333333333', 'fin@test',     'F', 'FINANCE_ADMIN', true);

INSERT INTO public.shipowners (id, name, account_state, official_email, preferred_language) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OwnerA', 'ACTIVE', 'owner-a@test', 'en'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'OwnerB', 'ACTIVE', 'owner-b@test', 'en');

UPDATE public.profiles SET shipowner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET shipowner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  WHERE id = '22222222-2222-2222-2222-222222222222';

INSERT INTO public.payments (id, shipowner_id, declared_by, amount_minor, currency,
                             amount_usd_minor, rail, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 100, 'USD', 100, 'WIRE_TRANSFER', 'INITIATED'),
  ('b0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 200, 'USD', 200, 'WIRE_TRANSFER', 'INITIATED');

-- Owner A reads only own payments
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.payments;
  ASSERT v_count = 1, format('owner_a should see 1 payment, got %s', v_count);
  PERFORM 1 FROM public.payments WHERE id = 'a0000000-0000-0000-0000-000000000001';
  ASSERT FOUND, 'owner_a should see own payment';
END $$;

-- Owner A cannot UPDATE someone else's payment
DO $$ BEGIN
  UPDATE public.payments SET status='CANCELLED'
    WHERE id = 'b0000000-0000-0000-0000-000000000002';
  ASSERT (SELECT status FROM public.payments WHERE id = 'b0000000-0000-0000-0000-000000000002') = 'INITIATED'
    USING MESSAGE = 'owner_a should not be able to update owner_b payment';
END $$;

-- FINANCE_ADMIN reads everything
SET LOCAL "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

DO $$
DECLARE v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.payments;
  ASSERT v_count = 2, format('finance_admin should see 2 payments, got %s', v_count);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run pg test to verify it fails**

Run: `./supabase/tests/run.sh migrations/058_payments_rls.test.sql`
Expected: FAIL — owner_a sees 2 rows (no SELECT policy yet, RLS denies all without policies → 0 rows OR depending on default)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/058_payments_rls.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 058: RLS policies on payments + payment_proofs
-- Plan 7A enabled RLS but added no policies. This migration unlocks the table
-- for owner reads/inserts/cancels and admin reads/updates.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: profile.shipowner_id for current auth.uid()
CREATE OR REPLACE FUNCTION public.current_shipowner_id() RETURNS UUID AS $$
  SELECT shipowner_id FROM public.profiles
   WHERE id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.current_shipowner_id() TO authenticated;

-- ── public.payments ─────────────────────────────────────────────────────────

CREATE POLICY payments_owner_select ON public.payments FOR SELECT
  TO authenticated
  USING (shipowner_id = public.current_shipowner_id());

CREATE POLICY payments_admin_select ON public.payments FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
  ));

CREATE POLICY payments_owner_insert ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    shipowner_id = public.current_shipowner_id()
    AND status = 'INITIATED'
    AND rail IN ('WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET')
  );

CREATE POLICY payments_admin_insert ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- Owner can CANCEL own INITIATED payment (status flip only, no other field change)
CREATE POLICY payments_owner_cancel ON public.payments FOR UPDATE
  TO authenticated
  USING (
    shipowner_id = public.current_shipowner_id()
    AND status = 'INITIATED'
  )
  WITH CHECK (
    shipowner_id = public.current_shipowner_id()
    AND status IN ('INITIATED', 'CANCELLED')
  );

-- Admin UPDATE — server actions enforce can_confirm_payment; RLS just gates
-- which roles can issue UPDATE at all
CREATE POLICY payments_admin_update ON public.payments FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- ── public.payment_proofs ───────────────────────────────────────────────────

CREATE POLICY payment_proofs_owner_select ON public.payment_proofs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.payments pmt
     WHERE pmt.id = payment_proofs.payment_id
       AND pmt.shipowner_id = public.current_shipowner_id()
  ));

CREATE POLICY payment_proofs_admin_select ON public.payment_proofs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
  ));

CREATE POLICY payment_proofs_owner_insert ON public.payment_proofs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payments pmt
     WHERE pmt.id = payment_proofs.payment_id
       AND pmt.shipowner_id = public.current_shipowner_id()
       AND pmt.status = 'INITIATED'
  ));

CREATE POLICY payment_proofs_admin_insert ON public.payment_proofs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
       AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
  ));

-- DOWN:
-- DROP POLICY payments_owner_select ON public.payments;
-- DROP POLICY payments_admin_select ON public.payments;
-- DROP POLICY payments_owner_insert ON public.payments;
-- DROP POLICY payments_admin_insert ON public.payments;
-- DROP POLICY payments_owner_cancel ON public.payments;
-- DROP POLICY payments_admin_update ON public.payments;
-- DROP POLICY payment_proofs_owner_select ON public.payment_proofs;
-- DROP POLICY payment_proofs_admin_select ON public.payment_proofs;
-- DROP POLICY payment_proofs_owner_insert ON public.payment_proofs;
-- DROP POLICY payment_proofs_admin_insert ON public.payment_proofs;
-- DROP FUNCTION public.current_shipowner_id();
```

- [ ] **Step 4: Run pg test to verify it passes**

Run: `./supabase/tests/run.sh migrations/058_payments_rls.test.sql`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/058_payments_rls.sql \
        supabase/tests/migrations/058_payments_rls.test.sql
git commit -m "feat(plan7c): mig 058 — RLS policies on payments + payment_proofs"
```

---

## Task 3: Migration 059 — wallet auto-apply trigger + storage bucket

**Files:**
- Create: `supabase/migrations/059_wallet_auto_apply.sql`
- Create: `supabase/tests/migrations/059_wallet_auto_apply.test.sql`

Spec §7.2 WALLET option C: when a PROFORMA `transactions` row is inserted, if the shipowner has `auto_apply_to_proforma=TRUE` and the wallet has sufficient balance, automatically debit the wallet and mark the transaction PAID/PARTIALLY_PAID. Plus the Storage bucket for proof uploads.

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/059_wallet_auto_apply.test.sql`:

```sql
BEGIN;

INSERT INTO public.shipowners (id, name, account_state, preferred_language, auto_apply_to_proforma)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AutoOwner', 'ACTIVE', 'en', true);

INSERT INTO public.wallets (shipowner_id, balance_usd_minor)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 500000);  -- $5000.00

-- Seed a wallet_ledger entry to match the balance (invariant check)
INSERT INTO public.wallet_ledger (shipowner_id, kind, amount_signed_usd_minor, source_ref)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TOPUP', 500000, 'seed');

-- Insert a vessel
INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code,
                            category, gross_tonnage_dwt, engine_power_kw,
                            design_speed_knots, shipowner_id)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '7777777', '777777777', 'TestVes', 'ZZZ', 'SO', 'CONTAINER',
          1000, 500, 10,
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Insert a PROFORMA worth $3000
INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo,
                                 emissions_tco2, tax_amount_usd, document_type,
                                 transaction_type, shipowner_id, status)
  VALUES ('22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111', 'TestVes', '7777777',
          100, 3000, 'PROFORMA', 'ENTRY_TAX',
          'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PENDING');

-- Trigger should have fired: ledger has PROFORMA_APPLY -300000 minor; wallet → 200000;
-- transaction → PAID
DO $$
DECLARE v_balance BIGINT; v_status TEXT;
BEGIN
  SELECT balance_usd_minor INTO v_balance FROM public.wallets
    WHERE shipowner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  ASSERT v_balance = 200000, format('expected wallet 200000, got %s', v_balance);

  SELECT status INTO v_status FROM public.transactions
    WHERE id = '22222222-2222-2222-2222-222222222222';
  ASSERT v_status = 'PAID', format('expected status PAID, got %s', v_status);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run pg test to verify it fails**

Run: `./supabase/tests/run.sh migrations/059_wallet_auto_apply.test.sql`
Expected: FAIL — wallet still 500000, transaction still PENDING (trigger doesn't exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/059_wallet_auto_apply.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 059: Wallet auto-apply on PROFORMA insert + payment-proofs bucket
-- Spec §7.2 WALLET option C. Skips if shipowner.auto_apply_to_proforma=FALSE
-- or wallet balance is zero. Concurrency-safe via SELECT … FOR UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auto_apply_wallet_to_proforma()
RETURNS TRIGGER AS $$
DECLARE
  v_auto_apply  BOOLEAN;
  v_balance     BIGINT;
  v_due_minor   BIGINT;
  v_apply_minor BIGINT;
  v_payment_id  UUID;
BEGIN
  IF NEW.document_type <> 'PROFORMA' OR NEW.shipowner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT auto_apply_to_proforma INTO v_auto_apply FROM public.shipowners
    WHERE id = NEW.shipowner_id;

  IF NOT COALESCE(v_auto_apply, FALSE) THEN
    RETURN NEW;
  END IF;

  -- Lock the wallet row to prevent concurrent applies
  SELECT balance_usd_minor INTO v_balance FROM public.wallets
    WHERE shipowner_id = NEW.shipowner_id FOR UPDATE;

  IF NOT FOUND OR v_balance <= 0 THEN
    RETURN NEW;
  END IF;

  v_due_minor := (NEW.tax_amount_usd * 100)::BIGINT;
  v_apply_minor := LEAST(v_balance, v_due_minor);

  -- Insert WALLET payment row (already CONFIRMED — auto)
  INSERT INTO public.payments (
    transaction_id, shipowner_id, declared_by, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at, rail_details
  ) VALUES (
    NEW.id, NEW.shipowner_id, NULL, v_apply_minor, 'USD',
    v_apply_minor, 'WALLET', 'CONFIRMED', NULL, NOW(),
    jsonb_build_object('auto_applied', true)
  ) RETURNING id INTO v_payment_id;

  -- Ledger entry (negative — debit). Trigger on wallet_ledger
  -- (apply_ledger_to_wallet, mig 050) syncs wallets.balance_usd_minor.
  INSERT INTO public.wallet_ledger (
    shipowner_id, kind, amount_signed_usd_minor, source_ref
  ) VALUES (
    NEW.shipowner_id, 'PROFORMA_APPLY', -v_apply_minor, NEW.id::TEXT
  );

  -- Recompute transaction status (PAID / PARTIALLY_PAID)
  PERFORM public.recompute_transaction_status(NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER transactions_auto_apply_wallet
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.auto_apply_wallet_to_proforma();

-- Storage bucket for proof uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('payment-proofs', 'payment-proofs', false, 10485760,
          ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO NOTHING;

-- Bucket RLS: owner can write to own payment subfolder; admins read all
CREATE POLICY payment_proofs_owner_write ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = public.current_shipowner_id()::TEXT
  );

CREATE POLICY payment_proofs_owner_read ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = public.current_shipowner_id()::TEXT
  );

CREATE POLICY payment_proofs_admin_read ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
         AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER')
    )
  );

-- DOWN:
-- DROP TRIGGER transactions_auto_apply_wallet ON public.transactions;
-- DROP FUNCTION public.auto_apply_wallet_to_proforma();
-- DROP POLICY payment_proofs_owner_write  ON storage.objects;
-- DROP POLICY payment_proofs_owner_read   ON storage.objects;
-- DROP POLICY payment_proofs_admin_read   ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'payment-proofs';
```

- [ ] **Step 4: Run pg test to verify it passes**

Run: `./supabase/tests/run.sh migrations/059_wallet_auto_apply.test.sql`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/059_wallet_auto_apply.sql \
        supabase/tests/migrations/059_wallet_auto_apply.test.sql
git commit -m "feat(plan7c): mig 059 — wallet auto-apply trigger + payment-proofs bucket"
```

---

## Task 4: `fxRateService.ts` — currency-rate locking

**Files:**
- Create: `frontend/src/services/fxRateService.ts`
- Create: `frontend/src/services/fxRateService.test.ts`
- Modify: `frontend/.env.example` (add `OPENEXCHANGE_RATES_API_KEY=` placeholder)

Spec §7.4: read latest from `fx_rates`, fetch from OpenExchangeRates if older than 24h, return locked tuple `{rate, source, locked_at}`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/services/fxRateService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
};

const mockChain = {
    select: vi.fn(() => mockChain),
    eq: vi.fn(() => mockChain),
    order: vi.fn(() => mockChain),
    limit: vi.fn(() => mockChain),
    insert: vi.fn(async () => ({ error: null })),
    maybeSingle: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockReturnValue(mockChain as any);
});

describe('lockRate', () => {
    it('returns USD passthrough without DB call when currency=USD', async () => {
        const { lockRate } = await import('./fxRateService');
        const r = await lockRate(mockSupabase as any, 'USD');
        expect(r).toEqual({ rate: 1, source: 'IDENTITY', lockedAt: expect.any(String) });
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('returns cached rate when fetched_at is < 24h old', async () => {
        const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();  // 1h ago
        mockChain.maybeSingle.mockResolvedValueOnce({
            data: { rate: 0.92, source: 'OPENEXCHANGERATES', fetched_at: recent },
            error: null,
        });

        const { lockRate } = await import('./fxRateService');
        const r = await lockRate(mockSupabase as any, 'EUR');
        expect(r.rate).toBe(0.92);
        expect(r.source).toBe('OPENEXCHANGERATES');
    });

    it('throws when OXR fetch returns non-ok and no cached rate exists', async () => {
        mockChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
        global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 } as any);
        process.env.OPENEXCHANGE_RATES_API_KEY = 'test-key';

        const { lockRate } = await import('./fxRateService');
        await expect(lockRate(mockSupabase as any, 'EUR')).rejects.toThrow(/FX rate fetch failed/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/fxRateService.test.ts`
Expected: FAIL — `Cannot find module './fxRateService'`

- [ ] **Step 3: Write the service**

Create `frontend/src/services/fxRateService.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface LockedRate {
    rate: number;
    source: string;
    lockedAt: string;
}

export async function lockRate(
    db: SupabaseClient,
    currency: string,
    base: 'USD' = 'USD',
): Promise<LockedRate> {
    if (currency === base) {
        return { rate: 1, source: 'IDENTITY', lockedAt: new Date().toISOString() };
    }

    const { data: cached } = await db
        .from('fx_rates')
        .select('rate, source, fetched_at')
        .eq('base_ccy', base)
        .eq('quote_ccy', currency)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (cached) {
        const age = Date.now() - new Date(cached.fetched_at).getTime();
        if (age < STALE_AFTER_MS) {
            return {
                rate: Number(cached.rate),
                source: cached.source,
                lockedAt: cached.fetched_at,
            };
        }
    }

    const apiKey = process.env.OPENEXCHANGE_RATES_API_KEY;
    if (!apiKey) {
        if (cached) {
            // No API key: serve stale cached rather than fail
            return { rate: Number(cached.rate), source: cached.source, lockedAt: cached.fetched_at };
        }
        throw new Error('FX rate fetch failed: OPENEXCHANGE_RATES_API_KEY missing and no cached rate');
    }

    const url = `https://openexchangerates.org/api/latest.json?app_id=${apiKey}&base=${base}&symbols=${currency}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
        resp = await fetch(url, { signal: ctl.signal });
    } catch (e) {
        clearTimeout(t);
        if (cached) return { rate: Number(cached.rate), source: cached.source, lockedAt: cached.fetched_at };
        throw new Error(`FX rate fetch failed: ${(e as Error).message}`);
    }
    clearTimeout(t);

    if (!resp.ok) {
        if (cached) return { rate: Number(cached.rate), source: cached.source, lockedAt: cached.fetched_at };
        throw new Error(`FX rate fetch failed: HTTP ${resp.status}`);
    }

    const json = (await resp.json()) as { rates: Record<string, number> };
    const rate = json.rates?.[currency];
    if (typeof rate !== 'number' || rate <= 0) {
        throw new Error(`FX rate fetch failed: rate missing for ${currency}`);
    }

    const fetchedAt = new Date().toISOString();
    await db.from('fx_rates').insert({
        base_ccy: base, quote_ccy: currency, rate, source: 'OPENEXCHANGERATES', fetched_at: fetchedAt,
    });

    return { rate, source: 'OPENEXCHANGERATES', lockedAt: fetchedAt };
}
```

- [ ] **Step 4: Modify `frontend/.env.example`**

Append:

```
# Plan 7C: OpenExchangeRates free tier — 1000 requests/month
OPENEXCHANGE_RATES_API_KEY=
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/fxRateService.test.ts`
Expected: PASS, 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/fxRateService.ts \
        frontend/src/services/fxRateService.test.ts \
        frontend/.env.example
git commit -m "feat(plan7c): fxRateService.lockRate — 24h cache + OXR fetch + fallback to stale"
```

---

## Task 5: `paymentService.ts` — typed read helpers

**Files:**
- Create: `frontend/src/services/paymentService.ts`
- Create: `frontend/src/services/paymentService.test.ts`

Centralizes payment-row reads so admin pages and owner pages don't duplicate joins. Mirrors the shape used by 7B's `shipownerService`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/services/paymentService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
};

const db = { from: vi.fn(() => chain) } as any;

describe('listPaymentsForShipowner', () => {
    it('queries payments by shipowner_id and joins transactions', async () => {
        const { listPaymentsForShipowner } = await import('./paymentService');
        await listPaymentsForShipowner(db, 'so-1');
        expect(db.from).toHaveBeenCalledWith('payments');
        expect(chain.eq).toHaveBeenCalledWith('shipowner_id', 'so-1');
    });
});

describe('listPendingAdminPayments', () => {
    it('filters by status INITIATED/PROCESSING and excludes WALLET/STRIPE', async () => {
        const { listPendingAdminPayments } = await import('./paymentService');
        await listPendingAdminPayments(db);
        expect(chain.in).toHaveBeenCalledWith('status', ['INITIATED', 'PROCESSING']);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/paymentService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the service**

Create `frontend/src/services/paymentService.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type PaymentRail =
    | 'STRIPE' | 'WIRE_TRANSFER' | 'CASH' | 'CHEQUE' | 'LETTER_OF_CREDIT'
    | 'NETTING' | 'THIRD_PARTY' | 'MOBILE_MONEY' | 'BANK_GUARANTEE' | 'WALLET';

export type PaymentStatus =
    | 'INITIATED' | 'PROCESSING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED';

export interface PaymentRow {
    id: string;
    transaction_id: string | null;
    shipowner_id: string;
    declared_by: string | null;
    amount_minor: number;
    currency: string;
    amount_usd_minor: number;
    fx_rate: number | null;
    fx_rate_source: string | null;
    fx_rate_locked_at: string | null;
    rail: PaymentRail;
    rail_details: Record<string, unknown>;
    external_reference: string | null;
    status: PaymentStatus;
    rejected_reason: string | null;
    confirmed_by: string | null;
    confirmed_at: string | null;
    created_at: string;
    updated_at: string;
}

export async function listPaymentsForShipowner(
    db: SupabaseClient,
    shipownerId: string,
): Promise<PaymentRow[]> {
    const { data, error } = await db
        .from('payments')
        .select('*')
        .eq('shipowner_id', shipownerId)
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return (data ?? []) as PaymentRow[];
}

export async function listPendingAdminPayments(
    db: SupabaseClient,
): Promise<PaymentRow[]> {
    const { data, error } = await db
        .from('payments')
        .select('*')
        .in('status', ['INITIATED', 'PROCESSING'])
        .order('created_at', { ascending: true })
        .limit(200);
    if (error) throw error;
    return (data ?? []) as PaymentRow[];
}

export async function getPayment(
    db: SupabaseClient,
    id: string,
): Promise<PaymentRow | null> {
    const { data, error } = await db.from('payments').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data as PaymentRow | null) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/paymentService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/paymentService.ts frontend/src/services/paymentService.test.ts
git commit -m "feat(plan7c): paymentService — typed read helpers for payments table"
```

---

## Task 6: Server action `initiatePayment`

**Files:**
- Create: `frontend/src/actions/initiatePayment.ts`
- Create: `frontend/src/actions/initiatePayment.test.ts`

Validates input, locks FX rate via `fxRateService`, computes `amount_usd_minor`, INSERTs `payments` row at status=INITIATED. Used by `<PayDialog>` (Plan 7C-2) for owner-initiated rails (WIRE / MOBILE_MONEY / THIRD_PARTY / WALLET) and by `<RecordManualPaymentDialog>` (Plan 7C-3) for admin-initiated rails.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/initiatePayment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const inserted: any[] = [];
const mockSupabase = {
    from: vi.fn(() => ({
        insert: vi.fn((row: any) => {
            inserted.push(row);
            return {
                select: () => ({
                    single: async () => ({ data: { id: 'pay-1', ...row }, error: null }),
                }),
            };
        }),
        select: vi.fn(() => ({
            eq: () => ({
                order: () => ({
                    limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                }),
            }),
        })),
    })),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/services/fxRateService', () => ({
    lockRate: vi.fn(async (_db, ccy: string) =>
        ccy === 'USD'
            ? { rate: 1, source: 'IDENTITY', lockedAt: '2026-05-01T00:00:00Z' }
            : { rate: 0.92, source: 'OPENEXCHANGERATES', lockedAt: '2026-05-01T00:00:00Z' },
    ),
}));

vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        shipowner: { id: 'so-1', name: 'Test', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    })),
}));

beforeEach(() => {
    inserted.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('initiatePayment', () => {
    it('rejects unsupported rail for owner caller', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await expect(initiatePayment({
            transactionId: 't-1', amount: '100.00', currency: 'USD', rail: 'CASH',
            railDetails: {},
        })).rejects.toThrow(/owner cannot initiate/i);
    });

    it('inserts USD payment with amount_minor === amount_usd_minor and fx_rate NULL', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        const r = await initiatePayment({
            transactionId: 't-1', amount: '250.00', currency: 'USD', rail: 'WIRE_TRANSFER',
            railDetails: { swift_ref: 'X' },
        });
        expect(r.id).toBe('pay-1');
        expect(inserted[0]).toMatchObject({
            amount_minor: 25000,
            currency: 'USD',
            amount_usd_minor: 25000,
            fx_rate: null,
            rail: 'WIRE_TRANSFER',
            status: 'INITIATED',
        });
    });

    it('locks FX rate for non-USD and computes amount_usd_minor', async () => {
        const { initiatePayment } = await import('./initiatePayment');
        await initiatePayment({
            transactionId: 't-1', amount: '100.00', currency: 'EUR', rail: 'WIRE_TRANSFER',
            railDetails: {},
        });
        expect(inserted[0]).toMatchObject({
            amount_minor: 10000,
            currency: 'EUR',
            // 10000 EUR-minor / 0.92 = 10869 (round half up) USD-minor
            amount_usd_minor: 10870,
            fx_rate: 0.92,
            fx_rate_source: 'OPENEXCHANGERATES',
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/initiatePayment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the action**

Create `frontend/src/actions/initiatePayment.ts`:

```ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { lockRate } from '@/services/fxRateService';
import { requireOwner } from '@/lib/auth/requireOwner';

const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
const ALL_RAILS = [
    'STRIPE', 'WIRE_TRANSFER', 'CASH', 'CHEQUE', 'LETTER_OF_CREDIT',
    'NETTING', 'THIRD_PARTY', 'MOBILE_MONEY', 'BANK_GUARANTEE', 'WALLET',
] as const;

const schema = z.object({
    transactionId: z.string().uuid().nullable(),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Decimal with up to 2 fraction digits'),
    currency: z.string().length(3),
    rail: z.enum(ALL_RAILS),
    railDetails: z.record(z.unknown()),
});

export interface InitiatePaymentInput {
    transactionId: string | null;
    amount: string;
    currency: string;
    rail: typeof ALL_RAILS[number];
    railDetails: Record<string, unknown>;
}

export async function initiatePayment(input: InitiatePaymentInput) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();
    if (!OWNER_RAILS.includes(parsed.rail as typeof OWNER_RAILS[number])) {
        throw new Error(`owner cannot initiate rail=${parsed.rail}`);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const fx = await lockRate(admin, parsed.currency);

    const amountMinor = Math.round(parseFloat(parsed.amount) * 100);
    const amountUsdMinor = parsed.currency === 'USD'
        ? amountMinor
        : Math.round(amountMinor / fx.rate);

    const row = {
        transaction_id: parsed.transactionId,
        shipowner_id: ctx.shipowner.id,
        declared_by: ctx.userId,
        amount_minor: amountMinor,
        currency: parsed.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: parsed.currency === 'USD' ? null : fx.rate,
        fx_rate_source: parsed.currency === 'USD' ? null : fx.source,
        fx_rate_locked_at: parsed.currency === 'USD' ? null : fx.lockedAt,
        rail: parsed.rail,
        rail_details: parsed.railDetails,
        status: 'INITIATED' as const,
    };

    const { data, error } = await admin
        .from('payments').insert(row).select('id, status, transaction_id, amount_usd_minor').single();

    if (error) throw error;
    return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/initiatePayment.test.ts`
Expected: PASS, 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/initiatePayment.ts \
        frontend/src/actions/initiatePayment.test.ts
git commit -m "feat(plan7c): initiatePayment action — FX-locked INSERT to payments INITIATED"
```

---

## Task 7: Server action `confirmPayment`

**Files:**
- Create: `frontend/src/actions/confirmPayment.ts`
- Create: `frontend/src/actions/confirmPayment.test.ts`

Calls `can_confirm_payment` SQL gate, UPDATEs status=CONFIRMED with `confirmed_by`/`confirmed_at`, fires `recompute_transaction_status`, writes audit log.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/confirmPayment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let canConfirmReturn = true;
const updateCalls: any[] = [];
const rpcCalls: { fn: string; args: unknown }[] = [];
const auditCalls: any[] = [];

const mockSupabase = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        if (fn === 'can_confirm_payment') return { data: canConfirmReturn, error: null };
        if (fn === 'recompute_transaction_status') return { data: null, error: null };
        return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            select: () => ({ single: async () => ({ data: { id: 'pay-1', transaction_id: 't-1' }, error: null }) }),
                        }),
                    };
                },
            };
        }
        if (table === 'audit_logs') {
            return { insert: async (row: any) => { auditCalls.push(row); return { error: null }; } };
        }
        return {} as any;
    }),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => ({
        user: { id: 'admin-1', fullName: 'Admin' },
        error: null,
    })),
}));

beforeEach(() => {
    canConfirmReturn = true;
    updateCalls.length = 0;
    rpcCalls.length = 0;
    auditCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('confirmPayment', () => {
    it('rejects when can_confirm_payment returns false', async () => {
        canConfirmReturn = false;
        const { confirmPayment } = await import('./confirmPayment');
        await expect(confirmPayment({ paymentId: 'pay-1' })).rejects.toThrow(/not authorized/i);
    });

    it('sets status=CONFIRMED with confirmed_by + confirmed_at and triggers recompute', async () => {
        const { confirmPayment } = await import('./confirmPayment');
        await confirmPayment({ paymentId: 'pay-1' });
        expect(updateCalls[0]).toMatchObject({ status: 'CONFIRMED', confirmed_by: 'admin-1' });
        expect(updateCalls[0].confirmed_at).toBeTruthy();
        expect(rpcCalls.find(c => c.fn === 'recompute_transaction_status')).toBeDefined();
        expect(auditCalls[0]).toMatchObject({
            action: 'TRANSACTION_UPDATED',
            entity_type: 'Payment',
            entity_id: 'pay-1',
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/confirmPayment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the action**

Create `frontend/src/actions/confirmPayment.ts`:

```ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const schema = z.object({ paymentId: z.string().uuid() });

export async function confirmPayment(input: { paymentId: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { data: ok, error: gateErr } = await admin.rpc('can_confirm_payment', {
        p_payment_id: parsed.paymentId,
        p_profile_id: auth.user.id,
    });
    if (gateErr) throw gateErr;
    if (!ok) throw new Error('Not authorized to confirm this payment');

    const confirmedAt = new Date().toISOString();
    const { data: updated, error: updErr } = await admin
        .from('payments')
        .update({ status: 'CONFIRMED', confirmed_by: auth.user.id, confirmed_at: confirmedAt })
        .eq('id', parsed.paymentId)
        .select('id, transaction_id')
        .single();
    if (updErr) throw updErr;

    if (updated.transaction_id) {
        await admin.rpc('recompute_transaction_status', { p_transaction_id: updated.transaction_id });
    }

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Payment',
        entity_id: parsed.paymentId,
        details_json: { event: 'PAYMENT_CONFIRMED', confirmed_at: confirmedAt },
    });

    return { ok: true, paymentId: parsed.paymentId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/confirmPayment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/confirmPayment.ts \
        frontend/src/actions/confirmPayment.test.ts
git commit -m "feat(plan7c): confirmPayment action — can_confirm gate + recompute + audit"
```

---

## Task 8: Server action `rejectPayment`

**Files:**
- Create: `frontend/src/actions/rejectPayment.ts`
- Create: `frontend/src/actions/rejectPayment.test.ts`

Symmetric to confirmPayment but sets `status=REJECTED` + `rejected_reason`. No `recompute_transaction_status` call (no money changed hands).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/rejectPayment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let canConfirmReturn = true;
const updateCalls: any[] = [];

const mockSupabase = {
    rpc: vi.fn(async (fn: string) => {
        if (fn === 'can_confirm_payment') return { data: canConfirmReturn, error: null };
        return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            select: () => ({ single: async () => ({ data: { id: 'pay-1' }, error: null }) }),
                        }),
                    };
                },
            };
        }
        if (table === 'audit_logs') {
            return { insert: async () => ({ error: null }) };
        }
        return {} as any;
    }),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }));
vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => ({ user: { id: 'admin-1', fullName: 'Admin' }, error: null })),
}));

beforeEach(() => {
    canConfirmReturn = true;
    updateCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('rejectPayment', () => {
    it('requires a non-empty reason', async () => {
        const { rejectPayment } = await import('./rejectPayment');
        await expect(rejectPayment({ paymentId: '00000000-0000-0000-0000-000000000001', reason: '' }))
            .rejects.toThrow();
    });

    it('sets status=REJECTED and stores reason', async () => {
        const { rejectPayment } = await import('./rejectPayment');
        await rejectPayment({ paymentId: '00000000-0000-0000-0000-000000000001', reason: 'Wrong amount' });
        expect(updateCalls[0]).toMatchObject({ status: 'REJECTED', rejected_reason: 'Wrong amount' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/rejectPayment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the action**

Create `frontend/src/actions/rejectPayment.ts`:

```ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const schema = z.object({
    paymentId: z.string().uuid(),
    reason: z.string().min(3).max(500),
});

export async function rejectPayment(input: { paymentId: string; reason: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { data: ok, error: gateErr } = await admin.rpc('can_confirm_payment', {
        p_payment_id: parsed.paymentId,
        p_profile_id: auth.user.id,
    });
    if (gateErr) throw gateErr;
    if (!ok) throw new Error('Not authorized to reject this payment');

    const { error: updErr } = await admin
        .from('payments')
        .update({ status: 'REJECTED', rejected_reason: parsed.reason })
        .eq('id', parsed.paymentId)
        .select('id')
        .single();
    if (updErr) throw updErr;

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Payment',
        entity_id: parsed.paymentId,
        details_json: { event: 'PAYMENT_REJECTED', reason: parsed.reason },
    });

    return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/rejectPayment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/rejectPayment.ts \
        frontend/src/actions/rejectPayment.test.ts
git commit -m "feat(plan7c): rejectPayment action — admin REJECTED + reason + audit"
```

---

## Task 9: Server action `cancelPayment`

**Files:**
- Create: `frontend/src/actions/cancelPayment.ts`
- Create: `frontend/src/actions/cancelPayment.test.ts`

Owner cancels own INITIATED payment. RLS owner_cancel policy already gates — this action is the entry point. No admin gate involved.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/cancelPayment.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateCalls: any[] = [];

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'payments') {
            return {
                update: (payload: any) => {
                    updateCalls.push(payload);
                    return {
                        eq: () => ({
                            eq: () => ({
                                eq: () => ({
                                    select: () => ({ single: async () => ({ data: { id: 'pay-1' }, error: null }) }),
                                }),
                            }),
                        }),
                    };
                },
            };
        }
        return {} as any;
    }),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }));
vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        shipowner: { id: 'so-1', name: 'T', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    })),
}));

beforeEach(() => {
    updateCalls.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('cancelPayment', () => {
    it('flips status to CANCELLED via owner-scoped UPDATE', async () => {
        const { cancelPayment } = await import('./cancelPayment');
        await cancelPayment({ paymentId: '00000000-0000-0000-0000-000000000001' });
        expect(updateCalls[0]).toMatchObject({ status: 'CANCELLED' });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/cancelPayment.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the action**

Create `frontend/src/actions/cancelPayment.ts`:

```ts
'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({ paymentId: z.string().uuid() });

export async function cancelPayment(input: { paymentId: string }) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();

    // Owner-scoped: rely on owner-bound supabase client + RLS payments_owner_cancel
    const { error } = await ctx.supabase
        .from('payments')
        .update({ status: 'CANCELLED' })
        .eq('id', parsed.paymentId)
        .eq('shipowner_id', ctx.shipowner.id)
        .eq('status', 'INITIATED')
        .select('id')
        .single();

    if (error) throw error;
    return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/cancelPayment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/cancelPayment.ts \
        frontend/src/actions/cancelPayment.test.ts
git commit -m "feat(plan7c): cancelPayment action — owner cancels own INITIATED"
```

---

## Task 10: Server action `applyWallet`

**Files:**
- Create: `frontend/src/actions/applyWallet.ts`
- Create: `frontend/src/actions/applyWallet.test.ts`

Owner clicks "Imputer mon wallet". Inserts a WALLET payment row already CONFIRMED, plus a `wallet_ledger` PROFORMA_APPLY entry (negative). The mig-050 ledger trigger updates `wallets.balance_usd_minor` automatically. Mig 051's `recompute_transaction_status` runs as a final step.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/applyWallet.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let walletBalance = 500_000;
const inserts: { table: string; row: any }[] = [];

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'wallets') {
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({
                            data: { balance_usd_minor: walletBalance }, error: null,
                        }),
                    }),
                }),
            };
        }
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({
                            data: { id: 't-1', shipowner_id: 'so-1', tax_amount_usd: 1000 }, error: null,
                        }),
                    }),
                }),
            };
        }
        return {
            insert: (row: any) => {
                inserts.push({ table, row });
                return { select: () => ({ single: async () => ({ data: { id: 'pay-1', ...row }, error: null }) }) };
            },
        };
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
};

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockSupabase) }));
vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        shipowner: { id: 'so-1', name: 'T', account_state: 'ACTIVE' },
        supabase: mockSupabase,
    })),
}));

beforeEach(() => {
    walletBalance = 500_000;
    inserts.length = 0;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

describe('applyWallet', () => {
    it('rejects when wallet has insufficient balance', async () => {
        walletBalance = 1000;
        const { applyWallet } = await import('./applyWallet');
        await expect(applyWallet({
            transactionId: '00000000-0000-0000-0000-000000000001',
            amountMinor: 50000,
        })).rejects.toThrow(/insufficient/i);
    });

    it('rejects when transaction belongs to a different shipowner', async () => {
        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'transactions') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({ data: { id: 't-1', shipowner_id: 'OTHER', tax_amount_usd: 1000 }, error: null }),
                        }),
                    }),
                };
            }
            return {} as any;
        });
        const { applyWallet } = await import('./applyWallet');
        await expect(applyWallet({
            transactionId: '00000000-0000-0000-0000-000000000001',
            amountMinor: 1000,
        })).rejects.toThrow(/not your transaction/i);
    });

    it('inserts WALLET CONFIRMED payment + negative ledger entry', async () => {
        const { applyWallet } = await import('./applyWallet');
        await applyWallet({
            transactionId: '00000000-0000-0000-0000-000000000001',
            amountMinor: 50000,
        });
        const pay = inserts.find(i => i.table === 'payments');
        const ledger = inserts.find(i => i.table === 'wallet_ledger');
        expect(pay?.row).toMatchObject({
            rail: 'WALLET', status: 'CONFIRMED', amount_usd_minor: 50000,
        });
        expect(ledger?.row).toMatchObject({
            kind: 'PROFORMA_APPLY', amount_signed_usd_minor: -50000,
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/actions/applyWallet.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the action**

Create `frontend/src/actions/applyWallet.ts`:

```ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({
    transactionId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
});

export async function applyWallet(input: { transactionId: string; amountMinor: number }) {
    const parsed = schema.parse(input);

    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    // Verify transaction belongs to this shipowner and fetch due amount
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('id, shipowner_id, tax_amount_usd')
        .eq('id', parsed.transactionId)
        .single();
    if (txErr) throw txErr;
    if (tx.shipowner_id !== ctx.shipowner.id) throw new Error('Not your transaction');

    // Verify wallet balance
    const { data: wallet, error: wErr } = await admin
        .from('wallets')
        .select('balance_usd_minor')
        .eq('shipowner_id', ctx.shipowner.id)
        .maybeSingle();
    if (wErr) throw wErr;
    const balance = wallet?.balance_usd_minor ?? 0;
    if (balance < parsed.amountMinor) {
        throw new Error('Insufficient wallet balance');
    }

    // Insert WALLET payment CONFIRMED
    const confirmedAt = new Date().toISOString();
    const { error: payErr } = await admin
        .from('payments')
        .insert({
            transaction_id: parsed.transactionId,
            shipowner_id: ctx.shipowner.id,
            declared_by: ctx.userId,
            amount_minor: parsed.amountMinor,
            currency: 'USD',
            amount_usd_minor: parsed.amountMinor,
            rail: 'WALLET',
            status: 'CONFIRMED',
            confirmed_at: confirmedAt,
            rail_details: { applied_by_owner: true },
        })
        .select('id')
        .single();
    if (payErr) throw payErr;

    // Ledger debit (negative signed) — wallet trigger syncs balance
    const { error: ledgErr } = await admin.from('wallet_ledger').insert({
        shipowner_id: ctx.shipowner.id,
        kind: 'PROFORMA_APPLY',
        amount_signed_usd_minor: -parsed.amountMinor,
        source_ref: parsed.transactionId,
    });
    if (ledgErr) throw ledgErr;

    // Recompute transaction status
    await admin.rpc('recompute_transaction_status', { p_transaction_id: parsed.transactionId });

    return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/applyWallet.test.ts`
Expected: PASS, 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/applyWallet.ts \
        frontend/src/actions/applyWallet.test.ts
git commit -m "feat(plan7c): applyWallet action — owner imputes wallet balance to PROFORMA"
```

---

## Task 11: Overpayment → wallet credit (extends `confirmPayment`)

**Files:**
- Modify: `frontend/src/actions/confirmPayment.ts`
- Modify: `frontend/src/actions/confirmPayment.test.ts`

Spec §7.3: when confirming a payment whose `amount_usd_minor > remaining_due`, adjust the payment to `remaining_due` and credit the excess to the wallet via a `wallet_ledger` `OVERPAYMENT_CREDIT` entry. Preserves invariant `SUM(payments WHERE txn_id=X AND status=CONFIRMED) = txn.due` post-confirm.

- [ ] **Step 1: Extend the test file with overpayment scenarios**

Append to `frontend/src/actions/confirmPayment.test.ts` (inside `describe('confirmPayment')`):

```ts
    it('splits overpayment: adjusts payment to remaining_due and credits ledger', async () => {
        // Override the from('payments').update mock to return a higher amount,
        // and add transaction + payments aggregate fetches.
        const txDueUsd = 100;            // $100.00 due
        const paidSoFarMinor = 6000;     // $60.00 already paid
        const incomingMinor = 10000;     // $100.00 incoming → overpay $60.00
        const inserts: { table: string; row: any }[] = [];
        const updates: { table: string; payload: any }[] = [];

        const localSupabase = {
            rpc: vi.fn(async (fn: string, args: unknown) => {
                if (fn === 'can_confirm_payment') return { data: true, error: null };
                return { data: null, error: null };
            }),
            from: vi.fn((table: string) => {
                if (table === 'payments') {
                    return {
                        update: (payload: any) => {
                            updates.push({ table, payload });
                            return {
                                eq: () => ({
                                    select: () => ({
                                        single: async () => ({
                                            data: { id: 'pay-1', transaction_id: 't-1',
                                                    amount_usd_minor: incomingMinor, shipowner_id: 'so-1' },
                                            error: null,
                                        }),
                                    }),
                                }),
                            };
                        },
                        select: () => ({
                            eq: () => ({
                                single: async () => ({
                                    data: { id: 'pay-1', transaction_id: 't-1',
                                            amount_usd_minor: incomingMinor, shipowner_id: 'so-1' },
                                    error: null,
                                }),
                            }),
                        }),
                    };
                }
                if (table === 'transactions') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: async () => ({
                                    data: { id: 't-1', tax_amount_usd: txDueUsd, shipowner_id: 'so-1' },
                                    error: null,
                                }),
                            }),
                        }),
                    };
                }
                if (table === 'transaction_paid_summary') {
                    return {
                        select: () => ({
                            eq: () => ({
                                maybeSingle: async () => ({
                                    data: { transaction_id: 't-1', paid_usd_minor: paidSoFarMinor },
                                    error: null,
                                }),
                            }),
                        }),
                    };
                }
                if (table === 'wallet_ledger') {
                    return { insert: async (row: any) => { inserts.push({ table, row }); return { error: null }; } };
                }
                if (table === 'audit_logs') {
                    return { insert: async () => ({ error: null }) };
                }
                return {} as any;
            }),
        };

        // Re-mock createClient with this scoped supabase
        const supa = await import('@supabase/supabase-js');
        (supa.createClient as any).mockReturnValue(localSupabase);

        const { confirmPayment } = await import('./confirmPayment');
        await confirmPayment({ paymentId: 'pay-1' });

        // Expected: remaining = 10000 - 6000 = 4000 minor → adjust payment to 4000
        // Excess = 10000 - 4000 = 6000 minor → ledger OVERPAYMENT_CREDIT +6000
        const adjust = updates.find(u => u.payload.amount_usd_minor === 4000);
        expect(adjust).toBeDefined();
        const ledger = inserts.find(i => i.table === 'wallet_ledger');
        expect(ledger?.row).toMatchObject({
            kind: 'OVERPAYMENT_CREDIT',
            amount_signed_usd_minor: 6000,
            shipowner_id: 'so-1',
        });
    });
```

- [ ] **Step 2: Run test to verify the new scenario fails**

Run: `npx vitest run src/actions/confirmPayment.test.ts`
Expected: FAIL — current implementation doesn't split overpayments.

- [ ] **Step 3: Extend `confirmPayment.ts`**

Replace the body of `confirmPayment` (after the existing CONFIRMED update + before `recompute_transaction_status`) so it splits overpayment first. The full updated file:

```ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const schema = z.object({ paymentId: z.string().uuid() });

export async function confirmPayment(input: { paymentId: string }) {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error) throw new Error('Not authorized');

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { data: ok, error: gateErr } = await admin.rpc('can_confirm_payment', {
        p_payment_id: parsed.paymentId,
        p_profile_id: auth.user.id,
    });
    if (gateErr) throw gateErr;
    if (!ok) throw new Error('Not authorized to confirm this payment');

    const confirmedAt = new Date().toISOString();
    const { data: updated, error: updErr } = await admin
        .from('payments')
        .update({ status: 'CONFIRMED', confirmed_by: auth.user.id, confirmed_at: confirmedAt })
        .eq('id', parsed.paymentId)
        .select('id, transaction_id, amount_usd_minor, shipowner_id')
        .single();
    if (updErr) throw updErr;

    if (updated.transaction_id) {
        await splitOverpayment(admin, updated);
        await admin.rpc('recompute_transaction_status', { p_transaction_id: updated.transaction_id });
    }

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.fullName,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Payment',
        entity_id: parsed.paymentId,
        details_json: { event: 'PAYMENT_CONFIRMED', confirmed_at: confirmedAt },
    });

    return { ok: true, paymentId: parsed.paymentId };
}

interface ConfirmedPaymentRow {
    id: string;
    transaction_id: string | null;
    amount_usd_minor: number;
    shipowner_id: string;
}

async function splitOverpayment(
    admin: ReturnType<typeof createClient>,
    payment: ConfirmedPaymentRow,
): Promise<void> {
    if (!payment.transaction_id) return;

    const { data: tx } = await admin
        .from('transactions')
        .select('id, tax_amount_usd, shipowner_id')
        .eq('id', payment.transaction_id)
        .single();
    if (!tx) return;

    const dueMinor = Math.round(Number(tx.tax_amount_usd) * 100);

    const { data: summary } = await admin
        .from('transaction_paid_summary')
        .select('paid_usd_minor')
        .eq('transaction_id', payment.transaction_id)
        .maybeSingle();

    // paid_so_far includes this payment (now CONFIRMED). Subtract this row to get
    // "paid before this confirm" — the basis for "remaining due".
    const paidIncludingThis = Number(summary?.paid_usd_minor ?? payment.amount_usd_minor);
    const paidBefore = paidIncludingThis - payment.amount_usd_minor;
    const remainingBeforeThis = Math.max(0, dueMinor - paidBefore);

    if (payment.amount_usd_minor <= remainingBeforeThis) return;  // no overpay

    const adjusted = remainingBeforeThis;
    const excess = payment.amount_usd_minor - remainingBeforeThis;

    await admin
        .from('payments')
        .update({ amount_usd_minor: adjusted })
        .eq('id', payment.id)
        .select('id')
        .single();

    await admin.from('wallet_ledger').insert({
        shipowner_id: payment.shipowner_id,
        kind: 'OVERPAYMENT_CREDIT',
        amount_signed_usd_minor: excess,
        source_ref: payment.id,
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/actions/confirmPayment.test.ts`
Expected: PASS — both the original 2 scenarios AND the new overpayment scenario.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/confirmPayment.ts \
        frontend/src/actions/confirmPayment.test.ts
git commit -m "feat(plan7c): confirmPayment overpayment split — credit excess to wallet"
```

---

## Final verification

- [ ] **Step 1: Full vitest run**

Run: `npx vitest run`
Expected: all tests pass; 8 new test files added.

- [ ] **Step 2: Full pg test run**

Run:
```bash
for f in supabase/tests/migrations/{057,058,059}_*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done
```
Expected: all 3 migration tests pass.

- [ ] **Step 3: TypeScript noEmit**

Run: `npx tsc --noEmit -p frontend`
Expected: 0 errors.

- [ ] **Step 4: Next build**

Run: `npm --prefix frontend run build`
Expected: build succeeds. Note that none of the new actions are imported by any page yet — they're just module-level exports waiting for 7C-2/7C-3 to consume them.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/plan-7c-1-payments-backend
gh pr create --base develop --title "Plan 7C-1: Payments backend infrastructure" \
  --body "Migrations 057-059 (can_confirm_payment, RLS, wallet auto-apply) + fxRateService + paymentService + 5 server actions (initiate/confirm/reject/cancel/applyWallet). No UI changes. Plan: docs/superpowers/plans/2026-05-01-plan-7c-1-payments-backend.md"
```

---

## Out of scope for this plan (deferred to 7C-2 onward)

- `<PayDialog>` UI — Plan 7C-2
- `<RecordManualPaymentDialog>` admin UI — Plan 7C-3
- `/admin/payments` refonte — Plan 7C-3
- Cash-desk dedicated UI — Plan 7C-4
- Receipt PDF generation — Plan 7C-4
- Frontend cutover from `paymentIntentService` → `paymentService` and DROP TABLE `shipowner_payment_intents` — Plan 7C-5
- Stripe online flow — Plan 7D
- `/owner/wallet` page + `predictNextTax` — Plan 7E
- Notifications (`<NotificationBell>`, 16 templates) — Plan 7F
- Refunds admin flow — Plan 7G
- AR/PT/SW i18n — Plan 7H
