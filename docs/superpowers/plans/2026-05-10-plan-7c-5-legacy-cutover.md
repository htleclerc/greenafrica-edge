# Plan 7C-5 — Legacy v0 Payment Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy Plan-6 v0 payment-intent code path (`shipowner_payment_intents` table, `paymentIntentService`, `declarePaymentIntent` + `resolvePaymentIntent` server actions, `<PayProformaDialog>`, `<PendingIntentsPanel>`) now that Plans 7C-1 through 7C-4 have shipped the v7 `payments` polymorphic table and its full UI surface. Delete the legacy files, strip remaining references, drop the legacy table.

**Architecture:** Pure DELETE plan — no new functionality, no new schema. 7 files deleted, 3 files trimmed, 1 migration (DROP TABLE). Backed by a hosted-DB inventory step before push: count any in-flight `DECLARED` intents and reconcile manually before the migration runs in production.

**Tech Stack:** PostgreSQL 17 / Supabase / Next.js 16 / TypeScript strict / Vitest. No new dependencies.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §11 (mig 048 comment "Phase C of Plan 7 will… DROP TABLE shipowner_payment_intents").

**Predecessor:** Plans 7C-1 through 7C-4 — ALL MERGED on develop (`827c356`). The v7 owner flow (`<PayDialog>` from 7C-2) and admin flow (`<PaymentsAdminPanel>` from 7C-3 + `<CashDeskForm>` from 7C-4) fully replace the legacy path.

**Successor:** Plan 7D — Stripe online flow (gated on UK entity confirmation). 7D can clean up the v0 outbound API helpers in `paymentService.ts` (`createStripePayment`, `createPaystackPayment`, etc.) if those become unused; Plan 7C-5 leaves them alone since they may still be reachable via `createPaymentRequest` and aren't a blocker.

**Out of scope:**
- `paymentService.ts` v0 outbound API helpers (`createStripePayment`, etc.) — kept; future Plan 7D or v1.1 sweep can drop if confirmed unused
- `frontend/src/app/api/transactions/mark-paid/route.ts` — agent-dashboard path, separate from owner-portal; not touched
- `frontend/src/components/dashboard/invoices/InvoicesPage.tsx` (agent-side) — calls `mark-paid` route, not legacy intent flow; not touched
- `OwnerPortal.invoices.hasPendingIntent` i18n key (if present) — Task 5 sweeps orphans
- AR / PT / SW translations — frozen in P2 backlog per project memory

---

## File Structure

### Files to DELETE

```
frontend/src/services/paymentIntentService.ts
frontend/src/actions/declarePaymentIntent.ts
frontend/src/actions/declarePaymentIntent.test.ts
frontend/src/actions/resolvePaymentIntent.ts
frontend/src/actions/resolvePaymentIntent.test.ts
frontend/src/app/owner/\(portal\)/invoices/PayProformaDialog.tsx
frontend/src/components/dashboard/admin/PendingIntentsPanel.tsx
```

### Files to MODIFY (strip legacy refs)

```
frontend/src/app/\(dashboard\)/admin/payments/page.tsx       # drop PendingIntentsPanel block + import + service call
frontend/src/app/owner/\(portal\)/invoices/page.tsx          # drop intent query from Promise.all + map + row field
frontend/src/app/owner/\(portal\)/invoices/InvoicesTable.tsx # drop has_pending_intent field + badge logic + isPayable check
```

### Files to CREATE

```
supabase/migrations/062_drop_shipowner_payment_intents.sql
supabase/tests/migrations/062_drop_shipowner_payment_intents.test.sql
```

### Test runners

```bash
# Postgres migration test
./supabase/tests/run.sh migrations/062_drop_shipowner_payment_intents.test.sql

# Full gates
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

---

## Task 1: Hosted-DB inventory — count in-flight intents

**Files:** None (operational SQL only)

This is a pre-coding sanity check, NOT a code change. Run against the **hosted** Supabase project (the prod-data source of truth) to know whether dropping the table will lose anything that matters. Run BEFORE writing any code; record the result in the PR description's pre-merge checklist.

- [ ] **Step 1: Connect to hosted Supabase via SQL editor**

Use the Supabase web console SQL editor on the hosted project. Or `psql` with the hosted connection string from `.env.local` (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).

- [ ] **Step 2: Run the inventory query**

```sql
SELECT
  status,
  COUNT(*) AS n,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM public.shipowner_payment_intents
GROUP BY status
ORDER BY status;
```

Expected: most intents in `CONFIRMED` or `REJECTED` state (resolved). The risky bucket is `DECLARED` (in-flight owner-side declarations that nobody resolved yet).

- [ ] **Step 3: Decide action based on inventory**

- **If COUNT(DECLARED) = 0**: safe to drop, proceed to Task 2. Note this in the PR description.
- **If COUNT(DECLARED) > 0**: each row is a real owner declaration that the admin never resolved. Before dropping the table:
  - For each row, check if the underlying `transactions.id` is now PAID (a v7 admin may have processed it via the new flow but the legacy row was never updated). If yes, mark the legacy row CONFIRMED via `UPDATE shipowner_payment_intents SET status='CONFIRMED', updated_at=NOW() WHERE id IN (...)` — historical record only.
  - For genuinely orphaned in-flight rows (the txn is still PENDING), email the affected shipowner: "Your payment declaration from <date> is in our queue; finance will be in touch within 48h." Then either resolve via the v7 path (record a manual payment in `/admin/payments`) or REJECT the legacy row with a note.
  - DO NOT proceed with mig 062 until COUNT(DECLARED) = 0.

- [ ] **Step 4: Save the inventory result**

Append the query output to the PR body under "Pre-merge checklist > Hosted DB inventory". Include date + counts per status.

**No commit for this task** — it's purely operational. Tasks 2-7 do the code changes.

---

## Task 2: Mig 062 — DROP TABLE shipowner_payment_intents

**Files:**
- Create: `supabase/migrations/062_drop_shipowner_payment_intents.sql`
- Create: `supabase/tests/migrations/062_drop_shipowner_payment_intents.test.sql`

- [ ] **Step 1: Write failing pg test**

Create `supabase/tests/migrations/062_drop_shipowner_payment_intents.test.sql`:

```sql
BEGIN;

-- Before mig 062: table exists.
-- After mig 062: table is gone.

-- 1. Table does not exist
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'shipowner_payment_intents';
  ASSERT n = 0, format('expected shipowner_payment_intents dropped, found %s', n);
END $$;

-- 2. No leftover RLS policies (they cascade with DROP TABLE but be explicit)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'shipowner_payment_intents';
  ASSERT n = 0, format('expected no leftover policies, found %s', n);
END $$;

-- 3. No leftover indexes
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'shipowner_payment_intents';
  ASSERT n = 0, format('expected no leftover indexes, found %s', n);
END $$;

-- 4. v7 payments table still exists (sanity — we drop the LEGACY, not v7)
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'payments';
  ASSERT n = 1, format('payments table must still exist, found %s', n);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test → FAIL** (expected — table still exists)

```bash
./supabase/tests/run.sh migrations/062_drop_shipowner_payment_intents.test.sql
```

Expected: FAIL on assertion 1 (table still exists).

If Docker is broken (same blocker as Plan 7C-2 mig 060 + Plan 7C-4 mig 061), skip the run and proceed — flag DONE_WITH_CONCERNS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/062_drop_shipowner_payment_intents.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 062: Drop legacy v0 shipowner_payment_intents table
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Plan 7C-5 cutover: the v7 `payments` polymorphic table (mig 048) +
-- its full UI surface (Plans 7C-1 through 7C-4) replaces the v0 payment
-- intent flow shipped in mig 039. The legacy `paymentIntentService`,
-- `declarePaymentIntent`/`resolvePaymentIntent` actions, `PayProformaDialog`,
-- and `PendingIntentsPanel` are all deleted in this PR. The DB table goes
-- with them.
--
-- Pre-push inventory step (Plan 7C-5 Task 1) must confirm zero
-- `status='DECLARED'` rows on hosted before applying. RESOLVED rows
-- (CONFIRMED/REJECTED) are historical and are lost; the v7 `payments`
-- table is the new source of truth for payment history. If audit
-- continuity matters, snapshot the legacy table contents to a CSV
-- before dropping. The mig 048 comment block explicitly anticipates
-- this drop in "Phase C of Plan 7".

DROP TABLE IF EXISTS public.shipowner_payment_intents CASCADE;

-- The trigger function from mig 039 was specific to this table — also
-- gone, but check for orphans:
-- DROP FUNCTION IF EXISTS public.handle_shipowner_payment_intents_updated_at();
-- (No-op if not defined; mig 039 used the shared updated_at trigger.)
```

- [ ] **Step 4: Re-run test → PASS** (all 4 assertions green)

```bash
./supabase/tests/run.sh migrations/062_drop_shipowner_payment_intents.test.sql
```

Expected: 4/4 ASSERT pass.

If Docker is broken, files are committed regardless; test will run pre-merge.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/062_drop_shipowner_payment_intents.sql \
        supabase/tests/migrations/062_drop_shipowner_payment_intents.test.sql
git -c commit.gpgsign=false commit -m "feat(7c-5): mig 062 — drop legacy shipowner_payment_intents table

Closes Phase C of Plan 7 (mig 048's comment block anticipated this).
DROP TABLE … CASCADE removes the table, its indexes, and its RLS
policies in one statement. v7 'payments' table (mig 048) is the new
source of truth for payment history.

Pre-push: confirm hosted has zero DECLARED rows (Task 1 inventory).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Drop owner-side legacy — page.tsx + InvoicesTable.tsx + PayProformaDialog.tsx

**Files:**
- Modify: `frontend/src/app/owner/(portal)/invoices/page.tsx`
- Modify: `frontend/src/app/owner/(portal)/invoices/InvoicesTable.tsx`
- Delete: `frontend/src/app/owner/(portal)/invoices/PayProformaDialog.tsx`

The owner-side legacy footprint:

1. `page.tsx` runs a query against `shipowner_payment_intents` inside its `Promise.all`, builds `pendingByTxn` Set, exposes `has_pending_intent` on each row.
2. `InvoicesTable.tsx` declares `has_pending_intent: boolean` on `InvoiceRow`, uses it in:
   - `isPayable(r)` predicate (line ~61: gates the Pay button when an intent is already declared)
   - A conditional badge "Payment declared" rendered instead of the status badge (line ~102)
3. `PayProformaDialog.tsx` is no longer imported anywhere (the file lingers from before Plan 7C-2's swap to `<PayDialog>`).

- [ ] **Step 1: Read both files first**

```bash
wc -l frontend/src/app/owner/\(portal\)/invoices/page.tsx \
       frontend/src/app/owner/\(portal\)/invoices/InvoicesTable.tsx
```

- [ ] **Step 2: Strip the intent query from `page.tsx`**

Edit `frontend/src/app/owner/(portal)/invoices/page.tsx`:

- In the `Promise.all([...])` block, remove the `shipowner_payment_intents` query (it's the 2nd query in the existing 4-query parallel). The remaining queries (transactions, wallets, receipts) stay.
- Remove the `pendingByTxn = new Set(...)` derivation.
- Remove `has_pending_intent: pendingByTxn.has(t.id)` from the `rows.map(...)` projection.
- Adjust destructuring: `[txnRes, intentRes, walletRes, receiptRes]` → `[txnRes, walletRes, receiptRes]`.

After edit, the file should compile clean without any reference to `shipowner_payment_intents`, `intentRes`, or `pendingByTxn`.

- [ ] **Step 3: Strip `has_pending_intent` from `InvoicesTable.tsx`**

Edit `frontend/src/app/owner/(portal)/invoices/InvoicesTable.tsx`:

- Remove `has_pending_intent: boolean` (with its JSDoc) from the `InvoiceRow` interface.
- In `isPayable(r)`: change `r.document_type === 'PROFORMA' && r.status === 'PENDING' && !r.has_pending_intent` → `r.document_type === 'PROFORMA' && r.status === 'PENDING'`. (Owners can now click Pay anytime on a pending pro-forma; the v7 `<PayDialog>` is idempotent — if an INITIATED payment already exists, the UI shows it as part of the payment history. If we want stricter "one active payment at a time" gating later, that's a follow-up.)
- In the `status` column render, remove the conditional that swaps in a "Payment declared" badge. Just always render the normal status badge:

```tsx
// Before:
{
    key: 'status',
    header: 'Status',
    render: (r) =>
        r.has_pending_intent && r.status === 'PENDING' ? (
            <OsBadge variant="info" label="Payment declared" />
        ) : (
            <OsBadge variant={statusVariant(r.status)} label={r.status} />
        ),
},

// After:
{
    key: 'status',
    header: 'Status',
    render: (r) => <OsBadge variant={statusVariant(r.status)} label={r.status} />,
},
```

- [ ] **Step 4: Delete `PayProformaDialog.tsx`**

```bash
git rm frontend/src/app/owner/\(portal\)/invoices/PayProformaDialog.tsx
```

- [ ] **Step 5: tsc + next build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

Both must succeed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/owner/\(portal\)/invoices/page.tsx \
        frontend/src/app/owner/\(portal\)/invoices/InvoicesTable.tsx
git -c commit.gpgsign=false commit -m "feat(7c-5): drop owner-side legacy intent path

- page.tsx: remove shipowner_payment_intents query from Promise.all;
  drop pendingByTxn set + has_pending_intent row field.
- InvoicesTable.tsx: drop has_pending_intent from InvoiceRow; simplify
  isPayable + status column (no more 'Payment declared' badge).
- Delete PayProformaDialog.tsx — unused since Plan 7C-2 swapped to
  <PayDialog>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Drop admin-side legacy — admin/payments/page.tsx + PendingIntentsPanel.tsx

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/payments/page.tsx`
- Delete: `frontend/src/components/dashboard/admin/PendingIntentsPanel.tsx`

After Plan 7C-3, `/admin/payments` renders 3 sections:
1. **New** `<PaymentsAdminPanel>` (v7 — primary surface)
2. **Legacy** `<details>` collapsing `<PendingIntentsPanel>` (only when `intents.length > 0`)
3. **Unchanged** `<PaymentProvidersPanel>`

Plan 7C-5 drops section 2 entirely.

- [ ] **Step 1: Strip legacy block from `page.tsx`**

Edit `frontend/src/app/(dashboard)/admin/payments/page.tsx`:

- Remove the `import { PendingIntentsPanel }` line.
- Remove the `import { listPendingPaymentIntents } from '@/services/paymentIntentService'` line.
- Remove the `const intents = await listPendingPaymentIntents(supabase)` line.
- Remove the entire `{intents.length > 0 && (<details>…</details>)}` block from the JSX.

After edit, the file should be ~20 lines smaller and only render `<PaymentsAdminPanel />` + `<PaymentProvidersPanel />`.

- [ ] **Step 2: Delete `PendingIntentsPanel.tsx`**

```bash
git rm frontend/src/components/dashboard/admin/PendingIntentsPanel.tsx
```

- [ ] **Step 3: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/payments/page.tsx
git -c commit.gpgsign=false commit -m "feat(7c-5): drop admin-side legacy intent panel

- /admin/payments page no longer imports PendingIntentsPanel or
  listPendingPaymentIntents. PaymentsAdminPanel (v7) is the only
  payment review surface; PaymentProvidersPanel unchanged.
- Delete PendingIntentsPanel.tsx — unused.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Drop the legacy actions + service + their tests

**Files:**
- Delete: `frontend/src/services/paymentIntentService.ts`
- Delete: `frontend/src/actions/declarePaymentIntent.ts`
- Delete: `frontend/src/actions/declarePaymentIntent.test.ts`
- Delete: `frontend/src/actions/resolvePaymentIntent.ts`
- Delete: `frontend/src/actions/resolvePaymentIntent.test.ts`

After Tasks 3 & 4 strip the consumers, these files have zero imports across the codebase. Verify and delete.

- [ ] **Step 1: Verify zero consumers**

```bash
grep -rln "paymentIntentService\|declarePaymentIntent\|resolvePaymentIntent" frontend/src/ 2>&1
```

Expected output: only the 5 files we're about to delete (the service + the 2 actions + their 2 tests, internally referencing each other). Nothing else.

If anything outside these 5 files references them, STOP and report — there's a leftover consumer to handle.

- [ ] **Step 2: Delete all 5 files**

```bash
git rm frontend/src/services/paymentIntentService.ts \
       frontend/src/actions/declarePaymentIntent.ts \
       frontend/src/actions/declarePaymentIntent.test.ts \
       frontend/src/actions/resolvePaymentIntent.ts \
       frontend/src/actions/resolvePaymentIntent.test.ts
```

- [ ] **Step 3: tsc + vitest + next build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

All three must succeed. The vitest count will DROP by however many tests were in `declarePaymentIntent.test.ts` + `resolvePaymentIntent.test.ts` — that's expected and intentional. Note the new count in the commit message.

- [ ] **Step 4: Commit**

```bash
git -c commit.gpgsign=false commit -m "feat(7c-5): drop legacy paymentIntentService + 2 server actions

Deleted: paymentIntentService, declarePaymentIntent (+test),
resolvePaymentIntent (+test). Zero consumers remain after Tasks 3 & 4
stripped the UI references.

Vitest count drops accordingly — the deleted tests covered legacy
behavior that no longer exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: i18n orphan sweep

**Files:**
- Modify: `frontend/messages/en.json` (if orphans found)
- Modify: `frontend/messages/fr.json` (if orphans found)

The legacy badge text "Payment declared" might have an i18n key under `OwnerPortal.invoices.hasPendingIntent` or similar that is now dead. Verify and clean up.

- [ ] **Step 1: Check for orphan keys**

```bash
grep -rn "hasPendingIntent\|paymentDeclared\|declarePaymentIntent" frontend/messages/ 2>&1 | head -20
```

If the output is empty: nothing to clean up. Mark Task 6 as DONE with the note "no orphan keys found".

If keys exist: remove them from both EN and FR files using the same Python-roundtrip pattern Plans 7C-2/7C-3/7C-4 used.

- [ ] **Step 2: Validate JSON (only if keys were removed)**

```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/en.json'))" && echo "EN ok"
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/fr.json'))" && echo "FR ok"
```

- [ ] **Step 3: Commit (only if keys were removed)**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git -c commit.gpgsign=false commit -m "feat(7c-5): i18n — drop orphan legacy intent keys

Removed dead keys left behind by the v0 payment intent UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

If no orphans: skip Step 3, document in the final report.

---

## Task 7: Final gates + commit summary

**Files:** None (verification only)

After Tasks 2-6 are committed, run all gates one more time to lock in the final state.

- [ ] **Step 1: Run all gates**

```bash
./supabase/tests/run.sh migrations/062_drop_shipowner_payment_intents.test.sql
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

Capture output:
- pg test: 4/4 pass (or DONE_WITH_CONCERNS if Docker broken)
- tsc: clean
- vitest: aggregate count (will be lower than before due to deleted tests)
- next build: green

- [ ] **Step 2: Inventory delete count**

```bash
git log --shortstat develop..HEAD
```

Expected: net negative line count (deletes > inserts).

- [ ] **Step 3: No commit for this task** — it's a verification gate.

Final summary message for the PR description:

```
Plan 7C-5 — Legacy cutover. 7 files deleted (paymentIntentService +
2 actions + 2 action tests + PayProformaDialog + PendingIntentsPanel),
3 files trimmed (admin/payments + owner/invoices pair). Mig 062 drops
shipowner_payment_intents CASCADE. Net diff: -<N> lines.

Gates: pg test 062 [PASS|DEFERRED — Docker], tsc clean, vitest <X>
passed (down from 364 due to deleted intent tests), next build green.
```

---

## Acceptance Criteria

- [ ] Mig 062 deletes `public.shipowner_payment_intents` table + all its policies + indexes
- [ ] `frontend/src/services/paymentIntentService.ts` deleted
- [ ] `frontend/src/actions/declarePaymentIntent.ts` + `.test.ts` deleted
- [ ] `frontend/src/actions/resolvePaymentIntent.ts` + `.test.ts` deleted
- [ ] `frontend/src/app/owner/(portal)/invoices/PayProformaDialog.tsx` deleted
- [ ] `frontend/src/components/dashboard/admin/PendingIntentsPanel.tsx` deleted
- [ ] `/admin/payments/page.tsx` no longer imports `PendingIntentsPanel` or `listPendingPaymentIntents`
- [ ] `/owner/(portal)/invoices/page.tsx` no longer queries `shipowner_payment_intents`
- [ ] `/owner/(portal)/invoices/InvoicesTable.tsx` no longer declares `has_pending_intent` on `InvoiceRow`
- [ ] No orphan i18n keys reference the legacy intent flow
- [ ] All gates green: tsc, vitest, next build, mig 062 pg test (or DEFERRED with explicit Docker note)
- [ ] Hosted DB inventory completed (zero DECLARED rows confirmed) BEFORE PR merge — captured in PR description

---

## Pre-merge checklist for the human

1. **CRITICAL — Hosted DB inventory (Task 1)**: run the SQL query against hosted Supabase to confirm zero `DECLARED` legacy intents. Document the result in the PR description. If any DECLARED rows exist, resolve them manually before pushing mig 062.

2. **Pending pg tests from prior plans**: mig 060 (Plan 7C-2) + mig 061 (Plan 7C-4) + mig 062 (Plan 7C-5) all need their pg tests run once Docker Desktop is restored. Three migration tests in one batch.

3. **Hosted DB push**: after PR merges:
   ```
   supabase db push --include-all
   ```
   Pushes mig 060 + 061 + 062 in sequence. Expect partial-state pattern (per Plan 7B precedent). Pre-diagnostic queries useful before push:
   ```sql
   SELECT * FROM pg_indexes WHERE indexname='payment_config_single_active'; -- 060
   SELECT column_name FROM information_schema.columns
     WHERE table_name='payment_config' AND column_name='routes_rail';        -- 060
   SELECT column_name FROM information_schema.columns
     WHERE table_name='payments' AND column_name='receipt_ref';              -- 061
   SELECT 1 FROM information_schema.tables
     WHERE table_name='shipowner_payment_intents';                            -- 062
   ```

4. **Audit trail snapshot (optional but recommended)**: before mig 062 runs in production, snapshot the legacy table to CSV for retention:
   ```
   psql "$HOSTED_DB_URL" -c "\copy (SELECT * FROM public.shipowner_payment_intents) TO 'shipowner_payment_intents_pre_drop_2026-05-10.csv' WITH CSV HEADER"
   ```
   File can live in `archives/` or an internal storage bucket — never in the git repo.

5. **Functional smoke test post-deploy**:
   - As shipowner: open `/owner/invoices` → click Pay on a PROFORMA → `<PayDialog>` opens (NOT the legacy `<PayProformaDialog>`). Walk through WIRE_TRANSFER. Row appears in `/admin/payments` as INITIATED.
   - As FINANCE_ADMIN: open `/admin/payments` → only see the v7 `<PaymentsAdminPanel>` and `<PaymentProvidersPanel>` (the legacy `<details>` block is gone). Click the INITIATED row → drawer opens → Confirm → CONFIRMED + receipt link appears.
   - Owner refreshes `/owner/invoices` → Receipt link visible next to PDF.

6. **Rollback plan**: if anything breaks post-deploy, revert the PR commit on develop. The deleted files are recoverable from git history. The DROP TABLE migration is **NOT** recoverable from `supabase db reset` (it would re-apply 062 and re-drop). Recovery would be: restore `shipowner_payment_intents` from the pre-drop CSV snapshot + re-apply mig 039's CREATE TABLE. Plan accordingly — verify the v7 path works under load before doing the hosted push.

---

## Self-Review Notes

- **Spec coverage**: mig 048's "Phase C of Plan 7" comment block predicted exactly this cleanup. ✓
- **Out-of-scope discipline**: leaves `paymentService.ts` v0 outbound helpers (`createStripePayment` etc.) and `mark-paid` route alone. Both could be next-cleanup candidates if confirmed unused — but neither is the legacy intent flow.
- **Risk profile**: pure deletion. Worst case: forgot a consumer somewhere → tsc catches it before commit. Worst hosted case: in-flight DECLARED intent gets dropped → Task 1 inventory prevents that.
- **Vitest count drop**: expected. The deleted tests (declarePaymentIntent + resolvePaymentIntent) were verifying legacy behavior; the v7 tests for `initiatePayment`, `confirmPayment`, `rejectPayment`, `cancelPayment`, `recordManualPayment` (Plans 7C-1 + 7C-3) cover the equivalent ground.
- **No new dependencies**: no `package.json` changes.
- **i18n parity**: EN ⇄ FR remain identical structure after Task 6 sweep.
