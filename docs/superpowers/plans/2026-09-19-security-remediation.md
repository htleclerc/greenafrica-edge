# Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the exploitable defects found in the 2026-09-19 security review and bounty hunt, in AfricGreen's Next.js + Supabase money-rail app.

**Architecture:** Code/SQL fixes only. Each task is independent and produces a testable deliverable. The P0 credential rotation is NOT in this plan (manual operator action). Nothing here is committed or pushed by the executor — the repo owner commits per their convention (`git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`, explicit staging, no AI attribution, push only when asked).

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres + Storage + RLS), Vitest, Zod, Upstash rate-limit.

**Spec:** the verified findings in the 2026-09-19 review conversation (source of truth for each task's rationale).

## Global Constraints

- Migrations are `supabase/migrations/NNN_name.sql`; highest existing is `160`. This plan uses `161`, `162`, `163` in task order. If new migrations landed since, renumber to the next free integers, in the same order.
- Every new `SECURITY DEFINER` function MUST include `SET search_path = ''` and fully-qualified identifiers (`public.*`, `storage.*`).
- Every migration file ends with a `-- DOWN:` comment block describing rollback, matching the repo convention (see mig 050/051/059).
- App code path for service-role access is only via `createTenantClient` / `createPlatformClient` (`@/lib/supabase/tenant`) — never raw `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- Frontend tests run with `npm --prefix frontend test` (vitest). A single file: `npm --prefix frontend test -- src/path/file.test.ts`.

---

### Task 1: Make wallet application atomic (fix double-settlement race)

**Why:** `applyWalletCredit` does a lock-free balance check, then INSERTs a CONFIRMED `payments` row (which the mig-051 trigger flips to `PAID`), then — in a *separate* auto-committed call — INSERTs the `wallet_ledger` debit. Two concurrent calls both pass the check and both mark their invoice `PAID`; the second ledger insert fails on the non-negative guard but its `payments`/`PAID` row is never rolled back. Reproduced PoC: wallet $1,000, two $600 invoices → $1,200 marked PAID for $600 debited. Fix: one atomic `SECURITY DEFINER` RPC that takes the wallet lock first.

**Files:**
- Create: `supabase/migrations/161_wallet_apply_atomic.sql`
- Modify: `frontend/src/services/walletApplyService.ts:41-139` (replace the 3-call body with one `.rpc()` call)
- Test: `frontend/src/actions/applyWallet.test.ts` (update to assert the RPC call, not separate inserts)

**Interfaces:**
- Consumes: nothing new.
- Produces: SQL function `public.apply_wallet_credit(p_txn_id uuid, p_shipowner_id uuid, p_actor_user_id uuid, p_amount_minor bigint) RETURNS TABLE(payment_id uuid, wallet_id uuid)`. `applyWalletCredit(admin, params)` keeps its existing signature and `ApplyWalletCreditResult = { walletId, paymentId }` return, so `applyWallet.ts` and `initiatePayment.ts` callers are unchanged.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/161_wallet_apply_atomic.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 161: atomic wallet application (fixes double-settlement race)
-- Replaces the 3 separate PostgREST calls in walletApplyService with one
-- transaction that locks the wallet FIRST, so concurrent applications serialize
-- and a second application against an insufficient balance can never leave a
-- CONFIRMED payment / PAID transaction behind.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_wallet_credit(
  p_txn_id         UUID,
  p_shipowner_id   UUID,
  p_actor_user_id  UUID,
  p_amount_minor   BIGINT
) RETURNS TABLE(payment_id UUID, wallet_id UUID) AS $$
DECLARE
  v_wallet_id UUID;
  v_balance   BIGINT;
  v_payment   UUID;
BEGIN
  -- Lock the wallet row FIRST. This is the whole fix: two concurrent calls
  -- serialize here, so the second sees the already-debited balance.
  SELECT id, balance_usd_minor INTO v_wallet_id, v_balance
    FROM public.wallets WHERE shipowner_id = p_shipowner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found for shipowner %', p_shipowner_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_balance < p_amount_minor THEN
    RAISE EXCEPTION 'insufficient wallet balance: % < %', v_balance, p_amount_minor
      USING ERRCODE = 'check_violation';
  END IF;

  -- Ledger debit (its AFTER-INSERT trigger re-checks non-negative under the lock).
  INSERT INTO public.wallet_ledger (wallet_id, kind, amount_signed_usd_minor, created_by)
    VALUES (v_wallet_id, 'PROFORMA_APPLY', -p_amount_minor, p_actor_user_id);

  -- Payment row, already CONFIRMED (money is in the wallet). The mig-051 trigger
  -- recomputes transaction status in the same transaction.
  INSERT INTO public.payments (
    transaction_id, shipowner_id, declared_by, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at, rail_details
  ) VALUES (
    p_txn_id, p_shipowner_id, p_actor_user_id, p_amount_minor, 'USD',
    p_amount_minor, 'WALLET', 'CONFIRMED', p_actor_user_id, NOW(),
    jsonb_build_object('applied_by_owner', true)
  ) RETURNING id INTO v_payment;

  RETURN QUERY SELECT v_payment, v_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- SECURITY DEFINER + PostgREST: without this, an authenticated user could call
-- the function directly and apply credit to arbitrary transactions. Only the
-- service-role (used by the server action after it verifies ownership) may call it.
REVOKE ALL ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) TO service_role;

-- DOWN:
-- DROP FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT);
```

- [ ] **Step 2: Apply the migration to a local DB and prove serialization**

Run (requires local Supabase or a throwaway Postgres with migs 050/051/161 applied):
`npx supabase db reset` (or apply 050,051,161 to a scratch DB).
Then, in two `psql` sessions against one wallet of balance 100000 and two $600 transactions, call `SELECT public.apply_wallet_credit(...)` concurrently.
Expected: exactly ONE call succeeds and debits; the other raises `check_violation` and inserts NO payment row (verify `SELECT count(*) FROM payments WHERE status='CONFIRMED'` = 1, and only ONE transaction is `PAID`).

- [ ] **Step 3: Update the failing test first**

Replace the body-level assertions in `frontend/src/actions/applyWallet.test.ts`. Change the `mockSupabase` so `.rpc` records the call and returns the new shape, and drop the per-table insert capture for the payment/ledger. New `rpc` mock and the two behavioural tests:

```ts
// in mockSupabase:
rpc: vi.fn(async (fn: string, args: any) => {
    rpcCalls.push({ fn, args });
    if (fn === 'apply_wallet_credit') {
        if (walletBalance < args.p_amount_minor) {
            return { data: null, error: { message: 'insufficient wallet balance' } };
        }
        return { data: [{ payment_id: 'pay-1', wallet_id: 'w-1' }], error: null };
    }
    return { data: null, error: null };
}),
// add at top: const rpcCalls: { fn: string; args: any }[] = [];
// reset in beforeEach: rpcCalls.length = 0;
```

Replace the "inserts WALLET CONFIRMED payment + negative ledger entry" test with:

```ts
it('applies via the atomic apply_wallet_credit RPC with correct args', async () => {
    const { applyWallet } = await import('./applyWallet');
    await applyWallet({
        transactionId: '550e8400-e29b-41d4-a716-446655440000',
        amountMinor: 50000,
    });
    const call = rpcCalls.find(c => c.fn === 'apply_wallet_credit');
    expect(call?.args).toMatchObject({
        p_txn_id: '550e8400-e29b-41d4-a716-446655440000',
        p_shipowner_id: 'so-1',
        p_amount_minor: 50000,
    });
});
```

Keep the "rejects when wallet has insufficient balance" and "rejects when transaction belongs to a different shipowner" tests as-is (the ownership check stays in `applyWallet.ts`; the insufficient-balance path now surfaces from the RPC error and must still throw `/insufficient/i`).

- [ ] **Step 4: Run the test, verify it fails**

Run: `npm --prefix frontend test -- src/actions/applyWallet.test.ts`
Expected: FAIL (service still does separate inserts; RPC not called).

- [ ] **Step 5: Refactor the service to call the RPC**

Replace `frontend/src/services/walletApplyService.ts` lines 45-138 (everything after the destructure) with:

```ts
    const { data, error } = await admin.rpc('apply_wallet_credit', {
        p_txn_id: transactionId,
        p_shipowner_id: shipownerId,
        p_actor_user_id: actorUserId,
        p_amount_minor: amountMinor,
    });
    if (error) {
        const insufficient = /insufficient|wallet not found/i.test(error.message);
        log.warn(insufficient ? 'wallet_insufficient_funds' : 'wallet_apply_db_error', {
            transactionId,
            shipownerId,
            requestedUsdMinor: amountMinor,
            error: error.message,
        });
        throw new Error(insufficient ? 'Insufficient wallet balance' : error.message);
    }

    const row = (data as { payment_id: string; wallet_id: string }[] | null)?.[0];
    if (!row) {
        log.error('wallet_apply_db_error', { transactionId, shipownerId, stage: 'rpc_empty_result' });
        throw new Error('wallet application returned no row');
    }

    log.info('wallet_applied', {
        transactionId,
        walletId: row.wallet_id,
        amountUsdMinor: amountMinor,
    });

    return { walletId: row.wallet_id, paymentId: row.payment_id };
```

Leave the doc-comment and the `import`/interface block (lines 1-44) unchanged.

- [ ] **Step 6: Run the test, verify it passes**

Run: `npm --prefix frontend test -- src/actions/applyWallet.test.ts`
Expected: PASS (all tests, including the two rejection tests and the log test).

- [ ] **Step 7: Run typecheck + the full wallet-related suite**

Run: `npm --prefix frontend run lint && npm --prefix frontend test -- src/actions`
Expected: no lint errors (no raw service-role usage), tests green.

---

### Task 2: Tighten `payments` admin RLS (block cross-jurisdiction / arbitrary-status writes)

**Why:** `payments_admin_insert` has no row constraint at all, and `payments_admin_update` gates only on role with no `WITH CHECK` — so any FINANCE_ADMIN, using their own JWT against PostgREST directly, can insert a fabricated CONFIRMED payment or update any payment in any jurisdiction, bypassing `can_confirm_payment` and `assertAdminCanActOn`. Verified: all admin *updates* (confirmPayment/rejectPayment/executeRefund) go through the service-role client, so no authenticated-admin UPDATE path exists — `payments_admin_update` can be dropped. The only authenticated-admin *writer* is `recordManualPayment` (INSERT, status `INITIATED` or `CONFIRMED`), so `payments_admin_insert` must be tightened, not dropped.

**Files:**
- Create: `supabase/migrations/162_payments_admin_rls_tighten.sql`

**Interfaces:**
- Consumes: `public.current_jurisdiction_ids()` (exists, mig 071/073).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm no authenticated-admin UPDATE path exists (guard against breaking prod)**

Run: `grep -rn "from('payments')" frontend/src/actions frontend/src/app/api --include=*.ts | grep -v createPlatformClient | grep -v createTenantClient | grep -v ".test."`
Expected: the only non-service-role writers are `cancelPayment.ts` (owner cancel — uses `payments_owner_cancel`, not admin) and `recordManualPayment.ts` (INSERT only) and owner `initiatePayment.ts` (service-role). If any *other* authenticated admin UPDATE appears, STOP and revise this task before dropping `payments_admin_update`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/162_payments_admin_rls_tighten.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 162: tighten payments admin RLS.
-- Before: payments_admin_insert had no row constraint; payments_admin_update
-- gated only on role (no WITH CHECK). A FINANCE_ADMIN's own JWT could write any
-- payment in any jurisdiction via direct PostgREST, bypassing the server-action
-- gates (can_confirm_payment, assertAdminCanActOn).
-- After: all admin UPDATEs go through the service-role client (no authenticated
-- UPDATE path remains), so payments_admin_update is dropped. The one remaining
-- authenticated-admin writer (recordManualPayment) only INSERTs INITIATED /
-- CONFIRMED rows, so payments_admin_insert is scoped to the admin's own
-- jurisdiction and to those two statuses.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS payments_admin_update ON public.payments;

DROP POLICY IF EXISTS payments_admin_insert ON public.payments;
CREATE POLICY payments_admin_insert ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.is_active = true
         AND p.role IN ('FINANCE_ADMIN', 'SUPERADMIN')
    )
    AND jurisdiction_id = ANY(public.current_jurisdiction_ids())
    AND status IN ('INITIATED', 'CONFIRMED')
  );

-- DOWN:
-- DROP POLICY payments_admin_insert ON public.payments;
-- CREATE POLICY payments_admin_insert ON public.payments FOR INSERT TO authenticated
--   WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
--     AND p.is_active = true AND p.role IN ('FINANCE_ADMIN','SUPERADMIN')));
-- CREATE POLICY payments_admin_update ON public.payments FOR UPDATE TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
--     AND p.is_active = true AND p.role IN ('FINANCE_ADMIN','SUPERADMIN')));
```

- [ ] **Step 3: Apply and verify legitimate + malicious paths**

Run: `npx supabase db reset` (or apply 162 to the scratch DB).
Verify (as a FINANCE_ADMIN JWT, not service-role, via PostgREST):
- INSERT a payment with `status='CONFIRMED'` in the admin's own jurisdiction → allowed (recordManualPayment still works).
- INSERT with `jurisdiction_id` of another jurisdiction → rejected by RLS.
- INSERT with `status='PAID'` (out of allowed set) → rejected.
- `PATCH` any existing payment → rejected (no admin update policy).
Expected: all four as described.

- [ ] **Step 4: Smoke-test the app confirm path still works**

`recordManualPayment` and `confirmPayment` must still function (confirmPayment uses service-role → unaffected by the dropped authenticated UPDATE policy). Run the relevant tests:
Run: `npm --prefix frontend test -- src/actions/confirmPayment.test.ts src/actions/recordManualPayment.test.ts`
Expected: PASS (these mock the DB client; they verify logic, and the RLS change doesn't alter their code path).

---

### Task 3: Upgrade Next.js to a patched release (critical CVE)

**Why:** `next@16.1.6` is affected by a critical advisory (unauthenticated RCE incl. Image-Optimization AVIF). `npm audit` reports the fix at `16.3.5`, which also clears the correlated `postcss`/`sharp` highs.

**Files:**
- Modify: `frontend/package.json` (the `next` dependency), `frontend/package-lock.json`

- [ ] **Step 1: Record the current audit baseline**

Run: `npm --prefix frontend audit --omit=dev` (note the `next` critical is present).

- [ ] **Step 2: Upgrade**

Run: `npm --prefix frontend install next@16.3.5`

- [ ] **Step 3: Verify the advisory is cleared**

Run: `npm --prefix frontend audit --omit=dev`
Expected: no critical/high for `next` (and `postcss`/`sharp` highs tied to next resolved).

- [ ] **Step 4: Verify the build**

Run: `npm --prefix frontend run build`
Expected: build succeeds. If a breaking change surfaces, consult the Next.js 16.1→16.3 upgrade notes (minor; unlikely) and fix inline.

- [ ] **Step 5: Run the test suite**

Run: `npm --prefix frontend test`
Expected: green (or no *new* failures vs. the pre-upgrade baseline — note any pre-existing flaky test, e.g. `AdminWalletsPanel`, separately).

---

### Task 4: Remove the unauthenticated `ais/poll` endpoint

**Why:** `GET /api/ais/poll` has no auth, no rate limit, no env gate — its own `GET()` takes no request object, so it cannot even read an auth header. Anonymous callers hold a serverless function open ~15s per call and burn the paid `AISSTREAM_API_KEY`. The route is self-described dev-only; the Go ingester is canonical. Verified: no code references it.

**Files:**
- Delete: `frontend/src/app/api/ais/poll/route.ts` (and the now-empty `frontend/src/app/api/ais/poll/` directory)

- [ ] **Step 1: Re-confirm nothing references it**

Run: `grep -rn "ais/poll" frontend/src --include=*.ts --include=*.tsx | grep -v "app/api/ais/poll/route.ts"`
Expected: no matches.

- [ ] **Step 2: Delete the route**

Run: `rm frontend/src/app/api/ais/poll/route.ts && rmdir frontend/src/app/api/ais/poll 2>/dev/null; true`

- [ ] **Step 3: Verify build + typecheck**

Run: `npm --prefix frontend run build`
Expected: build succeeds; the route no longer exists.

---

### Task 5: Add size/MIME limits to the `shipowner-kyc` bucket

**Why:** The `shipowner-kyc` bucket is created with no `file_size_limit` and no `allowed_mime_types`, and grants `anon` INSERT to `pending/*`. With the public anon key, anyone can POST unlimited arbitrary files straight to Supabase Storage, bypassing the app's reCAPTCHA/rate-limit (cost/quota DoS + unvalidated content). The sibling `payment-proofs` bucket (mig 059) does this correctly.

**Files:**
- Create: `supabase/migrations/163_kyc_bucket_limits.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/163_kyc_bucket_limits.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 163: constrain the shipowner-kyc bucket (mig 055 created it with no
-- size/MIME limits). Mirrors payment-proofs (mig 059): 10 MB cap + MIME allowlist.
-- Closes the anonymous unbounded-upload vector on the anon 'pending/*' policy.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE storage.buckets
   SET file_size_limit    = 10485760,  -- 10 MB, same as payment-proofs
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 WHERE id = 'shipowner-kyc';

-- DOWN:
-- UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
--  WHERE id = 'shipowner-kyc';
```

- [ ] **Step 2: Apply and verify the limits are set**

Run: `npx supabase db reset` (or apply 163 to the scratch DB), then
`psql "$DB" -c "SELECT id, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='shipowner-kyc';"`
Expected: `file_size_limit = 10485760`, `allowed_mime_types = {image/jpeg,image/png,image/webp,application/pdf}`.

- [ ] **Step 3: Verify an oversized / wrong-type upload is rejected**

Attempt an anon upload of a `text/html` file (or >10 MB) to `shipowner-kyc/pending/x` via the Storage REST API.
Expected: rejected by the bucket constraint (413 / mime error). A valid small PDF still succeeds (air-operator registration unbroken).

---

### Task 6: Rate-limit + validate the public forms (`partnership-request`, `simulator/estimate`)

**Why:** `POST /api/partnership-request` sends an email to an attacker-supplied address with no rate limit (mail-relay abuse). `POST /api/simulator/estimate` has no rate limit and no Zod validation — a malformed body throws at `body.vesselCategory.replace(...)` outside the try block (crash). Both mirror the existing `enforceRateLimit(key, getClientId(...))` pattern already used by the invoice-download and signup routes.

**Files:**
- Modify: `frontend/src/lib/rateLimit.ts:16-36` (add two `LimiterKey`s + `LIMITS` buckets)
- Modify: `frontend/src/app/api/partnership-request/route.ts` (add rate-limit gate)
- Modify: `frontend/src/app/api/simulator/estimate/route.ts` (add Zod schema + rate-limit gate)
- Test: `frontend/src/app/api/partnership-request/route.test.ts` (new)

**Interfaces:**
- Consumes: `enforceRateLimit`, `getClientId` from `@/lib/rateLimit`.
- Produces: two new limiter keys `'partnership'` and `'simulator-estimate'`.

- [ ] **Step 1: Add the limiter keys and buckets**

In `frontend/src/lib/rateLimit.ts`, add to the `LimiterKey` union (after `'login-link'`):

```ts
    | 'partnership'
    | 'simulator-estimate';
```

And to the `LIMITS` record (after the `'login-link'` entry):

```ts
    // Public partnership form → triggers an email to an attacker-supplied
    // address. Same double-cap shape as the signup paths.
    partnership: { perMinute: 3, perHour: 10, perDay: 20 },

    // Public simulator PDF generation — cheap (jsPDF), but unauthenticated and
    // unbounded otherwise. Generous for a human, hard on scripted abuse.
    'simulator-estimate': { perMinute: 10, perHour: 60 },
```

- [ ] **Step 2: Write the failing test for partnership-request**

Create `frontend/src/app/api/partnership-request/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const enforceRateLimit = vi.fn(async () => ({ allowed: true as const }));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
    getClientId: () => '1.2.3.4',
}));
vi.mock('@/services/emailService', () => ({
    sendPartnershipConfirmationEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'x' }, error: null }) }) }) }),
    }),
}));

beforeEach(() => { enforceRateLimit.mockClear(); enforceRateLimit.mockResolvedValue({ allowed: true }); });

const body = {
    partnershipType: 'technology', orgName: 'Acme', country: 'DJ',
    contactName: 'Jane', contactEmail: 'jane@acme.test', message: 'Hello there, partner.',
};
const req = (b: unknown) => new Request('http://t/api/partnership-request', {
    method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' },
});

describe('POST /api/partnership-request', () => {
    it('returns 429 when rate limited', async () => {
        enforceRateLimit.mockResolvedValue({ allowed: false, reason: 'rate_limited_per_minute' });
        const { POST } = await import('./route');
        const res = await POST(req(body) as never);
        expect(res.status).toBe(429);
    });

    it('processes a valid request when under the limit', async () => {
        const { POST } = await import('./route');
        const res = await POST(req(body) as never);
        expect(res.status).toBe(200);
        expect(enforceRateLimit).toHaveBeenCalledWith('partnership', '1.2.3.4');
    });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm --prefix frontend test -- src/app/api/partnership-request/route.test.ts`
Expected: FAIL (route does not yet call `enforceRateLimit`; no 429 branch).

- [ ] **Step 4: Add the gate to partnership-request**

In `frontend/src/app/api/partnership-request/route.ts`, add the import at the top:

```ts
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
```

And at the very start of the `try` block (before `const body = await request.json();`):

```ts
        const rate = await enforceRateLimit('partnership', getClientId(request.headers));
        if (!rate.allowed) {
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm --prefix frontend test -- src/app/api/partnership-request/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Add Zod validation + rate-limit to simulator/estimate**

In `frontend/src/app/api/simulator/estimate/route.ts`, add imports:

```ts
import { z } from 'zod';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
```

Replace the `SimulatorEstimateInput` interface with a Zod schema + inferred type:

```ts
const estimateSchema = z.object({
    vesselCategory: z.string().min(1).max(60),
    fuelType: z.string().min(1).max(60),
    enginePowerKw: z.number().finite().nonnegative(),
    grossTonnage: z.number().finite().nonnegative(),
    speedKnots: z.number().finite().nonnegative(),
    eezDistanceNm: z.number().finite().nonnegative(),
    portStayHours: z.number().finite().nonnegative(),
    eezEmissionsTco2: z.number().finite().nonnegative(),
    portEmissionsTco2: z.number().finite().nonnegative(),
    totalCo2Tons: z.number().finite().nonnegative(),
    eezTaxUsd: z.number().finite().nonnegative(),
    portTaxUsd: z.number().finite().nonnegative(),
    totalTaxUsd: z.number().finite().nonnegative(),
    eezRate: z.number().finite().nonnegative(),
    portRate: z.number().finite().nonnegative(),
    effectiveRate: z.number().finite().nonnegative(),
    riskLevel: z.enum(['low', 'medium', 'high']),
}).strict();
type SimulatorEstimateInput = z.infer<typeof estimateSchema>;
```

Replace the body-parsing block (the `let body`, the `try { body = await request.json() }`, and the `if (!body.totalTaxUsd ...)` check) with:

```ts
    const rate = await enforceRateLimit('simulator-estimate', getClientId(request.headers));
    if (!rate.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    let body: SimulatorEstimateInput;
    try {
        body = estimateSchema.parse(await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
```

The rest of the handler (`estimateRef`, `invoiceData`, PDF generation) is unchanged — `body.vesselCategory.replace(...)` is now guaranteed present, so the out-of-try crash is gone.

- [ ] **Step 7: Run the full public-forms + lint check**

Run: `npm --prefix frontend run lint && npm --prefix frontend test -- src/app/api/partnership-request/route.test.ts`
Expected: lint clean, tests green. (`simulator/estimate` has no unit test in the repo; the Zod schema + rate-limit are verified by build/typecheck and the crash path is now guarded.)

---

## Self-Review

**Spec coverage:** P1 items 1.1 (Task 1), 1.2 (Task 2), 1.3 (Task 3), 1.4 (Task 4); P2 items 2.3 (Task 5), 2.4 (Task 6). NOT in this plan (by design): P0 credential rotation (manual/operator), 2.1 AAL2-at-`/api` gate, 2.2 arrival-alert scoping, 2.5 search_path pins, all P3 defense-in-depth. These remain in the review's plan for a follow-up batch.

**Placeholder scan:** none — every step carries real SQL/TS.

**Type consistency:** `apply_wallet_credit` param names (`p_txn_id`, `p_shipowner_id`, `p_actor_user_id`, `p_amount_minor`) are identical in the migration, the service `.rpc()` call, and the test mock. `ApplyWalletCreditResult { walletId, paymentId }` is preserved. Limiter keys `'partnership'` / `'simulator-estimate'` match between `rateLimit.ts`, the route calls, and the test assertion.

## Notes for the executor

- Do NOT commit or push. Leave changes in the working tree; the repo owner commits (author `Loïc Leclerc <leclerc@drwintech.com>`, explicit staging, no AI attribution).
- Tasks are independent; order 3 → 4 (quick wins) then 1 → 2 (money rail, highest care) then 5 → 6 is reasonable, but any order works.
- Tasks 1, 2, 5 need a database to verify against (`supabase db reset` locally, or a throwaway Postgres with the referenced migrations). If no DB is available, apply the code/SQL and flag the DB-verification steps as pending for the owner.
