# Plan 7G — Refunds (multi-rail, admin-driven)

> **Phase G of Plan 7 (Shipowner Portal v1).** Closes the refund half of the financial loop. Plan 4 reconcile already creates `REFUND` transactions; this plan wires the admin arbitration workflow (rail choice, approval, execution) on top of the `refunds` table that Plan 7A shipped (mig 052).
>
> Master spec: [`specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §7.7 + §8.3.

---

## Cadrage (locked)

| Decision | Choice |
|---|---|
| Refund row INSERT hook | **A** — Postgres trigger (defensive; covers all REFUND transaction creators) |
| Stripe refund execution | **A** — synchronous `stripe.refunds.create()` from action + webhook `charge.refunded` as idempotent safety net |
| Approval gate per rail | **A** — WALLET = 1-click execute (combines approve + execute); WIRE / STRIPE = 2-step (REQUESTED → APPROVED → EXECUTED) |
| Owner UX | **A** — no new page; REFUND_ISSUED notification + REFUND row in existing `/owner/invoices` |
| Refund email | **A** — add `sendRefundIssuedEmail` + wire into notificationService switch |
| WIRE proof upload | **A** — optional; field on `rail_details.proof_storage_path` reuses Plan 7C-3 storage path |

---

## Out of scope

- New owner-facing `/owner/refunds` page (deferred — REFUND row in invoices + notification is enough for v1)
- Multi-currency refunds (refund always in USD minor like the rest of v7)
- Partial refunds on a single REFUND transaction (one refunds row per REFUND transaction; if a REFUND transaction needs to be split across rails, that's a manual admin adjustment via wallet ledger + free-text justification — out of scope here)
- Refund disputes / chargebacks (deferred to Plan 7H)

---

## Task list

1. **Mig 066** — auto-INSERT refunds trigger + drop `refund_rail` NOT NULL constraint
2. **`refundService.ts`** — typed reads (`listForAdmin`, `getById`, `listForOwner`)
3. **emailService** — `sendRefundIssuedEmail`
4. **notificationService** — wire `REFUND_ISSUED` switch case + add to `EMAIL_KINDS` (already in)
5. **`approveRefund` action** — REQUESTED → APPROVED (sets refund_rail + rail_details)
6. **`executeRefund` action** — APPROVED → EXECUTED with per-rail side effects + REFUND_ISSUED notif
7. **`rejectRefund` action** — REQUESTED|APPROVED → REJECTED
8. **Stripe webhook** — handle `charge.refunded` event (idempotent safety net)
9. **`/admin/refunds` page** — server gate + `<RefundsAdminPanel>` + `<RefundDetailDrawer>`
10. **Sidebar + RBAC matrix** — add `/admin/refunds` entry to `DashboardSidebar.tsx` + `NAV_PERMISSIONS`
11. **i18n EN+FR** — `AdminRefunds.*` namespace + REFUND_ISSUED kind body params
12. **Final gates** — tsc + vitest + next build + final code review

---

## Task 1 — Migration 066: auto-INSERT trigger + drop refund_rail NOT NULL

**File**: `supabase/migrations/066_refund_enqueue_trigger.sql`

### Rationale

Plan 4 reconcile already creates REFUND transactions in `transactions`. Today, nothing inserts the matching row into `public.refunds`. The trigger ensures every REFUND transaction gets an admin-arbitratable row, regardless of the code path that created the transaction.

Also: mig 052 declared `refunds.refund_rail` NOT NULL, but the spec workflow (`§7.7`) says the row is created with `refund_rail=NULL` and admin picks the rail at APPROVE-time. Plan 7G corrects this — drop NOT NULL on `refund_rail`.

### SQL

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 066: Auto-enqueue refunds on REFUND transaction creation +
-- relax refund_rail to nullable (admin picks rail at approve time per spec §7.7)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.refunds
  ALTER COLUMN refund_rail DROP NOT NULL;

-- Add a partial CHECK so non-REQUESTED rows still require a rail (defensive)
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_rail_required_after_request CHECK (
    status = 'REQUESTED' OR refund_rail IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.enqueue_refund_on_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Idempotency: skip if a refunds row already exists for this transaction
  IF EXISTS (SELECT 1 FROM public.refunds WHERE transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- shipowner_id required to insert; transactions without an owner stay in
  -- limbo (admin can hand-create a refund row via /admin/refunds if needed)
  IF NEW.shipowner_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.refunds (
    transaction_id,
    shipowner_id,
    amount_usd_minor,
    refund_rail,
    status
  ) VALUES (
    NEW.id,
    NEW.shipowner_id,
    -- transactions.tax_amount_usd is NUMERIC dollars (memory: gotchas).
    -- Refund is positive magnitude (mig 022 forbids negative); accounting
    -- direction is on breakdown_json.refundDirection.
    (NEW.tax_amount_usd * 100)::BIGINT,
    NULL,            -- admin sets at APPROVE time
    'REQUESTED'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refund_enqueue
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  WHEN (NEW.document_type = 'REFUND')
  EXECUTE FUNCTION public.enqueue_refund_on_transaction();

-- DOWN:
-- DROP TRIGGER trg_refund_enqueue ON public.transactions;
-- DROP FUNCTION public.enqueue_refund_on_transaction();
-- ALTER TABLE public.refunds DROP CONSTRAINT refunds_rail_required_after_request;
-- ALTER TABLE public.refunds ALTER COLUMN refund_rail SET NOT NULL;
```

### Tests — `supabase/tests/migrations/066_refund_enqueue_trigger.test.sql`

```sql
-- 1. Function and trigger exist
-- 2. INSERT REFUND transaction → refunds row appears (status=REQUESTED, refund_rail=NULL)
-- 3. INSERT non-REFUND transaction (PROFORMA/FINAL) → no refunds row
-- 4. INSERT REFUND for transaction with NULL shipowner_id → skipped, no row
-- 5. Re-INSERT (idempotency) via DELETE + re-fire: still only one refunds row per transaction
-- 6. UPDATE refunds.status='APPROVED' with refund_rail=NULL → fails refunds_rail_required_after_request
```

### Gates

- Test DEFERRED if Docker still broken (acknowledge — Plan 7E/7F precedent). Document in commit.
- Otherwise: `./supabase/tests/run.sh migrations/066_refund_enqueue_trigger.test.sql` green.

---

## Task 2 — `refundService.ts`

**File**: `frontend/src/services/refundService.ts`

### Exports

```ts
export interface RefundRow {
  id: string;
  transaction_id: string;
  shipowner_id: string;
  amount_usd_minor: number;
  refund_rail: PaymentRail | null;
  rail_details: Record<string, unknown>;
  status: 'REQUESTED' | 'APPROVED' | 'EXECUTED' | 'REJECTED';
  requested_by: string | null;
  approved_by: string | null;
  executed_by: string | null;
  executed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefundWithRefs extends RefundRow {
  transaction: {
    invoice_ref: string;
    vessel_name: string | null;
    document_type: string;
    tax_amount_usd: number;
  } | null;
  shipowner: {
    name: string;
    official_email: string | null;
  } | null;
}

export async function listRefundsForAdmin(
  client: SupabaseClient,
  filters: { status?: RefundRow['status']; offset?: number; limit?: number },
): Promise<RefundWithRefs[]>;

export async function getRefundById(
  client: SupabaseClient,
  refundId: string,
): Promise<RefundWithRefs | null>;

export async function listRefundsForOwner(
  client: SupabaseClient,
  shipownerId: string,
): Promise<RefundRow[]>;
```

### Implementation notes

- Use service-role client at call sites (mig 052 RLS-with-zero-policies — same gap as wallets/notifications). Service is a pure typed reader; the role gating is at the action / page level.
- Joins via PostgREST: `.select('*, transaction:transactions(invoice_ref,vessel_name,document_type,tax_amount_usd), shipowner:shipowners(name,official_email)')`
- `transaction` join: which FK does PostgREST use? `refunds.transaction_id → transactions.id` — only one FK, no need for `!fkeyname` disambiguation.
- `shipowner` join: `refunds.shipowner_id → shipowners.id` — also single FK.

### Tests — `frontend/src/services/refundService.test.ts`

- `listRefundsForAdmin` filters by status correctly
- `listRefundsForAdmin` returns rows with embedded transaction + shipowner
- `getRefundById` returns null for unknown id
- `listRefundsForOwner` scopes to shipowner_id (does not leak across owners)

---

## Task 3 — emailService.sendRefundIssuedEmail

**File**: `frontend/src/services/emailService.ts` (append)

### Function signature

```ts
export interface RefundIssuedParams {
  to: string;
  recipientName: string;
  invoiceRef: string;
  amountUsd: number;
  refundRail: 'WALLET' | 'WIRE_TRANSFER' | 'STRIPE' | 'CASH' | 'CHEQUE' | 'MOBILE_MONEY' | 'THIRD_PARTY' | 'BANK_GUARANTEE' | 'NETTING' | 'LETTER_OF_CREDIT';
  executedAt: string;  // ISO or pre-formatted display string
}

export async function sendRefundIssuedEmail(
  params: RefundIssuedParams,
): Promise<EmailResult>;
```

### Body skeleton

```
Subject: Refund issued for {invoiceRef}

Dear {recipientName},

A refund of {amountUsd} USD has been issued for invoice {invoiceRef}.

Method: {refundRail human-readable}
Executed at: {executedAt}

For WALLET refunds: the amount has been credited to your wallet balance.
For WIRE_TRANSFER: please allow 2-5 business days for the funds to settle.
For STRIPE: the refund will appear on your card statement within 5-10 days.

— Solid Technology
```

XSS hygiene via `escapeHtml`. Reuse `emailLayout()` + `sendEmail()`.

---

## Task 4 — notificationService: wire REFUND_ISSUED

**File**: `frontend/src/services/notificationService.ts`

### Change

`REFUND_ISSUED` is already in the `NotificationKind` union and the `EMAIL_KINDS` set (per Plan 7F mig 053 commit). Add the switch case:

```ts
case 'REFUND_ISSUED':
    result = await sendRefundIssuedEmail({
        to: ownerEmail,
        recipientName: ownerName,
        invoiceRef: String(input.params.invoice_ref ?? '—'),
        amountUsd: Number(input.params.amount_usd ?? 0),
        refundRail: input.params.refund_rail as RefundIssuedParams['refundRail'],
        executedAt: String(input.params.executed_at ?? new Date().toLocaleString()),
    });
    break;
```

Add `sendRefundIssuedEmail` to imports.

### Tests — extend `notificationService.test.ts`

- Calling `notifyOwner({ kind: 'REFUND_ISSUED', params: {...} })` dispatches the refund email
- skipEmail respected

---

## Task 5 — `approveRefund` action

**File**: `frontend/src/actions/approveRefund.ts`

### Zod schema

```ts
const ApproveRefundInput = z.object({
  refundId: z.string().uuid(),
  refundRail: z.enum([
    'WALLET', 'WIRE_TRANSFER', 'STRIPE', 'CASH', 'CHEQUE',
    'MOBILE_MONEY', 'THIRD_PARTY', 'BANK_GUARANTEE',
    'NETTING', 'LETTER_OF_CREDIT',
  ]),
  railDetails: z.record(z.string(), z.unknown()).optional().default({}),
});
```

### Logic

1. `requireRole(['SUPERADMIN', 'FINANCE_ADMIN'])`
2. Fetch refund (service-role) — confirm `status='REQUESTED'`
3. UPDATE `refunds SET refund_rail = $rail, rail_details = $details, status='APPROVED', approved_by = ctx.userId`
4. Audit log: `action='TRANSACTION_UPDATED', entity_type='Refund', entity_id=refundId, details_json: { event: 'REFUND_APPROVED', rail: refundRail }`
5. Return `{ ok: true, refundId }`

**Note**: For WALLET rail, the UI will skip the Approve button and call `executeRefund` directly (which performs the approve+execute combo). This action is the path for WIRE/STRIPE/other rails only.

### Tests

- Happy path: REQUESTED → APPROVED
- Fails if status != REQUESTED (no transition skip)
- Fails if caller is SHIPOWNER or PORT_OFFICER without FINANCE_ADMIN
- Approved_by captured

---

## Task 6 — `executeRefund` action (the big one)

**File**: `frontend/src/actions/executeRefund.ts`

### Zod schema

```ts
const ExecuteRefundInput = z.object({
  refundId: z.string().uuid(),
  // For WALLET 1-click: caller passes refundRail to combine approve+execute
  // For WIRE/STRIPE: refund_rail already set on APPROVED row
  refundRail: z.enum([...]).optional(),
  railDetails: z.record(z.string(), z.unknown()).optional(),
  proofPath: z.string().optional(),  // for WIRE: storage path of uploaded bank slip
});
```

### Logic

1. `requireRole(['SUPERADMIN', 'FINANCE_ADMIN'])`
2. Fetch refund + the underlying REFUND transaction
3. Determine path:
   - If `status='REQUESTED' && refundRail==='WALLET'`: **1-click execute** — set refund_rail + approved_by + (transition straight to EXECUTED in step 5)
   - If `status='APPROVED'`: standard execute path
   - Else: error (illegal transition)
4. **Rail-specific side effect** (before marking EXECUTED so we don't have a half-executed orphan):
   - **WALLET**: look up wallet by `shipowner_id` → INSERT `wallet_ledger` `(wallet_id, kind='REFUND_CREDIT', amount_signed_usd_minor=+refund.amount_usd_minor, refund_id=refund.id, created_by=ctx.userId)`. Mig 050 trigger updates wallet balance.
   - **WIRE_TRANSFER**: no auto side effect. If `proofPath` provided, set `rail_details.proof_storage_path`.
   - **STRIPE**:
     - Find original payment row: `WHERE transaction_id = refund.transaction_id AND rail = 'STRIPE' AND status = 'CONFIRMED'` (the original successful payment)
     - Extract `external_reference` (PI ID) from that payment
     - Call `stripeService.createRefund(paymentIntent: piId, amount: refund.amount_usd_minor)`
     - Capture refund object id in `rail_details.stripe_refund_id`
     - If API call throws: do NOT update refund status — surface error to admin (refund stays APPROVED)
   - **Other rails (CASH/CHEQUE/MOBILE_MONEY/THIRD_PARTY/NETTING/LETTER_OF_CREDIT/BANK_GUARANTEE)**: no auto side effect; admin records execution out-of-band, optionally with `rail_details.justification`
5. UPDATE `refunds SET status='EXECUTED', executed_by=ctx.userId, executed_at=NOW(), rail_details=jsonb_merge(...)`
6. **Notify owner**: `notifyOwner(serviceClient, { shipownerId, kind: 'REFUND_ISSUED', params: { invoice_ref, amount_usd, refund_rail, executed_at }, deepLink: '/owner/invoices?ref=...' })` — fail-soft
7. Audit log: `event='REFUND_EXECUTED', rail, refundId`
8. Return `{ ok: true, refundId }`

### New helper in stripeService

```ts
export async function createRefund(params: {
  paymentIntent: string;
  amountMinor: number;  // USD minor
}): Promise<{ id: string; status: string }> {
  const stripe = getStripeClient();
  const refund = await stripe.refunds.create({
    payment_intent: params.paymentIntent,
    amount: params.amountMinor,  // Stripe accepts integer cents
  });
  return { id: refund.id, status: refund.status ?? 'unknown' };
}
```

### Tests — `frontend/src/actions/executeRefund.test.ts`

- WALLET 1-click: REQUESTED → EXECUTED, wallet_ledger REFUND_CREDIT inserted
- WALLET requires sufficient refund_rail; happy path
- WIRE 2-step: APPROVED → EXECUTED, no wallet_ledger row
- WIRE with proof_path: rail_details captures proof_storage_path
- STRIPE: APPROVED → EXECUTED, stripeService.createRefund called with correct PI + amount
- STRIPE API failure: status stays APPROVED, error surfaced
- Illegal transition (REQUESTED + non-WALLET rail): error
- REFUND_ISSUED notification dispatched (mocked)
- Audit log entry created

---

## Task 7 — `rejectRefund` action

**File**: `frontend/src/actions/rejectRefund.ts`

### Schema

```ts
const RejectRefundInput = z.object({
  refundId: z.string().uuid(),
  reason: z.string().min(5).max(500),
});
```

### Logic

1. `requireRole(['SUPERADMIN', 'FINANCE_ADMIN'])`
2. Fetch refund — must be in `REQUESTED` or `APPROVED` (cannot reject EXECUTED — that's a charge-back, out of scope)
3. UPDATE `status='REJECTED', rejection_reason=$reason`
4. Audit log: `event='REFUND_REJECTED', reason`
5. **No owner notification** — rejecting a refund means we don't owe them. If we want to notify, that's a separate scope.

### Tests

- Happy path REQUESTED → REJECTED
- Happy path APPROVED → REJECTED
- Fails on EXECUTED
- Reason min length enforced

---

## Task 8 — Stripe webhook: `charge.refunded` handler

**File**: `frontend/src/app/api/webhooks/stripe/route.ts` (extend)

### Why

Synchronous `stripe.refunds.create()` in `executeRefund` is the canonical path. The webhook is a safety net for the case where the API call appeared to succeed (refund created in Stripe) but our DB UPDATE failed afterwards — Stripe will fire `charge.refunded` regardless, and we can reconcile.

### Logic

In the `switch (event.type)`:

```ts
case 'charge.refunded': {
    await handleChargeRefunded(admin, event.data.object as Record<string, unknown>);
    break;
}
```

Handler:
1. Extract `charge.payment_intent` (the PI ID we stored as external_reference)
2. Find the payment row (rail=STRIPE, external_reference=piId)
3. Find the refunds row(s) for this transaction. Since refunds.transaction_id ties to the REFUND transaction (not the original payment's transaction), use a different lookup: search by `rail_details->>'stripe_refund_id'` (set in executeRefund) matching `event.data.object.refunds.data[i].id`. **Or** simpler: when executeRefund sets stripe_refund_id, the webhook can match on it directly.
4. If found and status='APPROVED' (DB write failed after API success): UPDATE to EXECUTED + dispatch REFUND_ISSUED notification (fail-soft).
5. If found and status='EXECUTED': idempotent no-op.
6. If not found: log warning, return 200 (don't error — could be a Stripe-side manual refund we don't track).

### Tests

- Charge.refunded with matching APPROVED refund → marks EXECUTED + notif
- Charge.refunded with matching EXECUTED refund → no-op
- Charge.refunded with no match → 200 + log

---

## Task 9 — `/admin/refunds` page

### Files

- `frontend/src/app/admin/refunds/page.tsx` — server component, RBAC gate via `requireRole(['SUPERADMIN', 'FINANCE_ADMIN'])`, renders `<RefundsAdminPanel>` client component
- `frontend/src/components/dashboard/admin/RefundsAdmin/RefundsAdminPanel.tsx` — 3 tabs (À arbitrer / Approuvés / Exécutés) + list table + click-to-drawer
- `frontend/src/components/dashboard/admin/RefundsAdmin/RefundDetailDrawer.tsx` — drawer with:
  - Refund metadata (owner, invoice ref, amount, requested_at, current status)
  - **REQUESTED state**: rail picker (radios) + rail-specific fields (WIRE: show owner's encrypted IBAN with "Reveal" button; STRIPE: show original PI id readonly) + Approve button (skip to Execute for WALLET — single button labeled "Execute Refund") + Reject button
  - **APPROVED state**: Execute button + Reject button (with reason field)
  - **EXECUTED state**: read-only display of `executed_by`, `executed_at`, `rail_details`
  - **REJECTED state**: read-only display of `rejection_reason`, `approved_by` (if approved before reject)
- `frontend/src/components/dashboard/admin/RefundsAdmin/RailDetailsForm.tsx` (optional sub-component) — renders the rail-specific fields

### Component patterns

- Follow `PaymentsAdminPanel` (Plan 7C-3) for tab structure and drawer pattern
- Use modal overlay divs (not Radix Dialog — per memory: admin proposal review convention)
- IBAN reveal: hit a new server action `revealOwnerRefundIban({ shipownerId })` that calls `kycService.decryptIban(...)` — gated to SUPERADMIN+FINANCE_ADMIN, audit-logged on each reveal (`event='IBAN_REVEALED'`).

### File upload for WIRE proof

- Reuse Plan 7C-3 `paymentProofService` upload path or a sibling `refundProofService` (same Storage bucket, prefix `refund-proofs/<refund_id>/`)
- Service-role for upload (mirror admin proof upload in 7C-3 that bypasses owner-only Storage RLS)

### i18n keys touched

All under `AdminRefunds.*` — see Task 11.

---

## Task 10 — Sidebar + RBAC matrix

### Files

- `frontend/src/components/dashboard/DashboardSidebar.tsx` — add nav entry `{ href: '/admin/refunds', label: 'AdminRefunds.nav.title', icon: <RefundIcon /> }` (or reuse an existing icon)
- `frontend/src/lib/rbac.ts` — add `/admin/refunds` to `NAV_PERMISSIONS` with `['SUPERADMIN', 'FINANCE_ADMIN']`

### Tests

- RBAC test: PORT_OFFICER cannot see /admin/refunds nav entry (existing test extension)

---

## Task 11 — i18n EN+FR

### Files

- `frontend/messages/en.json` — add `AdminRefunds` namespace
- `frontend/messages/fr.json` — add `AdminRefunds` namespace
- Update `OwnerPortal.notifications.kind.REFUND_ISSUED.body` (already exists from Plan 7F) to ensure placeholders match the params we pass: `{invoice_ref}`, `{amount_usd}`, `{refund_rail}` (new). If `{refund_rail}` is new, add it to both locales.

### Key list (EN, ~30 keys per locale = 60 strings)

```
AdminRefunds.nav.title:               "Refunds"
AdminRefunds.pageTitle:               "Refunds"
AdminRefunds.tabs.requested:          "To arbitrate"
AdminRefunds.tabs.approved:           "Approved"
AdminRefunds.tabs.executed:           "Executed"
AdminRefunds.tabs.rejected:           "Rejected"
AdminRefunds.table.invoice:           "Invoice"
AdminRefunds.table.owner:             "Shipowner"
AdminRefunds.table.amount:            "Amount"
AdminRefunds.table.requestedAt:       "Requested"
AdminRefunds.table.status:            "Status"
AdminRefunds.table.rail:              "Rail"
AdminRefunds.drawer.title:            "Refund details"
AdminRefunds.drawer.railPicker:       "Refund method"
AdminRefunds.drawer.rail.WALLET:      "Owner wallet (instant)"
AdminRefunds.drawer.rail.WIRE_TRANSFER: "Wire transfer"
AdminRefunds.drawer.rail.STRIPE:      "Stripe refund"
AdminRefunds.drawer.ibanReveal:       "Reveal IBAN"
AdminRefunds.drawer.ibanRevealed:     "IBAN: {iban}"
AdminRefunds.drawer.proofUpload:      "Upload bank slip (optional)"
AdminRefunds.drawer.actions.approve:  "Approve"
AdminRefunds.drawer.actions.execute:  "Execute refund"
AdminRefunds.drawer.actions.reject:   "Reject"
AdminRefunds.drawer.actions.executeWallet: "Refund to wallet"
AdminRefunds.drawer.rejectReason:     "Rejection reason (min 5 chars)"
AdminRefunds.drawer.executedBy:       "Executed by {name} at {time}"
AdminRefunds.drawer.rejectedReason:   "Rejected: {reason}"
AdminRefunds.empty:                   "No refunds in this category"
AdminRefunds.error.stripeFailed:      "Stripe refund failed: {message}"
AdminRefunds.error.illegalTransition: "Invalid status transition"
```

FR translations idiomatic — e.g. `tabs.requested = "À arbitrer"`, `tabs.approved = "Approuvés"`, `tabs.executed = "Exécutés"`, `rail.WALLET = "Portefeuille armateur (instantané)"`, `actions.executeWallet = "Rembourser au portefeuille"`.

---

## Task 12 — Final gates + commit + PR

1. `tsc --noEmit` clean
2. `vitest run` green
3. `next build` green (expect 81 routes = +1 vs Plan 7F's 80, the new `/admin/refunds`)
4. Dispatch `feature-dev:code-reviewer` over the cumulative diff
5. Apply final-review fixes inline
6. Push branch + open PR #28 against develop
7. Update memory with Plan 7G entry

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mig 066 trigger fires recursively if INSERT into refunds also triggers something | Low | Med | refunds has no triggers that touch transactions — verified mig 050+052 |
| Stripe refund partial settlement race | Low | Low | Webhook is idempotent — APPROVED→EXECUTED only fires once due to status check |
| IBAN reveal audit log spammed by repeat admin clicks | Med | Low | Log every reveal with admin ID + refund_id; review surfaces volume in admin audit dashboard |
| Refund transaction with NULL shipowner_id silently dropped by trigger | Low | Med | Reconcile pipeline always sets shipowner_id (Plan 4 invariant). Trigger logs via SECURITY DEFINER NOTICE; admin can hand-create via UI if needed (post-v1 fallback) |
| Stripe API key not configured → executeRefund STRIPE branch crashes | Low | Med | stripeService.createRefund throws clear error; UI catches and shows i18n key `error.stripeFailed`. Admin can still execute WIRE branch in the meantime |

---

## Deferred to Plan 7H

- Refund disputes / chargebacks (owner-initiated)
- Multi-currency refunds (currently always USD minor)
- Owner-facing `/owner/refunds` listing
- Cron-driven Stripe refund reconcile (catches webhook-missed cases over 24h)

---

## Acceptance criteria

- A reconcile-generated REFUND transaction automatically creates a `REQUESTED` refunds row (covered by mig 066 trigger test).
- Admin can pick a rail and approve a refund via `/admin/refunds`. WALLET rail is 1-click execute.
- WALLET execute INSERTs a wallet_ledger REFUND_CREDIT row; wallet balance increments correctly (mig 050 trigger).
- STRIPE execute calls `stripe.refunds.create()`. Webhook `charge.refunded` is a no-op on already-EXECUTED rows.
- Owner receives a REFUND_ISSUED in-app notification + email when a refund is executed.
- Rejecting a refund records `rejection_reason` and `rejected_by`; cannot reject an already-EXECUTED refund.
- IBAN is revealed only via an admin-only audited action; no plaintext IBAN stored in component state past the UI session.
- All RBAC paths gated: SHIPOWNER/PORT_OFFICER cannot reach `/admin/refunds`, cannot call any of the 3 server actions.
- Local gates: tsc clean, vitest green, next build green at 81 routes.

---

*Authored 2026-05-12. Cadrage locked. Ready for subagent-driven execution.*
