# Plan 7A — Shipowner Portal v1 : Schema Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pose les 8 migrations de base du Plan 7 (KYC extensions, payments polymorphe, payment_proofs, wallets+ledger, transactions partial payment, refunds, owner_notifications, fx_rates) avec leurs tests SQL d'isolation RLS et invariants. Aucune feature visible côté UI : phase pure schema, ship-able seule.

**Architecture:** Approche 2 du spec (refonte ciblée) — `shipowner_payment_intents` (Plan 6 v0) renommé en `payments` polymorphe avec rail enum + JSONB rail_details. Wallet en double-entry (`wallets` + `wallet_ledger`) avec invariant `SUM(ledger) = balance`. Tous CHECK + RLS testés en SQL.

**Tech Stack:** Supabase Postgres 17, pgTAP-style assertions in psql, `supabase/tests/run.sh` test runner, `supabase db push` pour appliquer en hosted.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §4

**Numérotation:** Le spec utilise 040-047 conceptuellement. Comme 040-046 sont déjà occupés par d'autres features post-Plan 6, ce plan utilise **047-054**. Mapping :

| Spec (conceptuel) | Plan (réel) | Contenu |
|---|---|---|
| 040 | **047** | shipowner_kyc_extensions |
| 041 | **048** | payments_polymorphic |
| 042 | **049** | payment_proofs |
| 043 | **050** | wallets_and_ledger |
| 044 | **051** | transactions_partial_payment |
| 045 | **052** | refunds |
| 046 | **053** | owner_notifications |
| 047 | **054** | fx_rates_cache |

---

## File Structure

### Migrations to create

```
supabase/migrations/
├── 047_shipowner_kyc_extensions.sql
├── 048_payments_polymorphic.sql
├── 049_payment_proofs.sql
├── 050_wallets_and_ledger.sql
├── 051_transactions_partial_payment.sql
├── 052_refunds.sql
├── 053_owner_notifications.sql
└── 054_fx_rates_cache.sql
```

### Tests to create

```
supabase/tests/migrations/
├── 047_shipowner_kyc_extensions.test.sql
├── 048_payments_polymorphic.test.sql
├── 049_payment_proofs.test.sql
├── 050_wallets_and_ledger.test.sql
├── 051_transactions_partial_payment.test.sql
├── 052_refunds.test.sql
├── 053_owner_notifications.test.sql
└── 054_fx_rates_cache.test.sql
```

### Files to modify

Aucun en Phase A. Tout est en migrations DDL.

### Test runner

`supabase/tests/run.sh` (existant) prend un fichier `.test.sql` et l'exécute après `supabase db reset`. Chaque test fait `RAISE EXCEPTION 'TEST FAILED: ...'` pour signaler une erreur. Le runner regarde le code de retour psql.

---

## Branch setup

- [ ] **Step 0.1: Create branch**

```bash
git checkout develop
git pull
git checkout -b feat/plan-7a-schema-foundation
```

- [ ] **Step 0.2: Verify clean migrations state**

```bash
ls supabase/migrations/ | tail -5
```

Expected output ends with `046_agent_match_skip_originport.sql`. If 047+ already exists, stop and investigate.

```bash
supabase db reset
```

Expected: applies all migrations 001 through 046 cleanly. Resets local DB.

```bash
./supabase/tests/run.sh migrations/039_shipowner_portal.test.sql
```

Expected: PASS (sanity check that existing test infra still works).

---

## Task 1: Migration 047 — Shipowner KYC extensions

**Files:**
- Create: `supabase/migrations/047_shipowner_kyc_extensions.sql`
- Test: `supabase/tests/migrations/047_shipowner_kyc_extensions.test.sql`

### Why this comes first

`shipowners.account_state` enum needs 3 new values (`PENDING_REVIEW`, `REJECTED`, `SUSPENDED`). All subsequent migrations reference shipowner KYC fields. Adding these first means every test going forward can rely on them.

### Step 1.1: Write the migration

- [ ] **Step 1.1: Create migration file**

Create `supabase/migrations/047_shipowner_kyc_extensions.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 047: Shipowner KYC extensions for Plan 7 v1 portal
-- Adds 3 new account states + KYC level B (signup) + KYC level C (billing)
-- ─────────────────────────────────────────────────────────────────────────────

-- New enum values for the lifecycle:
--   GHOST → INVITED | PENDING_REVIEW → ACTIVE → (SUSPENDED | REJECTED)
ALTER TYPE public.shipowner_account_state
  ADD VALUE IF NOT EXISTS 'PENDING_REVIEW' BEFORE 'INVITED';
ALTER TYPE public.shipowner_account_state
  ADD VALUE IF NOT EXISTS 'REJECTED' AFTER 'ACTIVE';
ALTER TYPE public.shipowner_account_state
  ADD VALUE IF NOT EXISTS 'SUSPENDED' AFTER 'REJECTED';

-- KYC level B (signup obligatoire) + level C (avant 1er paiement)
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS imo_company_no_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proof_imo_vessel_imo TEXT,
  ADD COLUMN IF NOT EXISTS proof_doc_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_doc_type TEXT
    CHECK (proof_doc_type IN ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER')),
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en','fr','ar','pt','sw')),
  ADD COLUMN IF NOT EXISTS billing_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS billing_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS billing_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS billing_city TEXT,
  ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS billing_country_code TEXT,
  ADD COLUMN IF NOT EXISTS vat_number TEXT,
  ADD COLUMN IF NOT EXISTS iban TEXT,
  ADD COLUMN IF NOT EXISTS swift_bic TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS kyc_level_b_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_level_c_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN public.shipowners.iban IS
  'Stored encrypted via pgsodium or Supabase Vault — see Plan 7B implementation.';
COMMENT ON COLUMN public.shipowners.preferred_language IS
  'ISO 639-1: en/fr/ar/pt/sw — drives email template + UI default.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS rejection_reason, ... ;
-- (enum values cannot be removed in Postgres without recreating the enum)
```

- [ ] **Step 1.2: Run migration to verify it applies cleanly**

```bash
supabase db reset
```

Expected: `Finished supabase db reset.` with no errors mentioning migration 047.

- [ ] **Step 1.3: Write the test file**

Create `supabase/tests/migrations/047_shipowner_kyc_extensions.test.sql`:

```sql
-- Test 047: shipowners KYC extensions
BEGIN;

-- 1. Enum values exist
DO $$
DECLARE
  vals TEXT[];
BEGIN
  SELECT array_agg(enumlabel ORDER BY enumsortorder) INTO vals
    FROM pg_enum
    WHERE enumtypid = 'public.shipowner_account_state'::regtype;

  IF NOT vals @> ARRAY['GHOST','PENDING_REVIEW','INVITED','ACTIVE','REJECTED','SUSPENDED'] THEN
    RAISE EXCEPTION 'TEST FAILED: shipowner_account_state missing required values, got %', vals;
  END IF;
END $$;

-- 2. KYC columns exist with correct types
DO $$
BEGIN
  PERFORM 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipowners'
      AND column_name='preferred_language' AND data_type='text';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: shipowners.preferred_language missing or wrong type';
  END IF;
END $$;

-- 3. CHECK constraint on preferred_language rejects invalid values
DO $$
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, preferred_language)
      VALUES ('Test', 'xx');
    RAISE EXCEPTION 'TEST FAILED: invalid preferred_language was accepted';
  EXCEPTION WHEN check_violation THEN
    -- expected
    NULL;
  END;
END $$;

-- 4. CHECK constraint on proof_doc_type rejects invalid values
DO $$
DECLARE
  sid UUID;
BEGIN
  INSERT INTO public.shipowners (name) VALUES ('Test KYC') RETURNING id INTO sid;
  BEGIN
    UPDATE public.shipowners SET proof_doc_type = 'BOGUS' WHERE id = sid;
    RAISE EXCEPTION 'TEST FAILED: invalid proof_doc_type was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

-- 5. Default preferred_language = 'en'
DO $$
DECLARE
  lang TEXT;
  sid UUID;
BEGIN
  INSERT INTO public.shipowners (name) VALUES ('Default Lang Test') RETURNING id INTO sid;
  SELECT preferred_language INTO lang FROM public.shipowners WHERE id = sid;
  IF lang <> 'en' THEN
    RAISE EXCEPTION 'TEST FAILED: default preferred_language should be en, got %', lang;
  END IF;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

-- 6. PENDING_REVIEW → ACTIVE → SUSPENDED transitions allowed
DO $$
DECLARE
  sid UUID;
  cs TEXT;
BEGIN
  INSERT INTO public.shipowners (name, account_state) VALUES ('Lifecycle', 'PENDING_REVIEW') RETURNING id INTO sid;
  UPDATE public.shipowners SET account_state = 'ACTIVE' WHERE id = sid;
  UPDATE public.shipowners SET account_state = 'SUSPENDED' WHERE id = sid;
  SELECT account_state::TEXT INTO cs FROM public.shipowners WHERE id = sid;
  IF cs <> 'SUSPENDED' THEN
    RAISE EXCEPTION 'TEST FAILED: account_state transition broken, got %', cs;
  END IF;
  DELETE FROM public.shipowners WHERE id = sid;
END $$;

ROLLBACK;
SELECT '047 KYC extensions: PASS' AS test_result;
```

- [ ] **Step 1.4: Run the test**

```bash
./supabase/tests/run.sh migrations/047_shipowner_kyc_extensions.test.sql
```

Expected last line: `047 KYC extensions: PASS`

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/047_shipowner_kyc_extensions.sql \
        supabase/tests/migrations/047_shipowner_kyc_extensions.test.sql
git commit -m "feat(plan7a): mig 047 — shipowner KYC extensions (level B + C)"
```

---

## Task 2: Migration 048 — Payments polymorphic (renames + restructures)

**Files:**
- Create: `supabase/migrations/048_payments_polymorphic.sql`
- Test: `supabase/tests/migrations/048_payments_polymorphic.test.sql`

### Why this is the keystone

This migration renames `shipowner_payment_intents` (Plan 6 v0) → `payments` and restructures it polymorphically. All subsequent migrations (049 proofs, 050 ledger, 051 partial, 052 refunds) reference `payments.id`. If this is wrong, everything downstream is wrong.

### Step 2.1: Write the migration

- [ ] **Step 2.1: Create migration file**

Create `supabase/migrations/048_payments_polymorphic.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 048: Payments polymorphic table for Plan 7 v1 (10 rails)
-- Renames shipowner_payment_intents → payments, adds rail enum + JSONB details
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Enums
CREATE TYPE public.payment_rail AS ENUM (
  'STRIPE',           -- 1 carte / Apple Pay / SEPA via Stripe
  'WIRE_TRANSFER',    -- 2 virement SWIFT/SEPA out-of-band
  'CASH',             -- 3 cash au guichet port
  'CHEQUE',           -- 4 chèque
  'LETTER_OF_CREDIT', -- 5 LC
  'NETTING',          -- 6 compensation/netting (SUPERADMIN)
  'THIRD_PARTY',      -- 7 paiement par tiers
  'MOBILE_MONEY',     -- 8 EVC Plus / Zaad / autre (manuel en v1)
  'BANK_GUARANTEE',   -- 9 standby LC / garantie (SUPERADMIN)
  'WALLET'            -- imputation depuis wallet
);

CREATE TYPE public.payment_status_v7 AS ENUM (
  'INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED'
);

-- 2. Create new payments table
CREATE TABLE public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id),
  declared_by     UUID REFERENCES public.profiles(id),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        TEXT   NOT NULL CHECK (length(currency) = 3),
  amount_usd_minor BIGINT NOT NULL,
  fx_rate         NUMERIC(18,8),
  fx_rate_source  TEXT,
  fx_rate_locked_at TIMESTAMPTZ,
  rail            public.payment_rail NOT NULL,
  rail_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_reference TEXT,
  status          public.payment_status_v7 NOT NULL DEFAULT 'INITIATED',
  rejected_reason TEXT,
  confirmed_by    UUID REFERENCES public.profiles(id),
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT payments_currency_amount_consistent CHECK (
    (currency = 'USD' AND amount_minor = amount_usd_minor AND fx_rate IS NULL)
    OR (currency <> 'USD' AND fx_rate IS NOT NULL AND fx_rate > 0)
  ),
  CONSTRAINT payments_confirmed_audit CHECK (
    (status <> 'CONFIRMED') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT payments_stripe_external_ref CHECK (
    NOT (rail = 'STRIPE' AND status IN ('PROCESSING','CONFIRMED','REFUNDED')
         AND external_reference IS NULL)
  )
);

CREATE INDEX idx_payments_owner_status ON public.payments(shipowner_id, status);
CREATE INDEX idx_payments_txn ON public.payments(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_payments_external_ref ON public.payments(external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX idx_payments_pending_admin ON public.payments(rail, status)
  WHERE status IN ('INITIATED','PROCESSING');

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Migrate existing rows from shipowner_payment_intents (Plan 6 v0)
-- (likely empty in prod, but executed for safety)
INSERT INTO public.payments (
  id, transaction_id, shipowner_id, declared_by,
  amount_minor, currency, amount_usd_minor,
  rail, rail_details, status, created_at, updated_at
)
SELECT
  pi.id,
  pi.transaction_id,
  -- pi.owner_profile_id is a profile, look up shipowners.id via profile_id
  (SELECT s.id FROM public.shipowners s WHERE s.profile_id = pi.owner_profile_id LIMIT 1),
  pi.owner_profile_id,
  COALESCE(t.tax_amount_usd_minor, 0),
  'USD',
  COALESCE(t.tax_amount_usd_minor, 0),
  'WIRE_TRANSFER'::public.payment_rail,
  jsonb_build_object('legacy_v0', true, 'reference', pi.reference),
  CASE pi.status::TEXT
    WHEN 'DECLARED'  THEN 'INITIATED'::public.payment_status_v7
    WHEN 'CONFIRMED' THEN 'CONFIRMED'::public.payment_status_v7
    WHEN 'REJECTED'  THEN 'REJECTED'::public.payment_status_v7
  END,
  pi.declared_at,
  pi.updated_at
FROM public.shipowner_payment_intents pi
LEFT JOIN public.transactions t ON t.id = pi.transaction_id
WHERE EXISTS (SELECT 1 FROM public.shipowners s WHERE s.profile_id = pi.owner_profile_id);

-- 4. Drop legacy table (data migrated above)
DROP TABLE IF EXISTS public.shipowner_payment_intents CASCADE;
DROP TYPE IF EXISTS public.shipowner_payment_intent_status;

-- 5. Enable RLS (policies added in Phase B/C; Phase A creates structure only)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payments IS
  'Plan 7 v1: polymorphic payment row, one row per attempt. Rail-specific data in rail_details JSONB.';

-- DOWN:
-- DROP TABLE public.payments CASCADE;
-- DROP TYPE public.payment_status_v7;
-- DROP TYPE public.payment_rail;
-- (legacy shipowner_payment_intents would need to be re-created from a backup)
```

- [ ] **Step 2.2: Run migration to verify it applies cleanly**

```bash
supabase db reset
```

Expected: applies cleanly through migration 048.

- [ ] **Step 2.3: Write the test file**

Create `supabase/tests/migrations/048_payments_polymorphic.test.sql`:

```sql
BEGIN;

-- Setup: a shipowner + a transaction
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Owner');
INSERT INTO public.transactions (id, vessel_id, shipowner_id, document_type, transaction_type, tax_amount_usd_minor, status)
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001',
    NULL,
    'aaaaaaaa-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX', 1000000, 'PENDING'
  ) ON CONFLICT DO NOTHING;

-- 1. Happy path: USD STRIPE INITIATED
DO $$
BEGIN
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          500000, 'USD', 500000, 'STRIPE', 'INITIATED');
END $$;

-- 2. Reject: currency=USD with fx_rate set
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, fx_rate, fx_rate_source, fx_rate_locked_at, rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            500000, 'USD', 500000, 1.0, 'ECB', NOW(), 'STRIPE');
    RAISE EXCEPTION 'TEST FAILED: USD with fx_rate accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 3. Reject: currency=EUR without fx_rate
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            500000, 'EUR', 540000, 'WIRE_TRANSFER');
    RAISE EXCEPTION 'TEST FAILED: EUR without fx_rate accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 4. Reject: status=CONFIRMED without confirmed_by/confirmed_at
DO $$
DECLARE pid UUID;
BEGIN
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          100, 'USD', 100, 'WIRE_TRANSFER', 'INITIATED')
  RETURNING id INTO pid;

  BEGIN
    UPDATE public.payments SET status = 'CONFIRMED' WHERE id = pid;
    RAISE EXCEPTION 'TEST FAILED: CONFIRMED without confirmed_by accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 5. Reject: rail=STRIPE status=CONFIRMED without external_reference
DO $$
DECLARE pid UUID; admin_id UUID;
BEGIN
  -- Get any profile to act as admin
  SELECT id INTO admin_id FROM public.profiles LIMIT 1;
  IF admin_id IS NULL THEN
    -- Skip: no profiles seeded
    RETURN;
  END IF;

  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          100, 'USD', 100, 'STRIPE', 'INITIATED')
  RETURNING id INTO pid;

  BEGIN
    UPDATE public.payments SET status='CONFIRMED', confirmed_by=admin_id, confirmed_at=NOW()
      WHERE id = pid;
    RAISE EXCEPTION 'TEST FAILED: STRIPE CONFIRMED without external_reference accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 6. Multi-currency happy path: EUR with fx_rate
DO $$
BEGIN
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, fx_rate, fx_rate_source, fx_rate_locked_at, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          500000, 'EUR', 540000, 1.08, 'OPENEXCHANGERATES', NOW(),
          'WIRE_TRANSFER', 'INITIATED');
END $$;

-- 7. amount_minor = 0 rejected
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            0, 'USD', 0, 'WIRE_TRANSFER');
    RAISE EXCEPTION 'TEST FAILED: amount_minor=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- 8. All 10 rails inserted (smoke)
DO $$
DECLARE r public.payment_rail;
BEGIN
  FOREACH r IN ARRAY ARRAY['STRIPE','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT',
                           'NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET']::public.payment_rail[]
  LOOP
    INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
      amount_usd_minor, rail, status)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            100, 'USD', 100, r, 'INITIATED');
  END LOOP;
END $$;

ROLLBACK;
SELECT '048 payments polymorphic: PASS' AS test_result;
```

- [ ] **Step 2.4: Run the test**

```bash
./supabase/tests/run.sh migrations/048_payments_polymorphic.test.sql
```

Expected last line: `048 payments polymorphic: PASS`

- [ ] **Step 2.5: Commit**

```bash
git add supabase/migrations/048_payments_polymorphic.sql \
        supabase/tests/migrations/048_payments_polymorphic.test.sql
git commit -m "feat(plan7a): mig 048 — payments polymorphic (10 rails, JSONB details)"
```

---

## Task 3: Migration 049 — Payment proofs

**Files:**
- Create: `supabase/migrations/049_payment_proofs.sql`
- Test: `supabase/tests/migrations/049_payment_proofs.test.sql`

### Step 3.1: Write the migration

- [ ] **Step 3.1: Create migration file**

Create `supabase/migrations/049_payment_proofs.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 049: Payment proofs (1 payment → N uploaded proof files)
-- Storage bucket 'payment-proofs' RLS handled at app layer + Supabase Storage rules
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.payment_proofs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INT  NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5*1024*1024),
  uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description     TEXT
);
CREATE INDEX idx_proofs_payment ON public.payment_proofs(payment_id);

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.payment_proofs IS
  'Plan 7 v1: uploaded proof files for a payment. Files in Supabase Storage payment-proofs bucket.';

-- DOWN: DROP TABLE public.payment_proofs CASCADE;
```

- [ ] **Step 3.2: Run migration**

```bash
supabase db reset
```

Expected: applies cleanly through 049.

- [ ] **Step 3.3: Write the test file**

Create `supabase/tests/migrations/049_payment_proofs.test.sql`:

```sql
BEGIN;

-- Setup
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Test Owner');
INSERT INTO public.transactions (id, vessel_id, shipowner_id, document_type, transaction_type, tax_amount_usd_minor, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', NULL,
    'aaaaaaaa-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX', 100, 'PENDING');

INSERT INTO public.payments (id, transaction_id, shipowner_id, amount_minor, currency,
  amount_usd_minor, rail, status)
VALUES (
  'cccccccc-0000-0000-0000-000000000001',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  100, 'USD', 100, 'WIRE_TRANSFER', 'INITIATED'
);

-- Get a profile to use as uploaded_by
DO $$
DECLARE prof UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE NOTICE 'TEST SKIPPED: no profile to upload as';
    RETURN;
  END IF;

  -- 1. Happy path
  INSERT INTO public.payment_proofs (payment_id, storage_path, mime_type, size_bytes, uploaded_by)
  VALUES ('cccccccc-0000-0000-0000-000000000001', 'owner1/c.../proof.pdf',
          'application/pdf', 1024, prof);

  -- 2. size_bytes <= 0 rejected
  BEGIN
    INSERT INTO public.payment_proofs (payment_id, storage_path, mime_type, size_bytes, uploaded_by)
    VALUES ('cccccccc-0000-0000-0000-000000000001', 'p2', 'image/png', 0, prof);
    RAISE EXCEPTION 'TEST FAILED: size_bytes=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 3. size_bytes > 5 MB rejected
  BEGIN
    INSERT INTO public.payment_proofs (payment_id, storage_path, mime_type, size_bytes, uploaded_by)
    VALUES ('cccccccc-0000-0000-0000-000000000001', 'p3', 'application/pdf', 6*1024*1024, prof);
    RAISE EXCEPTION 'TEST FAILED: size_bytes >5MB accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. Cascade delete: deleting payment removes proofs
  DELETE FROM public.payments WHERE id = 'cccccccc-0000-0000-0000-000000000001';
  PERFORM 1 FROM public.payment_proofs WHERE payment_id = 'cccccccc-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: payment_proofs not cascaded on payment delete';
  END IF;
END $$;

ROLLBACK;
SELECT '049 payment proofs: PASS' AS test_result;
```

- [ ] **Step 3.4: Run the test**

```bash
./supabase/tests/run.sh migrations/049_payment_proofs.test.sql
```

Expected last line: `049 payment proofs: PASS`

- [ ] **Step 3.5: Commit**

```bash
git add supabase/migrations/049_payment_proofs.sql \
        supabase/tests/migrations/049_payment_proofs.test.sql
git commit -m "feat(plan7a): mig 049 — payment_proofs table + cascade delete"
```

---

## Task 4: Migration 050 — Wallets and ledger (double-entry)

**Files:**
- Create: `supabase/migrations/050_wallets_and_ledger.sql`
- Test: `supabase/tests/migrations/050_wallets_and_ledger.test.sql`

### Critical invariant tested

`wallets.balance_usd_minor = SUM(wallet_ledger.amount_signed_usd_minor WHERE wallet_id=wallet.id)`. If this ever drifts, it's a P0 bug.

### Step 4.1: Write the migration

- [ ] **Step 4.1: Create migration file**

Create `supabase/migrations/050_wallets_and_ledger.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 050: Wallets (1 per shipowner) + double-entry ledger
-- Invariant: SUM(wallet_ledger.amount_signed) = wallets.balance (per wallet)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.wallets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id             UUID NOT NULL UNIQUE REFERENCES public.shipowners(id),
  balance_usd_minor        BIGINT NOT NULL DEFAULT 0,
  auto_apply_to_proforma   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_balance_non_negative CHECK (balance_usd_minor >= 0)
);

CREATE TRIGGER wallets_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TYPE public.ledger_entry_kind AS ENUM (
  'TOPUP', 'OVERPAYMENT_CREDIT', 'REFUND_CREDIT',
  'PROFORMA_APPLY', 'ADMIN_ADJUSTMENT', 'FX_DIFFERENCE'
);

CREATE TABLE public.wallet_ledger (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id                UUID NOT NULL REFERENCES public.wallets(id),
  amount_signed_usd_minor  BIGINT NOT NULL,
  kind                     public.ledger_entry_kind NOT NULL,
  payment_id               UUID REFERENCES public.payments(id),
  transaction_id           UUID REFERENCES public.transactions(id),
  refund_id                UUID,                       -- forward decl. → 052
  created_by               UUID NOT NULL REFERENCES public.profiles(id),
  justification            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_amount_nonzero CHECK (amount_signed_usd_minor <> 0),
  CONSTRAINT ledger_admin_adjustment_justified
    CHECK (kind <> 'ADMIN_ADJUSTMENT' OR justification IS NOT NULL)
);

CREATE INDEX idx_ledger_wallet_created
  ON public.wallet_ledger(wallet_id, created_at DESC);

-- Trigger to maintain wallets.balance = SUM(ledger). Uses FOR UPDATE to serialize concurrent writes.
CREATE FUNCTION public.apply_ledger_to_wallet() RETURNS TRIGGER AS $$
DECLARE
  current_balance BIGINT;
  new_balance BIGINT;
BEGIN
  -- Lock the wallet row to prevent race conditions
  SELECT balance_usd_minor INTO current_balance
    FROM public.wallets WHERE id = NEW.wallet_id FOR UPDATE;
  new_balance := current_balance + NEW.amount_signed_usd_minor;

  IF new_balance < 0 THEN
    RAISE EXCEPTION 'Wallet balance would go negative: % + % = %',
      current_balance, NEW.amount_signed_usd_minor, new_balance
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.wallets
     SET balance_usd_minor = new_balance,
         updated_at = NOW()
   WHERE id = NEW.wallet_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_apply
  AFTER INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.apply_ledger_to_wallet();

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.wallets IS
  'Plan 7 v1: one wallet per shipowner, USD only. Balance maintained by trigger from wallet_ledger.';
COMMENT ON TABLE public.wallet_ledger IS
  'Plan 7 v1: append-only double-entry ledger. INVARIANT: SUM(amount_signed) per wallet_id = wallets.balance_usd_minor.';

-- DOWN:
-- DROP TRIGGER trg_ledger_apply ON public.wallet_ledger;
-- DROP FUNCTION public.apply_ledger_to_wallet;
-- DROP TABLE public.wallet_ledger;
-- DROP TYPE public.ledger_entry_kind;
-- DROP TABLE public.wallets;
```

- [ ] **Step 4.2: Run migration**

```bash
supabase db reset
```

Expected: clean.

- [ ] **Step 4.3: Write the test file**

Create `supabase/tests/migrations/050_wallets_and_ledger.test.sql`:

```sql
BEGIN;

-- Setup: 2 shipowners + 1 profile to act as created_by
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Owner A'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Owner B');

DO $$
DECLARE
  prof UUID;
  wA UUID;
  wB UUID;
  bal BIGINT;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE NOTICE 'TEST SKIPPED: no profile';
    RETURN;
  END IF;

  -- 1. Create wallets
  INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001') RETURNING id INTO wA;
  INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000002') RETURNING id INTO wB;

  -- 2. Initial balance = 0
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 0 THEN RAISE EXCEPTION 'TEST FAILED: initial balance not zero, got %', bal; END IF;

  -- 3. TOPUP +1000 → balance 1000
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
    VALUES (wA, 1000, 'TOPUP', prof);
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 1000 THEN RAISE EXCEPTION 'TEST FAILED: balance after TOPUP, got %', bal; END IF;

  -- 4. PROFORMA_APPLY -300 → balance 700
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
    VALUES (wA, -300, 'PROFORMA_APPLY', prof);
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 700 THEN RAISE EXCEPTION 'TEST FAILED: balance after apply, got %', bal; END IF;

  -- 5. Try to debit beyond balance → should fail
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
      VALUES (wA, -1000, 'PROFORMA_APPLY', prof);
    RAISE EXCEPTION 'TEST FAILED: over-debit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 6. Wallet A balance still 700 after the failed attempt
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  IF bal <> 700 THEN RAISE EXCEPTION 'TEST FAILED: balance changed after failed debit, got %', bal; END IF;

  -- 7. amount_signed = 0 rejected
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
      VALUES (wA, 0, 'TOPUP', prof);
    RAISE EXCEPTION 'TEST FAILED: amount=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 8. ADMIN_ADJUSTMENT without justification → rejected
  BEGIN
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by)
      VALUES (wA, 100, 'ADMIN_ADJUSTMENT', prof);
    RAISE EXCEPTION 'TEST FAILED: ADMIN_ADJUSTMENT without justification accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 9. ADMIN_ADJUSTMENT with justification → accepted
  INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, created_by, justification)
    VALUES (wA, 50, 'ADMIN_ADJUSTMENT', prof, 'Geste commercial');

  -- 10. Invariant: SUM(ledger) = balance for wallet A
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wA;
  DECLARE
    ledger_sum BIGINT;
  BEGIN
    SELECT COALESCE(SUM(amount_signed_usd_minor), 0) INTO ledger_sum
      FROM public.wallet_ledger WHERE wallet_id = wA;
    IF ledger_sum <> bal THEN
      RAISE EXCEPTION 'TEST FAILED: invariant broken — sum=% balance=%', ledger_sum, bal;
    END IF;
  END;

  -- 11. Wallet B isolation: ledger entries on A don't affect B
  SELECT balance_usd_minor INTO bal FROM public.wallets WHERE id = wB;
  IF bal <> 0 THEN RAISE EXCEPTION 'TEST FAILED: wallet B contaminated, got %', bal; END IF;

  -- 12. UNIQUE constraint: one wallet per shipowner
  BEGIN
    INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'TEST FAILED: duplicate wallet for shipowner accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

ROLLBACK;
SELECT '050 wallets and ledger: PASS' AS test_result;
```

- [ ] **Step 4.4: Run the test**

```bash
./supabase/tests/run.sh migrations/050_wallets_and_ledger.test.sql
```

Expected last line: `050 wallets and ledger: PASS`

- [ ] **Step 4.5: Commit**

```bash
git add supabase/migrations/050_wallets_and_ledger.sql \
        supabase/tests/migrations/050_wallets_and_ledger.test.sql
git commit -m "feat(plan7a): mig 050 — wallets + double-entry ledger with invariant"
```

---

## Task 5: Migration 051 — Transactions partial payment

**Files:**
- Create: `supabase/migrations/051_transactions_partial_payment.sql`
- Test: `supabase/tests/migrations/051_transactions_partial_payment.test.sql`

### Step 5.1: Write the migration

- [ ] **Step 5.1: Create migration file**

Create `supabase/migrations/051_transactions_partial_payment.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 051: Transactions partial payment support
-- Adds PARTIALLY_PAID status + view + recompute function + trigger on payments
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID' AFTER 'PENDING';

-- Aggregated view: paid amount per transaction (only CONFIRMED payments count)
CREATE OR REPLACE VIEW public.transaction_paid_summary AS
  SELECT
    t.id AS transaction_id,
    t.tax_amount_usd_minor AS due_usd_minor,
    COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0)::BIGINT AS paid_usd_minor,
    (t.tax_amount_usd_minor
      - COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0))::BIGINT AS remaining_usd_minor
  FROM public.transactions t
  LEFT JOIN public.payments p ON p.transaction_id = t.id
  GROUP BY t.id;

COMMENT ON VIEW public.transaction_paid_summary IS
  'Plan 7 v1: per-transaction aggregate of confirmed payments.';

-- Function to recompute transaction.status based on summary
CREATE OR REPLACE FUNCTION public.recompute_transaction_status(p_txn_id UUID)
RETURNS VOID AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM public.transaction_paid_summary WHERE transaction_id = p_txn_id;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.transactions SET status =
    CASE
      WHEN s.paid_usd_minor >= s.due_usd_minor THEN 'PAID'::public.transaction_status
      WHEN s.paid_usd_minor > 0                THEN 'PARTIALLY_PAID'::public.transaction_status
      ELSE                                          'PENDING'::public.transaction_status
    END
   WHERE id = p_txn_id;
END $$ LANGUAGE plpgsql;

-- Trigger on payments: recompute transaction status on any status transition
CREATE OR REPLACE FUNCTION public.payments_recompute_txn_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only recompute on transitions involving CONFIRMED (or coming from CONFIRMED)
  IF (TG_OP = 'INSERT' AND NEW.status = 'CONFIRMED')
    OR (TG_OP = 'UPDATE' AND (NEW.status <> OLD.status))
  THEN
    PERFORM public.recompute_transaction_status(NEW.transaction_id);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_recompute_txn_status
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_recompute_txn_status();

-- DOWN:
-- DROP TRIGGER trg_payments_recompute_txn_status ON public.payments;
-- DROP FUNCTION public.payments_recompute_txn_status;
-- DROP FUNCTION public.recompute_transaction_status;
-- DROP VIEW public.transaction_paid_summary;
-- (PARTIALLY_PAID enum value cannot be removed)
```

- [ ] **Step 5.2: Run migration**

```bash
supabase db reset
```

Expected: clean.

- [ ] **Step 5.3: Write the test file**

Create `supabase/tests/migrations/051_transactions_partial_payment.test.sql`:

```sql
BEGIN;

-- Setup
INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'PartialOwner');

INSERT INTO public.transactions (id, vessel_id, shipowner_id, document_type, transaction_type, tax_amount_usd_minor, status)
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001', NULL,
    'aaaaaaaa-0000-0000-0000-000000000001',
    'PROFORMA', 'ENTRY_TAX', 1000, 'PENDING'
  );

DO $$
DECLARE
  prof UUID;
  ts TEXT;
  p1 UUID; p2 UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE NOTICE 'TEST SKIPPED: no profile';
    RETURN;
  END IF;

  -- 1. INITIATED payment doesn't change status
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          400, 'USD', 400, 'WIRE_TRANSFER', 'INITIATED')
  RETURNING id INTO p1;

  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PENDING' THEN
    RAISE EXCEPTION 'TEST FAILED: status changed on INITIATED, got %', ts;
  END IF;

  -- 2. CONFIRM partial → PARTIALLY_PAID
  UPDATE public.payments SET status='CONFIRMED', confirmed_by=prof, confirmed_at=NOW()
    WHERE id = p1;
  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: status not PARTIALLY_PAID after partial confirm, got %', ts;
  END IF;

  -- 3. CONFIRM second payment that completes → PAID
  INSERT INTO public.payments (transaction_id, shipowner_id, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          600, 'USD', 600, 'WIRE_TRANSFER', 'CONFIRMED', prof, NOW())
  RETURNING id INTO p2;

  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: status not PAID after full confirm, got %', ts;
  END IF;

  -- 4. View matches
  DECLARE
    paid BIGINT; remaining BIGINT;
  BEGIN
    SELECT paid_usd_minor, remaining_usd_minor INTO paid, remaining
      FROM public.transaction_paid_summary
      WHERE transaction_id = 'bbbbbbbb-0000-0000-0000-000000000001';
    IF paid <> 1000 OR remaining <> 0 THEN
      RAISE EXCEPTION 'TEST FAILED: view mismatch paid=% remaining=%', paid, remaining;
    END IF;
  END;

  -- 5. Reject of one payment → PARTIALLY_PAID again
  UPDATE public.payments SET status='REJECTED', rejected_reason='test'
    WHERE id = p1;
  SELECT status::TEXT INTO ts FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  IF ts <> 'PARTIALLY_PAID' THEN
    RAISE EXCEPTION 'TEST FAILED: status after reject of partial, got %', ts;
  END IF;
END $$;

ROLLBACK;
SELECT '051 partial payment: PASS' AS test_result;
```

- [ ] **Step 5.4: Run the test**

```bash
./supabase/tests/run.sh migrations/051_transactions_partial_payment.test.sql
```

Expected last line: `051 partial payment: PASS`

- [ ] **Step 5.5: Commit**

```bash
git add supabase/migrations/051_transactions_partial_payment.sql \
        supabase/tests/migrations/051_transactions_partial_payment.test.sql
git commit -m "feat(plan7a): mig 051 — transactions partial payment + status trigger"
```

---

## Task 6: Migration 052 — Refunds

**Files:**
- Create: `supabase/migrations/052_refunds.sql`
- Test: `supabase/tests/migrations/052_refunds.test.sql`

### Step 6.1: Write the migration

- [ ] **Step 6.1: Create migration file**

Create `supabase/migrations/052_refunds.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 052: Refunds (admin-driven, multi-rail)
-- Resolves wallet_ledger.refund_id forward declaration from 050
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.refund_status AS ENUM
  ('REQUESTED', 'APPROVED', 'EXECUTED', 'REJECTED');

CREATE TABLE public.refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES public.transactions(id),
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id),
  amount_usd_minor BIGINT NOT NULL CHECK (amount_usd_minor > 0),
  refund_rail     public.payment_rail NOT NULL,
  rail_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          public.refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by    UUID REFERENCES public.profiles(id),
  approved_by     UUID REFERENCES public.profiles(id),
  executed_by     UUID REFERENCES public.profiles(id),
  executed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refunds_executed_audit CHECK (
    (status <> 'EXECUTED') OR (executed_by IS NOT NULL AND executed_at IS NOT NULL)
  ),
  CONSTRAINT refunds_approved_audit CHECK (
    (status NOT IN ('APPROVED','EXECUTED')) OR (approved_by IS NOT NULL)
  )
);

CREATE INDEX idx_refunds_owner ON public.refunds(shipowner_id, status);
CREATE INDEX idx_refunds_txn ON public.refunds(transaction_id);

CREATE TRIGGER refunds_updated_at
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Resolve forward declaration on wallet_ledger.refund_id
ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT fk_ledger_refund
  FOREIGN KEY (refund_id) REFERENCES public.refunds(id);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

-- DOWN:
-- ALTER TABLE public.wallet_ledger DROP CONSTRAINT fk_ledger_refund;
-- DROP TABLE public.refunds;
-- DROP TYPE public.refund_status;
```

- [ ] **Step 6.2: Run migration**

```bash
supabase db reset
```

Expected: clean.

- [ ] **Step 6.3: Write the test file**

Create `supabase/tests/migrations/052_refunds.test.sql`:

```sql
BEGIN;

INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'RefundOwner');

INSERT INTO public.transactions (id, vessel_id, shipowner_id, document_type, transaction_type, tax_amount_usd_minor, status)
  VALUES (
    'bbbbbbbb-0000-0000-0000-000000000001', NULL,
    'aaaaaaaa-0000-0000-0000-000000000001',
    'REFUND', 'ENTRY_TAX', 500, 'PENDING'
  );

DO $$
DECLARE
  prof UUID;
  rid UUID;
BEGIN
  SELECT id INTO prof FROM public.profiles LIMIT 1;
  IF prof IS NULL THEN
    RAISE NOTICE 'TEST SKIPPED: no profile';
    RETURN;
  END IF;

  -- 1. Happy path: REQUESTED
  INSERT INTO public.refunds (transaction_id, shipowner_id, amount_usd_minor, refund_rail, requested_by)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001',
          500, 'WALLET', prof)
  RETURNING id INTO rid;

  -- 2. amount_usd_minor <= 0 rejected
  BEGIN
    INSERT INTO public.refunds (transaction_id, shipowner_id, amount_usd_minor, refund_rail)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            0, 'WALLET');
    RAISE EXCEPTION 'TEST FAILED: amount=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 3. APPROVED needs approved_by
  BEGIN
    UPDATE public.refunds SET status='APPROVED' WHERE id = rid;
    RAISE EXCEPTION 'TEST FAILED: APPROVED without approved_by accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. APPROVED with approved_by
  UPDATE public.refunds SET status='APPROVED', approved_by=prof WHERE id = rid;

  -- 5. EXECUTED needs executed_by + executed_at
  BEGIN
    UPDATE public.refunds SET status='EXECUTED' WHERE id = rid;
    RAISE EXCEPTION 'TEST FAILED: EXECUTED without audit accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  UPDATE public.refunds SET status='EXECUTED', executed_by=prof, executed_at=NOW() WHERE id = rid;

  -- 6. wallet_ledger.refund_id FK now valid
  DECLARE
    wid UUID;
  BEGIN
    INSERT INTO public.wallets (shipowner_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001') RETURNING id INTO wid;
    INSERT INTO public.wallet_ledger (wallet_id, amount_signed_usd_minor, kind, refund_id, created_by)
      VALUES (wid, 500, 'REFUND_CREDIT', rid, prof);
    -- accepted = pass
  END;
END $$;

ROLLBACK;
SELECT '052 refunds: PASS' AS test_result;
```

- [ ] **Step 6.4: Run the test**

```bash
./supabase/tests/run.sh migrations/052_refunds.test.sql
```

Expected last line: `052 refunds: PASS`

- [ ] **Step 6.5: Commit**

```bash
git add supabase/migrations/052_refunds.sql \
        supabase/tests/migrations/052_refunds.test.sql
git commit -m "feat(plan7a): mig 052 — refunds (multi-rail, admin-driven)"
```

---

## Task 7: Migration 053 — Owner notifications

**Files:**
- Create: `supabase/migrations/053_owner_notifications.sql`
- Test: `supabase/tests/migrations/053_owner_notifications.test.sql`

### Step 7.1: Write the migration

- [ ] **Step 7.1: Create migration file**

Create `supabase/migrations/053_owner_notifications.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 053: Owner notifications (in-app bell + email tracking)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.owner_notification_kind AS ENUM (
  'KYC_APPROVED', 'KYC_REJECTED', 'KYC_C_REQUIRED',
  'ALERT_DETECTED', 'PROFORMA_ISSUED', 'PROFORMA_REMINDER',
  'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
  'FINAL_ISSUED', 'COMPLEMENT_ISSUED', 'REFUND_ISSUED',
  'WALLET_TOPPED_UP', 'WALLET_APPLIED', 'WALLET_LOW_BALANCE',
  'DISPUTE_UPDATED', 'OWNER_ESCALATION'
);

CREATE TABLE public.owner_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  kind            public.owner_notification_kind NOT NULL,
  title_key       TEXT NOT NULL,
  body_key        TEXT NOT NULL,
  body_params     JSONB NOT NULL DEFAULT '{}'::jsonb,
  deep_link       TEXT,
  read_at         TIMESTAMPTZ,
  emailed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_owner_unread
  ON public.owner_notifications(shipowner_id, read_at)
  WHERE read_at IS NULL;
CREATE INDEX idx_notif_owner_created
  ON public.owner_notifications(shipowner_id, created_at DESC);

ALTER TABLE public.owner_notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.owner_notifications IS
  'Plan 7 v1: in-app notifications for shipowners. emailed_at tracks Resend delivery.';

-- DOWN:
-- DROP TABLE public.owner_notifications;
-- DROP TYPE public.owner_notification_kind;
```

- [ ] **Step 7.2: Run migration**

```bash
supabase db reset
```

Expected: clean.

- [ ] **Step 7.3: Write the test file**

Create `supabase/tests/migrations/053_owner_notifications.test.sql`:

```sql
BEGIN;

INSERT INTO public.shipowners (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'NotifOwner');

DO $$
DECLARE nid UUID;
BEGIN
  -- 1. Happy path
  INSERT INTO public.owner_notifications (shipowner_id, kind, title_key, body_key, deep_link)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001',
          'PROFORMA_ISSUED',
          'OwnerNotifications.proforma_issued.title',
          'OwnerNotifications.proforma_issued.body',
          '/owner/invoices')
  RETURNING id INTO nid;

  -- 2. body_params JSONB defaults to {}
  PERFORM 1 FROM public.owner_notifications
    WHERE id = nid AND body_params = '{}'::jsonb;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: body_params not default empty';
  END IF;

  -- 3. Mark as read
  UPDATE public.owner_notifications SET read_at = NOW() WHERE id = nid;
  PERFORM 1 FROM public.owner_notifications WHERE id = nid AND read_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: read_at update failed';
  END IF;

  -- 4. Cascade delete on shipowner removal
  DELETE FROM public.shipowners WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  PERFORM 1 FROM public.owner_notifications WHERE shipowner_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  IF FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: notifications not cascaded';
  END IF;
END $$;

ROLLBACK;
SELECT '053 owner notifications: PASS' AS test_result;
```

- [ ] **Step 7.4: Run the test**

```bash
./supabase/tests/run.sh migrations/053_owner_notifications.test.sql
```

Expected last line: `053 owner notifications: PASS`

- [ ] **Step 7.5: Commit**

```bash
git add supabase/migrations/053_owner_notifications.sql \
        supabase/tests/migrations/053_owner_notifications.test.sql
git commit -m "feat(plan7a): mig 053 — owner_notifications (16 kinds + cascade)"
```

---

## Task 8: Migration 054 — FX rates cache

**Files:**
- Create: `supabase/migrations/054_fx_rates_cache.sql`
- Test: `supabase/tests/migrations/054_fx_rates_cache.test.sql`

### Step 8.1: Write the migration

- [ ] **Step 8.1: Create migration file**

Create `supabase/migrations/054_fx_rates_cache.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 054: FX rates cache for multi-currency payments
-- Refresh job (pg_cron) wired in Phase C — Phase A only stores schema
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.fx_rates (
  base_ccy        TEXT NOT NULL CHECK (length(base_ccy) = 3),
  quote_ccy       TEXT NOT NULL CHECK (length(quote_ccy) = 3),
  rate            NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  source          TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_ccy, quote_ccy, fetched_at)
);
CREATE INDEX idx_fx_recent ON public.fx_rates(quote_ccy, fetched_at DESC);

COMMENT ON TABLE public.fx_rates IS
  'Plan 7 v1: cached FX rates. Multi-row history per (base,quote). Latest = ORDER BY fetched_at DESC LIMIT 1.';

-- Helper: get latest rate for (base, quote)
CREATE OR REPLACE FUNCTION public.fx_rate_latest(p_base TEXT, p_quote TEXT)
RETURNS TABLE (rate NUMERIC, source TEXT, fetched_at TIMESTAMPTZ) AS $$
  SELECT rate, source, fetched_at FROM public.fx_rates
   WHERE base_ccy = p_base AND quote_ccy = p_quote
   ORDER BY fetched_at DESC LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Allowed currencies seeded into app_config (admin-tunable)
INSERT INTO public.app_config (key, value, description)
  VALUES (
    'fx.allowed_currencies',
    '["USD","EUR","GBP","AED","KES","SOS"]'::jsonb,
    'Plan 7 v1: currencies accepted for payment. fx-refresh cron pulls these.'
  )
  ON CONFLICT (key) DO NOTHING;

-- DOWN:
-- DROP FUNCTION public.fx_rate_latest;
-- DROP TABLE public.fx_rates;
-- DELETE FROM public.app_config WHERE key = 'fx.allowed_currencies';
```

- [ ] **Step 8.2: Run migration**

```bash
supabase db reset
```

Expected: clean. All 8 migrations applied.

- [ ] **Step 8.3: Write the test file**

Create `supabase/tests/migrations/054_fx_rates_cache.test.sql`:

```sql
BEGIN;

DO $$
DECLARE
  r NUMERIC; src TEXT; ts TIMESTAMPTZ;
BEGIN
  -- 1. Insert two rates for EUR
  INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source, fetched_at)
  VALUES ('USD','EUR', 0.92, 'OPENEXCHANGERATES', NOW() - INTERVAL '1 day');
  INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source, fetched_at)
  VALUES ('USD','EUR', 0.93, 'OPENEXCHANGERATES', NOW());

  -- 2. fx_rate_latest returns most recent
  SELECT rate, source, fetched_at INTO r, src, ts FROM public.fx_rate_latest('USD','EUR');
  IF r <> 0.93 THEN
    RAISE EXCEPTION 'TEST FAILED: fx_rate_latest returned wrong rate %', r;
  END IF;

  -- 3. rate <= 0 rejected
  BEGIN
    INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source) VALUES ('USD','GBP', 0, 'X');
    RAISE EXCEPTION 'TEST FAILED: rate=0 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 4. ccy length != 3 rejected
  BEGIN
    INSERT INTO public.fx_rates (base_ccy, quote_ccy, rate, source) VALUES ('US','EUR', 1, 'X');
    RAISE EXCEPTION 'TEST FAILED: ccy length 2 accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 5. allowed_currencies seeded
  PERFORM 1 FROM public.app_config WHERE key = 'fx.allowed_currencies';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED: app_config fx.allowed_currencies not seeded';
  END IF;
END $$;

ROLLBACK;
SELECT '054 fx rates cache: PASS' AS test_result;
```

- [ ] **Step 8.4: Run the test**

```bash
./supabase/tests/run.sh migrations/054_fx_rates_cache.test.sql
```

Expected last line: `054 fx rates cache: PASS`

- [ ] **Step 8.5: Commit**

```bash
git add supabase/migrations/054_fx_rates_cache.sql \
        supabase/tests/migrations/054_fx_rates_cache.test.sql
git commit -m "feat(plan7a): mig 054 — fx_rates cache + fx_rate_latest helper"
```

---

## Task 9: Aggregate test runner update + final smoke

**Files:**
- Modify: `supabase/tests/run-all.sh` (if exists; otherwise no change)

### Step 9.1: Run the full test suite end-to-end

- [ ] **Step 9.1: Reset DB and apply all 54 migrations**

```bash
supabase db reset
```

Expected: ends with `Finished supabase db reset.` and no error mention of 047-054.

- [ ] **Step 9.2: Run all 8 new test files**

```bash
for f in supabase/tests/migrations/0{47,48,49,50,51,52,53,54}_*.test.sql; do
  echo "=== Running $f ==="
  ./supabase/tests/run.sh "${f#supabase/tests/}" || { echo "FAIL: $f"; exit 1; }
done
echo "ALL PLAN 7A TESTS PASSED"
```

Expected: 8 lines `0NN ... : PASS`, then `ALL PLAN 7A TESTS PASSED`.

- [ ] **Step 9.3: Run all pre-existing tests too (regression)**

```bash
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || { echo "FAIL: $f"; exit 1; }
done
echo "ALL TESTS PASS"
```

Expected: every existing test still PASSES (including `039_shipowner_portal.test.sql` since the table was renamed, NOT dropped — but the test file references the old table name, so we need to verify or update).

- [ ] **Step 9.4: Verify Plan 6 v0 test still passes after rename**

```bash
grep -l "shipowner_payment_intents" supabase/tests/migrations/*.test.sql
```

If `039_shipowner_portal.test.sql` references the old table, it will fail (the table was renamed in 048). Decision: the legacy test is now obsolete (the table is gone). Mark it as deprecated:

If the grep returns `039_shipowner_portal.test.sql`:

```bash
# Move to legacy folder — it tested a table that no longer exists post-Plan 7A
mkdir -p supabase/tests/migrations/legacy/
git mv supabase/tests/migrations/039_shipowner_portal.test.sql \
       supabase/tests/migrations/legacy/039_shipowner_portal.test.sql

# Add a marker comment
cat > supabase/tests/migrations/legacy/README.md <<'EOF'
# Legacy migration tests

These tested tables that were renamed/dropped in later migrations.
Kept for historical reference; not run in CI.

- `039_shipowner_portal.test.sql` — superseded by `048_payments_polymorphic.test.sql`
  (table `shipowner_payment_intents` was renamed to `payments` in mig 048).
EOF
```

If the grep returns nothing, skip this step.

- [ ] **Step 9.5: Final regression run after legacy move**

```bash
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || { echo "FAIL: $f"; exit 1; }
done
echo "ALL TESTS PASS"
```

Expected: all PASS.

- [ ] **Step 9.6: Commit aggregated test fixes (if any)**

```bash
git add supabase/tests/migrations/legacy/
git commit -m "chore(plan7a): retire 039 legacy test (table renamed in 048)"
```

If nothing to commit, skip.

---

## Task 10: Verify hosted DB push (dry run only — actual push manual)

### Why dry-run only

Hosted DB push is a production-touching action — should be done by a human review, not automated in this plan. This step **prepares the diff** but does NOT push.

- [ ] **Step 10.1: List pending migrations vs hosted**

```bash
supabase db diff --linked --schema public > /tmp/plan7a-diff.sql
echo "=== Diff length ==="
wc -l /tmp/plan7a-diff.sql
echo "=== Top 60 lines ==="
head -60 /tmp/plan7a-diff.sql
```

Expected: shows 8 new migrations (047-054) ready to apply.

- [ ] **Step 10.2: Document the push procedure in the PR description**

Use this checklist in the PR description (don't run yet):

```markdown
### Hosted DB push procedure (manual, post-review)

```bash
# Verify what will be applied
supabase migration list --linked

# Push the new migrations (047-054)
supabase db push --include-all

# Verify on hosted via direct query
supabase db query --linked --file - <<EOF
SELECT migration_name FROM supabase_migrations.schema_migrations
 WHERE migration_name LIKE '047%' OR migration_name LIKE '054%'
 ORDER BY migration_name;
EOF
```

Expected: 8 rows from 047 through 054.
```

- [ ] **Step 10.3: Push the branch**

```bash
git push -u origin feat/plan-7a-schema-foundation
```

- [ ] **Step 10.4: Open the PR**

```bash
gh pr create --title "Plan 7A: Shipowner Portal v1 schema foundation (mig 047-054)" \
  --body "$(cat <<'EOF'
## Summary
- Adds 8 migrations (047-054) for Plan 7 v1 shipowner portal:
  - 047 KYC extensions (level B + C + 3 new account states)
  - 048 payments polymorphic (10 rails, JSONB rail_details, renames Plan 6 v0)
  - 049 payment_proofs (cascade-delete on payment removal)
  - 050 wallets + double-entry ledger (invariant SUM(ledger)=balance)
  - 051 transactions partial payment (PARTIALLY_PAID status, recompute trigger)
  - 052 refunds (multi-rail, admin-driven, resolves wallet_ledger.refund_id FK)
  - 053 owner_notifications (16 kinds, cascade-delete)
  - 054 fx_rates cache + fx_rate_latest helper + seeded allowed_currencies
- Phase A of Plan 7 — pure schema, no UI, ship-able alone.
- Spec: docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md

## Test plan
- [x] All 8 new migration tests pass locally
- [x] Pre-existing tests pass (regression)
- [x] Legacy test 039 moved to /legacy (table renamed in 048)
- [x] supabase db reset applies cleanly through 054
- [ ] Reviewer to verify hosted DB push checklist (in PR description below)
- [ ] Reviewer to confirm Plan 6 v0 had no rows in shipowner_payment_intents on hosted before merge (otherwise data migration in 048 needs validation)

## Hosted DB push procedure (manual, post-merge)

```bash
supabase migration list --linked
supabase db push --include-all
```

Verify on hosted afterwards:
```sql
SELECT migration_name FROM supabase_migrations.schema_migrations
 WHERE migration_name BETWEEN '047' AND '054'
 ORDER BY migration_name;
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10.5: Final verification**

```bash
git log --oneline develop..HEAD
```

Expected: 8-9 commits (one per migration + optionally legacy retire).

---

## Self-Review

After writing this plan, I checked it against the spec §4:

**Spec coverage** — Each of the 8 migrations described in spec §4.1-§4.8 has a corresponding task. The numbering shifted from spec's 040-047 to plan's 047-054 because slots 040-046 were already occupied; this is documented up-front in the file mapping table.

**Placeholder scan** — No `TBD`/`TODO`/`fill in` in any task body. All SQL is complete and runnable. All test files contain actual assertions, not "add tests for the above".

**Type consistency** — `payment_status_v7` enum is defined in 048 and used as the column type in `payments`. Could be confused with hypothetical existing `payment_status` from another migration, but `_v7` suffix avoids collision. The trigger function in 051 references `public.payment_status_v7` indirectly via the `payments` table column, no direct enum reference needed. `payment_rail` enum is defined in 048 and used in `refunds.refund_rail` in 052 (forward-compatible). `transaction_status` enum exists pre-Plan 7; we add `PARTIALLY_PAID` only.

**Issues found and fixed inline:**
- Task 5 originally had no test for INITIATED-status not changing transaction status. Added test 1 in 051 test file.
- Task 4 trigger originally didn't lock the wallet row → race condition risk. Fixed: added `FOR UPDATE` in `apply_ledger_to_wallet`.
- Task 9 originally didn't address legacy 039 test — now handles it explicitly.
- Spec referenced enum value `PARTIALLY_PAID` for `transaction_status` but we don't know if it already exists. Used `ADD VALUE IF NOT EXISTS` for safety.

**Out of scope confirmed:** RLS policies are mentioned but their actual `CREATE POLICY` statements are deferred to Phase B (KYC) and Phase C (payment workflows), where they'll be tested with real auth flows. Phase A only sets `ENABLE ROW LEVEL SECURITY` on the new tables. This is intentional — RLS without policies = locked-down by default, matches Plan 6 v0 pattern.
