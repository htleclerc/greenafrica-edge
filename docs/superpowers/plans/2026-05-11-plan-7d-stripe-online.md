# Plan 7D — Stripe Online (TEST mode build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the STRIPE rail to the v7 payment flow built across Plans 7C-1 through 7C-5. Owners can pick "Pay with card" in `<PayDialog>`, get redirected to Stripe Checkout (hosted), and the system auto-confirms via webhook. Build entirely in **Stripe TEST mode** — `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` live as TEST credentials in `.env.local` + Vercel preview; LIVE cutover is a separate ops step gated on UK entity confirmation.

**Architecture:** Stripe Node SDK + dedicated webhook route + Vercel Cron reconcile. New `stripeService.ts` wraps SDK calls (create Checkout session, retrieve PaymentIntent, verify webhook signature). The existing Plan 7C-1 `initiatePayment` action grows a STRIPE branch that creates a Checkout session and returns `checkout_url`. `<PayDialog>` Step 3 (Plan 7C-2) redirects to that URL for the STRIPE rail. Dedicated `/api/webhooks/stripe/route.ts` handles `payment_intent.succeeded` / `payment_intent.payment_failed` / `checkout.session.expired`, verifies HMAC, and flips the row to CONFIRMED/REJECTED — receipt + email auto-fire via the Plan 7C-4 hook. Vercel Cron `/api/cron/stripe-reconcile-pending` runs every 15 min as a safety net.

**Tech Stack:** PostgreSQL 17 / Supabase / Next.js 16 server actions / `stripe` npm SDK / Vercel Cron / TypeScript strict / Vitest / next-intl. Reuses Plan 7C-1 (`initiatePayment`, `confirmPayment` hook), Plan 7C-2 (`<PayDialog>` + `selectProvidersForRail`), Plan 7C-4 (receipt + email auto-gen).

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §7.2 (STRIPE rail flow), §3.3 (rail_details schema), §7.4 (multi-currency + `STRIPE_SETTLE` fx_rate_source).

**Predecessor:** Plans 7C-1 through 7C-5 — ALL MERGED on develop (tip `3789de0`). The v7 path is the only payment path; the legacy v0 intent flow is gone.

**Successor:** Plan 7G (Refunds) — will add `charge.refunded` webhook handling + `stripe.refunds.create` admin action. Plan 7H — final E2E + canary deploy.

**Out of scope:**
- LIVE Stripe credentials in production — gated on UK entity confirmation (separate ops step, not code)
- Refund flow (`charge.refunded` / `stripe.refunds.create`) — Plan 7G
- Apple/Google Pay UI toggles — Stripe Checkout enables natively, no client work
- 3DS / SCA — Stripe Checkout handles natively
- Subscriptions / recurring billing — N/A for carbon tax (one-shot pro-forma payments)
- Admin UI for rotating webhook secret — defer to a P2 v1.1 sweep; for v1 the env var is the source of truth
- Customer.created webhook (Stripe Customers API) — we don't persist Stripe customer IDs for v1 (one-shot Checkout per payment)

---

## File Structure

### Files to create

```
supabase/migrations/
└── 063_stripe_indices.sql                        # partial idx on external_reference WHERE rail=STRIPE

supabase/tests/migrations/
└── 063_stripe_indices.test.sql

frontend/src/services/
├── stripeService.ts                              # SDK wrappers: createCheckoutSession, retrievePI, verifyWebhookSig
└── stripeService.test.ts

frontend/src/app/api/webhooks/stripe/
└── route.ts                                      # dedicated Stripe webhook handler

frontend/src/app/api/cron/stripe-reconcile-pending/
└── route.ts                                      # Vercel Cron reconcile endpoint

frontend/vercel.json                              # cron schedule (or extend existing if present)
```

### Files to modify

```
frontend/package.json                              # add `stripe` dep
frontend/package-lock.json                         # generated
frontend/.env.example                              # STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + CRON_SECRET placeholders
frontend/src/actions/initiatePayment.ts            # +STRIPE branch (creates Checkout session, returns checkout_url)
frontend/src/actions/initiatePayment.test.ts       # +2 STRIPE branch tests
frontend/src/components/owner/PayDialog/StepConfirm.tsx   # redirect on STRIPE result.checkout_url
frontend/src/app/api/webhooks/payment/route.ts     # drop the Stripe placeholder branch (lines 62-66)
frontend/messages/en.json                          # OwnerPortal.payDialog.rail.stripe.* keys
frontend/messages/fr.json
```

### Test runners

```bash
# Postgres migration test
./supabase/tests/run.sh migrations/063_stripe_indices.test.sql

# Frontend Vitest (single file)
cd frontend && npx vitest run src/services/stripeService.test.ts

# Webhook signature verification (manual smoke)
stripe trigger payment_intent.succeeded --add payment_intent:metadata.payment_id=<test-uuid>

# Full gates
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

---

## Task 1: Stripe SDK install + env example

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (generated)
- Modify: `frontend/.env.example`

- [ ] **Step 1: Install Stripe SDK**

```bash
cd frontend && npm install stripe --save
```

This adds `"stripe": "^X.Y.Z"` (use whatever version `npm install` picks — pin via lockfile). The SDK is server-only — never imported into a `'use client'` component.

- [ ] **Step 2: Add env placeholders**

Edit `frontend/.env.example` and add (alongside the existing OPENEXCHANGE_RATES_API_KEY etc.):

```
# Stripe — TEST mode in dev/preview, LIVE in production (gated by UK entity confirmation)
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PUBLISHABLE_KEY=pk_test_…              # not strictly required (hosted Checkout), but useful for debug

# Vercel Cron auth
CRON_SECRET=…                                  # random hex; same value in Vercel env + vercel.json header check
```

- [ ] **Step 3: Verify build**

```bash
cd frontend && npx tsc --noEmit
```

Must remain clean — adding a dep should not break types.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/.env.example
git -c commit.gpgsign=false commit -m "feat(7d): install Stripe Node SDK + env placeholders

Adds 'stripe' to dependencies. Env placeholders for STRIPE_SECRET_KEY,
STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY (TEST mode in dev/preview),
plus CRON_SECRET for the Vercel-Cron reconcile endpoint.

LIVE credentials are a manual cutover step gated on UK entity
confirmation — not in scope for this plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Mig 063 — partial index on `external_reference` for STRIPE

**Files:**
- Create: `supabase/migrations/063_stripe_indices.sql`
- Create: `supabase/tests/migrations/063_stripe_indices.test.sql`

The webhook handler looks up payments by `external_reference = stripe_payment_intent_id`. A partial index keeps that lookup O(log n) without bloating the index for non-Stripe rails.

- [ ] **Step 1: Write failing pg test**

Create `supabase/tests/migrations/063_stripe_indices.test.sql`:

```sql
BEGIN;

-- 1. Partial index exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_stripe_pi';
  ASSERT n = 1, format('expected idx_payments_stripe_pi, found %s', n);
END $$;

-- 2. Index has the WHERE clause restricting to rail='STRIPE'
DO $$
DECLARE def TEXT;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_stripe_pi';
  ASSERT def LIKE '%WHERE %rail%STRIPE%', format('expected partial index restricted to rail=STRIPE, got: %s', def);
END $$;

-- 3. Inserting two STRIPE payments with the same external_reference is rejected? No — index is non-unique.
--    The UNIQUE constraint would belong on rail_details.stripe_payment_intent_id semantics; for v1 we trust
--    Stripe's PI IDs and skip the DB uniqueness. The webhook handler is idempotent on its own.

ROLLBACK;
```

- [ ] **Step 2: Run test → FAIL** (no Docker — DEFERRED if engine broken)

```bash
./supabase/tests/run.sh migrations/063_stripe_indices.test.sql
```

If Docker is broken (continuing pattern from Plans 7C-2 / 7C-4 / 7C-5), commit and report DONE_WITH_CONCERNS.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/063_stripe_indices.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 063: Indices supporting the STRIPE rail (Plan 7D)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The Stripe webhook handler looks up the corresponding payments row by
-- external_reference (= stripe_payment_intent_id). A partial index keeps
-- the lookup fast without bloating the index for non-Stripe rails.

CREATE INDEX IF NOT EXISTS idx_payments_stripe_pi
    ON public.payments (external_reference)
    WHERE rail = 'STRIPE' AND external_reference IS NOT NULL;

COMMENT ON INDEX public.idx_payments_stripe_pi IS
    'Plan 7D: fast webhook lookup by stripe_payment_intent_id. Partial: only Stripe payments.';
```

- [ ] **Step 4: Re-run test → PASS** (or DEFERRED)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/063_stripe_indices.sql \
        supabase/tests/migrations/063_stripe_indices.test.sql
git -c commit.gpgsign=false commit -m "feat(7d): mig 063 — partial index on external_reference for STRIPE

Speeds up Stripe webhook lookup (eq on external_reference WHERE rail=STRIPE).
Partial index keeps the rest of the payments table unaffected.

Test deferred if Docker broken (same blocker as migs 060/061/062).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `stripeService.ts` — SDK wrappers + tests

**Files:**
- Create: `frontend/src/services/stripeService.ts`
- Create: `frontend/src/services/stripeService.test.ts`

Three thin wrappers around the Stripe SDK so the rest of the codebase never imports `stripe` directly. This isolates the dependency for future migration/upgrade.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/services/stripeService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('stripe', () => {
    const mockSession = { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/cs_test_123', payment_intent: 'pi_test_123' };
    const mockEvent = { id: 'evt_test', type: 'payment_intent.succeeded', data: { object: { id: 'pi_test_123', status: 'succeeded' } } };
    return {
        default: vi.fn().mockImplementation(() => ({
            checkout: {
                sessions: {
                    create: vi.fn().mockResolvedValue(mockSession),
                    retrieve: vi.fn().mockResolvedValue(mockSession),
                },
            },
            paymentIntents: {
                retrieve: vi.fn().mockResolvedValue({ id: 'pi_test_123', status: 'succeeded', amount_received: 50000, currency: 'usd' }),
            },
            webhooks: {
                constructEvent: vi.fn().mockReturnValue(mockEvent),
            },
        })),
    };
});

import {
    createCheckoutSession,
    retrievePaymentIntent,
    verifyWebhookSignature,
} from './stripeService';

describe('createCheckoutSession', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('creates a Checkout session with the expected line item + metadata', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        const res = await createCheckoutSession({
            paymentId: 'pay-1',
            transactionId: 'tx-1',
            shipownerId: 'own-1',
            amountUsdMinor: 50000,
            currency: 'usd',
            invoiceRef: 'INV-2026-ABCD',
            successUrl: 'https://example.com/success',
            cancelUrl: 'https://example.com/cancel',
        });
        expect(res.checkoutUrl).toBe('https://checkout.stripe.com/c/cs_test_123');
        expect(res.stripePaymentIntentId).toBe('pi_test_123');
    });

    it('throws when STRIPE_SECRET_KEY is missing', async () => {
        const prev = process.env.STRIPE_SECRET_KEY;
        delete process.env.STRIPE_SECRET_KEY;
        await expect(createCheckoutSession({
            paymentId: 'pay-1', transactionId: 'tx-1', shipownerId: 'own-1',
            amountUsdMinor: 50000, currency: 'usd', invoiceRef: 'INV-1',
            successUrl: 'x', cancelUrl: 'y',
        })).rejects.toThrow(/STRIPE_SECRET_KEY/);
        if (prev) process.env.STRIPE_SECRET_KEY = prev;
    });
});

describe('retrievePaymentIntent', () => {
    it('returns the PaymentIntent from Stripe', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        const pi = await retrievePaymentIntent('pi_test_123');
        expect(pi.id).toBe('pi_test_123');
        expect(pi.status).toBe('succeeded');
    });
});

describe('verifyWebhookSignature', () => {
    it('returns the verified event when signature is valid', () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
        const evt = verifyWebhookSignature('raw-body', 'sig-header');
        expect(evt.type).toBe('payment_intent.succeeded');
    });

    it('throws when STRIPE_WEBHOOK_SECRET is missing', () => {
        const prev = process.env.STRIPE_WEBHOOK_SECRET;
        delete process.env.STRIPE_WEBHOOK_SECRET;
        expect(() => verifyWebhookSignature('raw-body', 'sig-header'))
            .toThrow(/STRIPE_WEBHOOK_SECRET/);
        if (prev) process.env.STRIPE_WEBHOOK_SECRET = prev;
    });
});
```

- [ ] **Step 2: Run → fail**

```bash
cd frontend && npx vitest run src/services/stripeService.test.ts
```

Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement**

Create `frontend/src/services/stripeService.ts`:

```typescript
import Stripe from 'stripe';

/**
 * Lazy-construct the Stripe client so a missing env var fails at the call
 * site (with a clear message) rather than at module load.
 */
function stripeClient(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    // Pin API version explicitly so SDK upgrades don't silently change semantics
    return new Stripe(key, { apiVersion: '2024-11-20.acacia' });
}

export interface CreateCheckoutSessionInput {
    paymentId: string;        // our payments.id (used in metadata for reconciliation)
    transactionId: string;    // our transactions.id
    shipownerId: string;
    amountUsdMinor: number;   // amount in cents
    currency: string;         // ISO 4217 lowercase ('usd', 'eur', ...)
    invoiceRef: string;       // human-readable label for the Checkout page
    successUrl: string;
    cancelUrl: string;
}

export interface CheckoutSessionResult {
    checkoutUrl: string;
    stripePaymentIntentId: string;
    stripeSessionId: string;
}

/**
 * Create a Stripe Checkout Session for the carbon tax payment.
 * Returns the URL the owner should be redirected to + the PaymentIntent ID
 * (stored as payments.external_reference for webhook lookup).
 */
export async function createCheckoutSession(
    input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
            quantity: 1,
            price_data: {
                currency: input.currency,
                unit_amount: input.amountUsdMinor,
                product_data: {
                    name: `AfricGreen Carbon Tax — ${input.invoiceRef}`,
                    description: 'Pro-forma settlement for vessel emissions tax',
                },
            },
        }],
        client_reference_id: input.paymentId,
        metadata: {
            payment_id: input.paymentId,
            transaction_id: input.transactionId,
            shipowner_id: input.shipownerId,
            invoice_ref: input.invoiceRef,
        },
        payment_intent_data: {
            metadata: {
                payment_id: input.paymentId,
                transaction_id: input.transactionId,
                shipowner_id: input.shipownerId,
                invoice_ref: input.invoiceRef,
            },
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
    });

    if (!session.url) throw new Error('Stripe Checkout session has no URL');
    const piId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!piId) throw new Error('Stripe Checkout session has no PaymentIntent ID');

    return {
        checkoutUrl: session.url,
        stripePaymentIntentId: piId,
        stripeSessionId: session.id,
    };
}

/**
 * Retrieve a Stripe PaymentIntent by ID — used by the cron reconciler.
 */
export async function retrievePaymentIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    const stripe = stripeClient();
    return stripe.paymentIntents.retrieve(paymentIntentId);
}

/**
 * Verify a Stripe webhook signature and return the parsed event.
 * `rawBody` must be the unparsed request body bytes (string).
 * Throws if the signature is invalid or the secret is missing.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    const stripe = stripeClient();
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
```

- [ ] **Step 4: Run → pass** (5/5)

```bash
cd frontend && npx vitest run src/services/stripeService.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/stripeService.ts \
        frontend/src/services/stripeService.test.ts
git -c commit.gpgsign=false commit -m "feat(7d): stripeService — Checkout + PI retrieve + webhook verify

3 thin SDK wrappers:
- createCheckoutSession(input) → returns checkout URL + PI ID
- retrievePaymentIntent(id) → for cron reconcile
- verifyWebhookSignature(rawBody, sig) → throws on bad sig

Lazy Stripe client construction so missing STRIPE_SECRET_KEY fails at
the call site, not at module load. API version pinned explicitly to
2024-11-20.acacia.

5 unit tests cover happy paths + missing-env-var failures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extend `initiatePayment` action — STRIPE branch

**Files:**
- Modify: `frontend/src/actions/initiatePayment.ts`
- Modify: `frontend/src/actions/initiatePayment.test.ts`

The existing action (Plan 7C-1) inserts a row in `INITIATED` status for the owner rails (WIRE/MOBILE_MONEY/THIRD_PARTY/WALLET). For STRIPE: also create a Checkout session, store its PI ID as `external_reference`, and the status goes straight to **PROCESSING** (skipping INITIATED — there's nothing pending owner action; Stripe has the next step). The return value gains a `checkoutUrl` field for the client to redirect to.

- [ ] **Step 1: Read the existing action**

```bash
cat frontend/src/actions/initiatePayment.ts | head -80
```

Note the existing `OWNER_RAILS` constant and the INSERT row shape.

- [ ] **Step 2: Write the failing tests**

Append to `frontend/src/actions/initiatePayment.test.ts` (after existing tests):

```typescript
vi.mock('@/services/stripeService', () => ({
    createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/c/cs_test_123',
        stripePaymentIntentId: 'pi_test_123',
        stripeSessionId: 'cs_test_123',
    }),
}));

describe('initiatePayment — STRIPE rail', () => {
    it('creates Checkout session, inserts PROCESSING, returns checkoutUrl', async () => {
        // ...reuse the existing test's setup (requireOwner mock, fake supabase client)...
        const result = await initiatePayment({
            transactionId: '123e4567-e89b-42d3-a456-426614174000',
            amount: '100.00',
            currency: 'USD',
            rail: 'STRIPE',
            railDetails: {},
        });

        const { createCheckoutSession } = await import('@/services/stripeService');
        expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
            amountUsdMinor: 10000,
            currency: 'usd',
        }));
        expect(result).toEqual(expect.objectContaining({
            status: 'PROCESSING',
            checkoutUrl: 'https://checkout.stripe.com/c/cs_test_123',
        }));
        // Insert row should have external_reference=pi_test_123
        const insertCall = /* extract from your fake client's recorded calls */;
        expect(insertCall.external_reference).toBe('pi_test_123');
        expect(insertCall.status).toBe('PROCESSING');
        expect(insertCall.rail_details).toMatchObject({ stripe_session_id: 'cs_test_123' });
    });

    it('throws if Stripe SDK throws', async () => {
        const { createCheckoutSession } = await import('@/services/stripeService');
        (createCheckoutSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Stripe API error'));
        await expect(initiatePayment({
            transactionId: '123e4567-e89b-42d3-a456-426614174000',
            amount: '100.00', currency: 'USD', rail: 'STRIPE', railDetails: {},
        })).rejects.toThrow(/Stripe API error/);
    });
});
```

(The "extract from your fake client's recorded calls" comment means: use whatever pattern the existing `initiatePayment.test.ts` already uses to inspect the `insert(...)` call argument. Mirror that.)

- [ ] **Step 3: Implement the STRIPE branch**

Edit `frontend/src/actions/initiatePayment.ts`:

1. Add `'STRIPE'` to the `OWNER_RAILS` const:
   ```typescript
   const OWNER_RAILS = ['STRIPE', 'WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
   ```
2. Import `createCheckoutSession` from `@/services/stripeService`.
3. After the existing INSERT logic for non-STRIPE rails, branch on `parsed.rail === 'STRIPE'`. For STRIPE, the flow is:
   - Lock FX rate via `lockRate` (existing) for the amount conversion (only if currency !== USD)
   - Compute `amountUsdMinor` (existing logic)
   - Call `createCheckoutSession({ ...session inputs... })`. Use `appBaseUrl + '/owner/invoices?stripe=success'` and `?stripe=cancel` for success/cancel URLs.
   - INSERT row with `status='PROCESSING'`, `external_reference=stripePaymentIntentId`, `rail_details={ stripe_session_id, stripe_payment_intent_id }`
   - Return the inserted row PLUS `{ checkoutUrl }`

Sketch (adapt to the actual action's structure):

```typescript
// After computing amountUsdMinor and the standard row object…

if (parsed.rail === 'STRIPE') {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3300';
    const session = await createCheckoutSession({
        paymentId: 'will-be-replaced',  // we don't yet have the row id — see below
        transactionId: parsed.transactionId ?? '',
        shipownerId: ctx.shipowner.id,
        amountUsdMinor,
        currency: parsed.currency.toLowerCase(),
        invoiceRef: parsed.transactionId ?? 'AfricGreen',
        successUrl: `${baseUrl}/owner/invoices?stripe=success`,
        cancelUrl:  `${baseUrl}/owner/invoices?stripe=cancel`,
    });

    const stripeRow = {
        ...rowCommon,
        rail: 'STRIPE' as const,
        status: 'PROCESSING' as const,
        external_reference: session.stripePaymentIntentId,
        rail_details: {
            stripe_session_id: session.stripeSessionId,
            stripe_payment_intent_id: session.stripePaymentIntentId,
        },
    };

    const { data, error } = await admin.from('payments').insert(stripeRow).select('id, status, transaction_id, amount_usd_minor').single();
    if (error) throw error;
    return { ...data, checkoutUrl: session.checkoutUrl };
}

// existing non-STRIPE INSERT path stays unchanged below
```

**Caveat** — the `paymentId` passed into `createCheckoutSession` is used only as Stripe metadata for cross-correlation. Since the payments row doesn't have an id yet (chicken-and-egg with the INSERT), we have two options:
- **(A) skip the metadata** and rely on `external_reference` for lookup (simpler — DO THIS for v1)
- (B) two-step: INSERT first with status=INITIATED, then create session passing the row id, then UPDATE to PROCESSING with the PI ID (cleaner but two writes)

Option A is simpler and sufficient because the webhook looks up by `external_reference = stripe_payment_intent_id` — no metadata needed. **Use Option A**. In `createCheckoutSession`, the `metadata.payment_id` becomes optional; pass an empty string or omit it. Update `stripeService.ts` accordingly if needed (the `metadata.payment_id` field already accepts any string).

- [ ] **Step 4: Run tests + tsc**

```bash
cd frontend && npx vitest run src/actions/initiatePayment.test.ts
cd frontend && npx tsc --noEmit
```

Both must pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/initiatePayment.ts \
        frontend/src/actions/initiatePayment.test.ts
git -c commit.gpgsign=false commit -m "feat(7d): initiatePayment — STRIPE rail creates Checkout session

Adds STRIPE to OWNER_RAILS. For rail=STRIPE the action:
1. Locks FX (same as other rails)
2. Calls stripeService.createCheckoutSession
3. INSERTs payments row with status=PROCESSING, external_reference=
   stripe_payment_intent_id, rail_details={stripe_session_id, stripe_payment_intent_id}
4. Returns {…rowFields, checkoutUrl} for client redirect

PROCESSING (skipping INITIATED) because the row is awaiting Stripe's
async webhook, not owner action.

+ 2 STRIPE-branch tests + Stripe SDK mock.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `<PayDialog>` Step 3 — redirect on STRIPE

**Files:**
- Modify: `frontend/src/components/owner/PayDialog/StepConfirm.tsx`

After `initiatePayment` returns, the existing flow calls `router.refresh()` and closes the dialog. For STRIPE the return value now includes `checkoutUrl` — redirect the browser there instead.

- [ ] **Step 1: Read the existing StepConfirm**

```bash
cat frontend/src/components/owner/PayDialog/StepConfirm.tsx | head -50
```

Find the section that handles the `initiatePayment` result.

- [ ] **Step 2: Add the STRIPE redirect branch**

Edit `StepConfirm.tsx` — in the success handler after `await initiatePayment(...)`:

```typescript
const result = await initiatePayment({
    transactionId: ctx.transactionId,
    amount: ctx.amount,
    currency: ctx.currency,
    rail: ctx.rail!,
    railDetails: ctx.railDetails,
});

// Plan 7D: STRIPE flow returns checkoutUrl — redirect the browser there.
// The webhook will flip the payment to CONFIRMED + generate receipt
// + email when the owner completes Checkout (or to CANCELLED via cron
// reconcile if they abandon).
if (ctx.rail === 'STRIPE' && 'checkoutUrl' in result && result.checkoutUrl) {
    window.location.href = result.checkoutUrl as string;
    return; // do NOT call onClose / router.refresh — page is about to unload
}

// Non-STRIPE: existing flow (close dialog + refresh)
onClose();
router.refresh();
```

- [ ] **Step 3: Type the return value**

If TypeScript complains that `result.checkoutUrl` is unknown, update the `initiatePayment` return type signature (in `initiatePayment.ts`) to be the union of the two shapes: `{ id, status, transaction_id, amount_usd_minor } | { id, status, transaction_id, amount_usd_minor, checkoutUrl }`. Then the conditional access in StepConfirm narrows correctly.

- [ ] **Step 4: tsc + next build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/owner/PayDialog/StepConfirm.tsx \
        frontend/src/actions/initiatePayment.ts
git -c commit.gpgsign=false commit -m "feat(7d): PayDialog redirects to Stripe Checkout on STRIPE rail

After initiatePayment returns, for ctx.rail==='STRIPE' the dialog
redirects window.location to the returned checkoutUrl instead of
calling router.refresh + onClose. The page unloads; the webhook +
Plan 7C-4 hook handle CONFIRMED + receipt + email when Stripe
confirms.

initiatePayment return type widened to a union so the checkoutUrl
field is type-safe at the call site.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `/api/webhooks/stripe/route.ts` — dedicated handler

**Files:**
- Create: `frontend/src/app/api/webhooks/stripe/route.ts`
- Create: `frontend/src/app/api/webhooks/stripe/route.test.ts`

The handler MUST:
1. Read the raw body (`req.text()`) before any JSON parse — Stripe signature is over the raw bytes.
2. Verify HMAC via `stripeService.verifyWebhookSignature`.
3. Dispatch on event type. For v1 we handle:
   - `payment_intent.succeeded` → UPDATE payments row to CONFIRMED + capture stripe_charge_id / payment_method_type / last4 into rail_details
   - `payment_intent.payment_failed` → UPDATE to REJECTED + reason
   - `checkout.session.expired` → UPDATE to CANCELLED (cleanup for abandoned Checkouts)
4. Be idempotent — if the row is already in a terminal state (CONFIRMED/REJECTED/REFUNDED), skip and return 200.
5. Trigger the Plan 7C-4 receipt + email hook by going through `confirmPayment` action (NOT a direct UPDATE) so the hook runs.

Actually — re-think point 5. The `confirmPayment` action from Plan 7C-1 requires a human admin to call it (`requireRole(ADMIN_ROLES)`). The webhook isn't an admin. Two options:
- **Option α**: webhook does a direct UPDATE + manually invokes `generatePaymentReceipt` + `sendPaymentConfirmationEmail` (mirrors what `confirmPayment` does). Duplicates the logic but keeps clear authority boundaries.
- **Option β**: refactor `confirmPayment` to accept a `system: true` flag that bypasses the admin gate — meant for webhooks. Cleaner but tightens coupling.

**Recommend Option α for v1.** Webhook = system actor, direct UPDATE, replicate the receipt+email hook inline. Future cleanup can DRY this up.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/app/api/webhooks/stripe/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/services/stripeService', () => ({
    verifyWebhookSignature: vi.fn(),
}));
vi.mock('@/services/receiptService', () => ({
    generatePaymentReceipt: vi.fn().mockResolvedValue({ receiptRef: 'RCT-2026-TEST', pdfBuffer: new Uint8Array() }),
}));
vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
}));
// Mock @supabase/supabase-js createClient to return a fake admin client...

// (Standard fake-supabase pattern — see paymentService.test.ts / confirmPayment.test.ts)

describe('POST /api/webhooks/stripe', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns 400 when signature header is missing', async () => {
        const req = new Request('http://x/api/webhooks/stripe', {
            method: 'POST',
            body: '{}',
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns 400 when signature verification throws', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('Invalid signature');
        });
        const req = new Request('http://x/api/webhooks/stripe', {
            method: 'POST',
            body: '{}',
            headers: { 'stripe-signature': 'bad-sig' },
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('on payment_intent.succeeded: UPDATEs row CONFIRMED + generates receipt + sends email', async () => {
        const { verifyWebhookSignature } = await import('@/services/stripeService');
        (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce({
            id: 'evt_1', type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_123', latest_charge: 'ch_456', amount_received: 50000, currency: 'usd', payment_method_types: ['card'] } },
        });
        // Mock supabase fake to return a matching payments row in PROCESSING status
        // (extracted from existing patterns)…
        // expect UPDATE called with status='CONFIRMED', confirmed_at set, etc.
        // expect generatePaymentReceipt called
        // expect sendPaymentConfirmationEmail called
        // expect res.status === 200
    });

    it('idempotent: already-CONFIRMED rows return 200 without re-processing', async () => {
        // …
    });

    it('on payment_intent.payment_failed: UPDATE row REJECTED', async () => { /* … */ });
    it('on checkout.session.expired: UPDATE row CANCELLED', async () => { /* … */ });
    it('on unhandled event type: log + return 200', async () => { /* … */ });
});
```

(The bodies are sketches — the executing subagent fills them in following the existing test patterns. Aim for 6 tests minimum.)

- [ ] **Step 2: Implement the route**

Create `frontend/src/app/api/webhooks/stripe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyWebhookSignature } from '@/services/stripeService';

export const runtime = 'nodejs'; // need raw body — Edge runtime is fine here too, but Node is fine
export const dynamic = 'force-dynamic';

const TERMINAL_STATUSES = new Set(['CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);

function serviceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key);
}

export async function POST(req: NextRequest) {
    const sig = req.headers.get('stripe-signature');
    if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

    let event: ReturnType<typeof verifyWebhookSignature>;
    const rawBody = await req.text();
    try {
        event = verifyWebhookSignature(rawBody, sig);
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'invalid signature' },
            { status: 400 },
        );
    }

    const admin = serviceClient();

    try {
        switch (event.type) {
            case 'payment_intent.succeeded': {
                await handlePaymentSucceeded(admin, event.data.object as Record<string, unknown>);
                break;
            }
            case 'payment_intent.payment_failed': {
                await handlePaymentFailed(admin, event.data.object as Record<string, unknown>);
                break;
            }
            case 'checkout.session.expired': {
                await handleCheckoutExpired(admin, event.data.object as Record<string, unknown>);
                break;
            }
            default:
                console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
        }
        return NextResponse.json({ received: true });
    } catch (e) {
        console.error(`[stripe-webhook] handler error for event ${event.id} (${event.type}):`, e);
        // 200 to acknowledge receipt — Stripe will not retry, but we logged.
        // Alternative: 500 to trigger retry. Choose 200 to avoid retry storms on persistent bugs.
        return NextResponse.json({ received: true, error: true });
    }
}

async function handlePaymentSucceeded(admin: ReturnType<typeof serviceClient>, pi: Record<string, unknown>) {
    const piId = pi.id as string;
    const { data: payment, error: findErr } = await admin
        .from('payments')
        .select('id, status, transaction_id, shipowner_id, amount_usd_minor, currency, rail_details')
        .eq('external_reference', piId)
        .eq('rail', 'STRIPE')
        .maybeSingle();
    if (findErr) throw findErr;
    if (!payment) {
        console.warn(`[stripe-webhook] no payments row for PI ${piId}`);
        return;
    }
    if (TERMINAL_STATUSES.has(payment.status as string)) {
        console.log(`[stripe-webhook] PI ${piId} already in terminal state ${payment.status} — idempotent skip`);
        return;
    }

    const chargeId = pi.latest_charge as string | null;
    const paymentMethodTypes = pi.payment_method_types as string[] | undefined;
    const merged_rail_details = {
        ...(payment.rail_details as Record<string, unknown>),
        stripe_charge_id: chargeId,
        payment_method_type: paymentMethodTypes?.[0] ?? null,
        fx_rate_source: 'STRIPE_SETTLE',
    };

    const { error: updErr } = await admin
        .from('payments')
        .update({
            status: 'CONFIRMED',
            confirmed_at: new Date().toISOString(),
            // confirmed_by: NULL for system actor — DB allows NULL on this column
            rail_details: merged_rail_details,
        })
        .eq('id', payment.id);
    if (updErr) throw updErr;

    // Trigger recompute (Plan 7A trigger should fire on UPDATE, but call explicitly to be safe)
    await admin.rpc('recompute_transaction_status', { p_transaction_id: payment.transaction_id });

    // Receipt + email (replicates Plan 7C-4's confirmPayment hook for the webhook system actor)
    try {
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        const receipt = await generatePaymentReceipt(admin, payment.id as string);
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        const { data: owner } = await admin
            .from('shipowners')
            .select('name, official_email')
            .eq('id', payment.shipowner_id as string)
            .single();
        const { data: tx } = await admin
            .from('transactions')
            .select('invoice_ref, vessel_name')
            .eq('id', payment.transaction_id as string)
            .single();
        if (owner?.official_email && tx) {
            await sendPaymentConfirmationEmail({
                to: owner.official_email as string,
                recipientName: (owner.name as string) ?? 'Shipowner',
                vesselName: (tx.vessel_name as string) ?? '—',
                invoiceRef: (tx.invoice_ref as string) ?? '—',
                amountUsd: (payment.amount_usd_minor as number) / 100,
                paidAt: new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),
                receiptRef: receipt.receiptRef,
                receiptPdfBuffer: receipt.pdfBuffer,
            });
        }
    } catch (e) {
        console.error(`[stripe-webhook] receipt/email hook failed for ${payment.id}:`, e);
        // Fail-soft — payment is CONFIRMED; downstream can re-trigger
    }
}

async function handlePaymentFailed(admin: ReturnType<typeof serviceClient>, pi: Record<string, unknown>) {
    const piId = pi.id as string;
    const reason = (pi.last_payment_error as { message?: string } | undefined)?.message ?? 'unknown';

    const { data: payment } = await admin
        .from('payments')
        .select('id, status')
        .eq('external_reference', piId)
        .eq('rail', 'STRIPE')
        .maybeSingle();
    if (!payment) return;
    if (TERMINAL_STATUSES.has(payment.status as string)) return;

    await admin.from('payments').update({
        status: 'REJECTED',
        rejected_reason: `Stripe: ${reason}`,
    }).eq('id', payment.id);
}

async function handleCheckoutExpired(admin: ReturnType<typeof serviceClient>, session: Record<string, unknown>) {
    const piId = session.payment_intent as string;
    if (!piId) return;

    const { data: payment } = await admin
        .from('payments')
        .select('id, status')
        .eq('external_reference', piId)
        .eq('rail', 'STRIPE')
        .maybeSingle();
    if (!payment) return;
    if (TERMINAL_STATUSES.has(payment.status as string)) return;

    await admin.from('payments').update({ status: 'CANCELLED' }).eq('id', payment.id);
}
```

- [ ] **Step 3: Run tests + tsc**

```bash
cd frontend && npx vitest run src/app/api/webhooks/stripe/route.test.ts
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/webhooks/stripe/
git -c commit.gpgsign=false commit -m "feat(7d): /api/webhooks/stripe handles PI succeeded/failed/expired

Dedicated Stripe webhook route. Verifies HMAC via stripeService.
Handlers:
- payment_intent.succeeded → UPDATE CONFIRMED + capture
  stripe_charge_id + payment_method_type + fx_rate_source='STRIPE_SETTLE'
  + invoke receipt + email hook (replicates Plan 7C-4's confirmPayment
  flow for the webhook system actor)
- payment_intent.payment_failed → UPDATE REJECTED + reason
- checkout.session.expired → UPDATE CANCELLED

Idempotent on terminal states (CONFIRMED/REJECTED/CANCELLED/REFUNDED).
Fail-soft on receipt+email so a transient Resend outage doesn't lose
the CONFIRMED state.

6+ unit tests cover sig verification, idempotency, all 3 event types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Drop the legacy Stripe placeholder from `/api/webhooks/payment`

**Files:**
- Modify: `frontend/src/app/api/webhooks/payment/route.ts`

The legacy multi-provider webhook has an incomplete Stripe branch (lines 62-66, no proper signature verification). Now that we have a dedicated `/api/webhooks/stripe`, that branch is dead code.

- [ ] **Step 1: Read the file + identify the Stripe block**

```bash
cat frontend/src/app/api/webhooks/payment/route.ts | sed -n '30,80p'
```

- [ ] **Step 2: Remove the Stripe branch + the `stripeSig` capture**

Remove the `else if (stripeSig) { ... }` block. Keep the Paystack / Flutterwave / Payoneer branches.

Verify nothing else in the file references `stripe`/`stripeSig`/`provider = 'stripe'`.

- [ ] **Step 3: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/webhooks/payment/route.ts
git -c commit.gpgsign=false commit -m "refactor(7d): drop Stripe placeholder from legacy webhook dispatcher

Plan 7D ships /api/webhooks/stripe with proper signature verification
+ idempotency. The legacy /api/webhooks/payment multi-provider
dispatcher had a placeholder Stripe branch (no real sig verify) —
remove it. The other branches (Paystack/Flutterwave/Payoneer) stay
in the dispatcher for the legacy v0 path until those rails get their
own dedicated handlers (out of scope for v1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Vercel Cron — `/api/cron/stripe-reconcile-pending`

**Files:**
- Create: `frontend/src/app/api/cron/stripe-reconcile-pending/route.ts`
- Create: `frontend/vercel.json` (or modify if exists)
- Create: `frontend/src/app/api/cron/stripe-reconcile-pending/route.test.ts`

Safety net: every 15 min, query Stripe directly for PROCESSING payments older than 10 min. If Stripe says succeeded → flip CONFIRMED. If failed → REJECTED. If still pending after 60 min → CANCELLED (timeout).

- [ ] **Step 1: Create the route**

Create `frontend/src/app/api/cron/stripe-reconcile-pending/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { retrievePaymentIntent } from '@/services/stripeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 60 * 60 * 1000;   // 1 h — older than this, give up and cancel
const RECONCILE_THRESHOLD_MS = 10 * 60 * 1000; // older than 10 min, eligible for reconcile

function serviceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    return createClient(url, key);
}

export async function GET(req: NextRequest) {
    // Auth: Vercel Cron sends an Authorization: Bearer header with CRON_SECRET
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = serviceClient();
    const cutoff = new Date(Date.now() - RECONCILE_THRESHOLD_MS).toISOString();
    const timeoutCutoff = new Date(Date.now() - TIMEOUT_MS).toISOString();

    const { data: pending } = await admin
        .from('payments')
        .select('id, external_reference, created_at, transaction_id, shipowner_id, amount_usd_minor')
        .eq('rail', 'STRIPE')
        .eq('status', 'PROCESSING')
        .lt('created_at', cutoff)
        .limit(100);

    const results: { id: string; outcome: string }[] = [];

    for (const row of (pending ?? [])) {
        const piId = row.external_reference as string;
        if (!piId) continue;

        try {
            const pi = await retrievePaymentIntent(piId);
            // Stripe statuses we care about:
            // - 'succeeded'  → CONFIRMED
            // - 'canceled' / 'requires_payment_method' (post-failure) → REJECTED
            // - 'processing' / 'requires_action' → still pending; if past timeout, CANCELLED
            if (pi.status === 'succeeded') {
                // Same logic as webhook handler — but trimmed; the webhook is canonical
                await admin.from('payments').update({
                    status: 'CONFIRMED',
                    confirmed_at: new Date().toISOString(),
                }).eq('id', row.id);
                // NOTE: receipt + email NOT generated here — the webhook handler should have
                // fired. If it didn't, this is a degraded state; cron is the recovery, not the
                // primary. To trigger receipt+email here, dynamic-import and call them — but
                // be wary of double-emailing if the webhook arrives later.
                results.push({ id: row.id as string, outcome: 'CONFIRMED' });
            } else if (pi.status === 'canceled') {
                await admin.from('payments').update({
                    status: 'CANCELLED',
                }).eq('id', row.id);
                results.push({ id: row.id as string, outcome: 'CANCELLED' });
            } else if (new Date(row.created_at as string).getTime() < new Date(timeoutCutoff).getTime()) {
                // Still pending after 1h — give up
                await admin.from('payments').update({
                    status: 'CANCELLED',
                    rejected_reason: 'Timeout: Stripe Checkout not completed within 1h',
                }).eq('id', row.id);
                results.push({ id: row.id as string, outcome: 'CANCELLED_TIMEOUT' });
            } else {
                results.push({ id: row.id as string, outcome: 'STILL_PENDING' });
            }
        } catch (e) {
            console.error(`[stripe-reconcile] error for payment ${row.id} (PI ${piId}):`, e);
            results.push({ id: row.id as string, outcome: 'ERROR' });
        }
    }

    return NextResponse.json({ reconciled: results.length, results });
}
```

- [ ] **Step 2: Vercel cron config**

Create or modify `frontend/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/stripe-reconcile-pending",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

If `vercel.json` already exists, merge the `crons` array.

- [ ] **Step 3: Write a basic test**

Create `frontend/src/app/api/cron/stripe-reconcile-pending/route.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/services/stripeService', () => ({
    retrievePaymentIntent: vi.fn(),
}));

describe('GET /api/cron/stripe-reconcile-pending', () => {
    it('rejects requests without the correct CRON_SECRET', async () => {
        process.env.CRON_SECRET = 'topsecret';
        const req = new Request('http://x/api/cron/stripe-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer wrong-secret' },
        });
        const res = await GET(req);
        expect(res.status).toBe(401);
    });

    it('accepts a correctly authenticated request and returns reconcile result', async () => {
        process.env.CRON_SECRET = 'topsecret';
        // Mock the fake supabase to return an empty pending list…
        const req = new Request('http://x/api/cron/stripe-reconcile-pending', {
            method: 'GET',
            headers: { authorization: 'Bearer topsecret' },
        });
        // …expect 200 + { reconciled: 0, results: [] }
    });
});
```

- [ ] **Step 4: Run tests + build**

```bash
cd frontend && npx vitest run src/app/api/cron/stripe-reconcile-pending/route.test.ts
cd frontend && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/cron/stripe-reconcile-pending/ \
        frontend/vercel.json
git -c commit.gpgsign=false commit -m "feat(7d): Vercel Cron — Stripe reconcile-pending every 15 min

Safety net for missed webhooks. Queries PROCESSING Stripe payments
older than 10 min, retrieves the PaymentIntent from Stripe, and
reconciles:
- pi.status='succeeded'  → CONFIRMED
- pi.status='canceled'   → CANCELLED
- still pending after 1h → CANCELLED (timeout)

Auth: Authorization: Bearer \$CRON_SECRET. Vercel Cron schedules
the GET every 15 min.

NOTE: receipt + email NOT re-fired by cron (the webhook is canonical
and would have done it). Cron's job is to flip the status when the
webhook is missed; double-emailing is the worse failure mode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: i18n — STRIPE rail keys + cancel/success query handling

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`
- Modify: `frontend/src/app/owner/(portal)/invoices/page.tsx` (banner for `?stripe=success|cancel`)

The `<PayDialog>` already has rail-keyed i18n (Plan 7C-2: `OwnerPortal.payDialog.rail.{wire,momo,third,wallet}.{label,hint}`). Add `stripe.{label,hint}`. Also: the success/cancel URLs Stripe redirects back to are `/owner/invoices?stripe=success|cancel` — show a one-time banner.

- [ ] **Step 1: Add EN keys**

Edit `frontend/messages/en.json`. Inside `OwnerPortal.payDialog.rail`, add:

```json
"stripe": { "label": "Pay by card (Stripe)", "hint": "Instant — Visa, Mastercard, Apple Pay, Google Pay" }
```

Inside `OwnerPortal.payDialog.paramsHint`, add:

```json
"stripe": "You will be redirected to Stripe Checkout to enter your card details."
```

Inside `OwnerPortal.invoices` (new section), add a small banner namespace:

```json
"stripeReturn": {
    "success": "Payment received — receipt is on its way to your inbox.",
    "cancel": "Payment cancelled. Your invoice is still pending; you can try again anytime."
}
```

- [ ] **Step 2: Add FR keys**

Edit `frontend/messages/fr.json`:

```json
"stripe": { "label": "Payer par carte (Stripe)", "hint": "Instantané — Visa, Mastercard, Apple Pay, Google Pay" }
```

```json
"stripe": "Vous serez redirigé vers Stripe Checkout pour saisir votre carte."
```

```json
"stripeReturn": {
    "success": "Paiement reçu — le reçu vous parvient par e-mail.",
    "cancel": "Paiement annulé. Votre facture reste en attente ; vous pouvez réessayer."
}
```

- [ ] **Step 3: Update `StepRailPicker` rail meta**

Verify `frontend/src/components/owner/PayDialog/StepRailPicker.tsx` (Plan 7C-2) has a `RAIL_META` map keyed on rail enum. Add an entry for `STRIPE`:

```typescript
STRIPE: { icon: CreditCard, color: '#635BFF', key: 'stripe' },
```

(Import `CreditCard` from `lucide-react`.)

- [ ] **Step 4: Add success/cancel banner to `/owner/invoices/page.tsx`**

In `frontend/src/app/owner/(portal)/invoices/page.tsx`, server-component reads `searchParams.stripe`:

```typescript
export default async function OwnerInvoicesPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
    const params = await searchParams;
    const stripeReturn = params.stripe === 'success' ? 'success' : params.stripe === 'cancel' ? 'cancel' : null;
    // …existing logic…

    return (
        <div className="…">
            {stripeReturn === 'success' && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 mb-4 text-sm text-emerald-200">
                    {t('stripeReturn.success')}
                </div>
            )}
            {stripeReturn === 'cancel' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 mb-4 text-sm text-amber-200">
                    {t('stripeReturn.cancel')}
                </div>
            )}
            …
        </div>
    );
}
```

The `t` function: import `useTranslations` from `next-intl/server` (server-component version: `getTranslations`).

- [ ] **Step 5: Validate JSON + tsc + build**

```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/en.json'))" && echo EN ok
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/fr.json'))" && echo FR ok
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json \
        frontend/src/components/owner/PayDialog/StepRailPicker.tsx \
        frontend/src/app/owner/\(portal\)/invoices/page.tsx
git -c commit.gpgsign=false commit -m "feat(7d): i18n — STRIPE rail keys + post-Checkout banner

OwnerPortal.payDialog.rail.stripe + paramsHint.stripe added in EN+FR.
OwnerPortal.invoices.stripeReturn.{success,cancel} for the banner shown
when Stripe redirects back to /owner/invoices?stripe=success|cancel.

StepRailPicker RAIL_META gains the STRIPE entry (CreditCard icon).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Manual smoke test scripts + Stripe CLI prep

**Files:**
- Create: `docs/runbooks/stripe-smoke.md` (optional but useful)

Stripe provides a CLI for triggering webhook events during dev (`stripe trigger payment_intent.succeeded`). Document the dev flow so future devs / CI smoke checks have a reference.

- [ ] **Step 1: Create the runbook (optional but useful)**

Create `docs/runbooks/stripe-smoke.md`:

```markdown
# Stripe Smoke Test Runbook

## Prerequisites
- Stripe CLI installed: `stripe.dev/docs/stripe-cli`
- Logged in: `stripe login` (TEST mode account, NOT live)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` set in `.env.local`

## Local webhook tunnel
```bash
stripe listen --forward-to http://localhost:3300/api/webhooks/stripe
```
This prints the webhook secret to set as `STRIPE_WEBHOOK_SECRET` in `.env.local`.

## Trigger a successful payment
```bash
stripe trigger payment_intent.succeeded
```
Watch the dev server logs — should see `[stripe-webhook]` lines, no errors, and the corresponding payments row flips to CONFIRMED.

## Trigger a failed payment
```bash
stripe trigger payment_intent.payment_failed
```

## End-to-end TEST card flow
1. As owner, click Pay on a PROFORMA → pick STRIPE
2. Get redirected to Checkout
3. Use TEST card `4242 4242 4242 4242`, any future expiry, any CVC
4. After "Payment successful" → redirected to `/owner/invoices?stripe=success`
5. Success banner shows + receipt link appears within seconds (webhook → CONFIRMED → receipt hook)

## TEST cards
- `4242 4242 4242 4242` — successful Visa
- `4000 0000 0000 0341` — attaches but fails on charge attempt
- `4000 0027 6000 3184` — requires 3DS authentication
- `4000 0000 0000 9995` — insufficient funds

Full list: https://stripe.com/docs/testing#cards
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/stripe-smoke.md
git -c commit.gpgsign=false commit -m "docs(7d): Stripe smoke test runbook

Documents the local Stripe CLI tunnel + trigger commands + TEST card
list for end-to-end flow verification. Useful for future dev onboarding
and pre-merge smoke checks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final gates + acceptance

**Files:** None (verification only)

- [ ] **Step 1: All gates**

```bash
./supabase/tests/run.sh migrations/063_stripe_indices.test.sql  # DEFERRED if Docker broken
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

- [ ] **Step 2: Diff summary**

```bash
git diff develop..HEAD --shortstat
```

- [ ] **Step 3: No commit for this task** — verification gate only.

---

## Acceptance Criteria

- [ ] `stripe` npm package installed
- [ ] `.env.example` lists `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `CRON_SECRET`
- [ ] Mig 063 creates partial index `idx_payments_stripe_pi` on `external_reference WHERE rail='STRIPE'`
- [ ] `stripeService.ts` exports `createCheckoutSession`, `retrievePaymentIntent`, `verifyWebhookSignature`
- [ ] `initiatePayment` action accepts `rail='STRIPE'` and returns `{ ...row, checkoutUrl }`
- [ ] STRIPE payments are inserted with `status='PROCESSING'`, `external_reference=stripe_payment_intent_id`, `rail_details.stripe_session_id` populated
- [ ] `<PayDialog>` StepConfirm redirects to `checkoutUrl` for STRIPE rail (no router.refresh)
- [ ] `/api/webhooks/stripe` verifies HMAC and rejects unsigned requests with 400
- [ ] Webhook handler is idempotent — already-terminal payments don't get re-processed
- [ ] On `payment_intent.succeeded`: row → CONFIRMED, receipt generated, email sent (via Plan 7C-4 hook replication)
- [ ] On `payment_intent.payment_failed`: row → REJECTED with reason
- [ ] On `checkout.session.expired`: row → CANCELLED
- [ ] Legacy Stripe placeholder in `/api/webhooks/payment` removed
- [ ] `/api/cron/stripe-reconcile-pending` exists, gated by `CRON_SECRET`, schedules in `vercel.json`
- [ ] Cron reconciles PROCESSING payments > 10min old; cancels > 1h old
- [ ] i18n EN+FR complete: `OwnerPortal.payDialog.rail.stripe` + `paramsHint.stripe` + `OwnerPortal.invoices.stripeReturn.{success,cancel}`
- [ ] `<StepRailPicker>` RAIL_META has STRIPE entry
- [ ] `/owner/invoices` shows banner on `?stripe=success|cancel`
- [ ] All gates green: mig 063 pg test (or DEFERRED), tsc, vitest, next build
- [ ] No LIVE Stripe keys committed (TEST mode only)
- [ ] Documented Stripe smoke runbook for future devs

---

## Pre-merge checklist for the human

1. **TEST mode env vars set in Vercel preview** (NOT prod yet):
   - `STRIPE_SECRET_KEY=sk_test_…`
   - `STRIPE_WEBHOOK_SECRET=whsec_…` (from `stripe listen` or Stripe Dashboard webhook endpoint)
   - `STRIPE_PUBLISHABLE_KEY=pk_test_…`
   - `CRON_SECRET=<random-hex>`

2. **Stripe Dashboard webhook endpoint** registered for preview deploy:
   - URL: `https://<preview>.vercel.app/api/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.expired`

3. **Local smoke test** (`docs/runbooks/stripe-smoke.md`):
   - `stripe listen --forward-to http://localhost:3300/api/webhooks/stripe`
   - Owner pays a PROFORMA via STRIPE → Checkout → TEST card 4242… → success
   - Verify CONFIRMED + receipt + email arrive

4. **Hosted DB push**: `supabase db push --include-all` pushes 063 (and any still-deferred 060/061/062). Pre-diagnostic:
   ```sql
   SELECT 1 FROM pg_indexes WHERE indexname='idx_payments_stripe_pi';
   ```

5. **Docker pg tests backlog** — mig 060/061/062/063 all DEFERRED. Run as a batch when Docker is restored.

6. **LIVE cutover (separate ops step, NOT part of this PR)**:
   - UK entity registration confirmed
   - Stripe account switched to LIVE mode
   - Vercel **production** env vars: swap `sk_test_…` → `sk_live_…`, `pk_test_…` → `pk_live_…`, `whsec_…` from the LIVE Dashboard endpoint
   - Register the LIVE webhook endpoint at `https://greengate.africa/api/webhooks/stripe` (or whatever prod URL)
   - First real payment = canary; monitor closely

7. **Rollback plan**: revert the PR commits. Stripe Checkout sessions created before revert continue to work (Stripe is unaware of our revert); their webhook deliveries will hit a route that no longer exists → 404 → Stripe retries with exponential backoff → ops team has time to react. No data loss.

---

## Self-Review Notes

- **Spec coverage**: §7.2 STRIPE flow ✓, `rail_details` schema ✓, `fx_rate_source='STRIPE_SETTLE'` ✓, idempotency on terminal states ✓, cron safety net ✓, webhook secret in env ✓.
- **TEST mode discipline**: no LIVE keys committed; cutover documented as separate ops step.
- **Reuse**: receipt + email auto-fire path replicates Plan 7C-4's `confirmPayment` hook for the webhook system actor (Option α). Future cleanup could DRY this via a refactored `confirmPayment(systemActor: true)` flag.
- **Idempotency layered**: webhook handler checks terminal-status pre-update; cron's logic also respects already-terminal states.
- **Failure modes**:
  - Owner abandons Checkout → cron CANCELS after 1h
  - Webhook delivery delayed → cron catches it on next 15min run
  - Webhook signature fails → 400, Stripe retries
  - Receipt+email post-CONFIRMED fails → fail-soft logged, payment remains CONFIRMED, manual re-trigger possible
  - Stripe API outage → `initiatePayment` throws → owner sees error in `<PayDialog>`, no orphan rows (INSERT comes AFTER session.create succeeds)
- **No new hosted-DB indices needed beyond mig 063**.
- **No new RLS policies** — `payments` RLS from mig 058 already covers (owner-self-select + admin-all-select). Webhook uses service-role client which bypasses RLS.
