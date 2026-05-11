# Stripe Smoke Test Runbook

Local end-to-end verification of the STRIPE rail (Plan 7D). Use **TEST mode** Stripe credentials — never live keys in dev.

## Prerequisites

- Stripe CLI installed: https://stripe.com/docs/stripe-cli
- Logged in: `stripe login` (TEST mode account, NOT live)
- `.env.local` populated with **TEST** credentials:
  ```
  STRIPE_SECRET_KEY=sk_test_…
  STRIPE_WEBHOOK_SECRET=whsec_…              # printed by `stripe listen` (see below)
  STRIPE_PUBLISHABLE_KEY=pk_test_…
  CRON_SECRET=<random-hex>
  NEXT_PUBLIC_APP_URL=http://localhost:3300
  ```
- Local dev server running: `npm run dev` (port 3300)

## 1. Webhook tunnel

In a dedicated terminal:

```bash
stripe listen --forward-to http://localhost:3300/api/webhooks/stripe
```

The CLI prints a webhook signing secret like `whsec_…` — copy it into `.env.local` as `STRIPE_WEBHOOK_SECRET` and restart the dev server.

Leave this terminal running for the whole smoke session — every Stripe event Stripe sends will tunnel through it.

## 2. Trigger events programmatically

### Successful payment

```bash
stripe trigger payment_intent.succeeded
```

Watch the dev server logs — should see `[stripe-webhook] payment_intent.succeeded` lines, NO errors, and the corresponding `payments` row should flip to `CONFIRMED`. If the PaymentIntent was attached to a payments row via `external_reference`, receipt PDF generates and email sends (via the Plan 7C-4 hook replication).

### Failed payment

```bash
stripe trigger payment_intent.payment_failed
```

Row should flip to `REJECTED` with `rejected_reason` containing the Stripe error message.

### Expired Checkout

```bash
stripe trigger checkout.session.expired
```

Row should flip to `CANCELLED`.

## 3. End-to-end TEST card flow (full owner journey)

1. As SHIPOWNER, open `/owner/invoices`.
2. Click **Pay** on a PROFORMA row.
3. In `<PayDialog>` Step 1, pick **Pay by card (Stripe)**.
4. Step 2 (no params needed for STRIPE) → Next.
5. Step 3 → Submit.
6. Browser redirects to Stripe Checkout (`https://checkout.stripe.com/…`).
7. Use TEST card details:
   - Card number: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVC: any 3 digits
   - Postal code: any
8. Click **Pay $XX**.
9. Stripe completes the charge and redirects to `/owner/invoices?stripe=success`.
10. Verify:
    - Green success banner shows "Payment received — receipt is on its way".
    - Within 10 seconds, the row's status flips from PROCESSING → CONFIRMED.
    - A `Receipt` download link appears in the actions column.
    - Email arrives at the shipowner's `official_email` with PDF attached.
    - Database: `SELECT status, receipt_ref, external_reference, rail_details FROM payments WHERE id=…` shows CONFIRMED + populated `receipt_ref` + `stripe_charge_id` in `rail_details`.

## 4. TEST cards (cheat sheet)

| Card number | Outcome |
|---|---|
| `4242 4242 4242 4242` | Successful Visa |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 0341` | Attaches but fails on charge attempt |
| `4000 0027 6000 3184` | Requires 3DS authentication |
| `4000 0000 0000 9995` | Insufficient funds |
| `4100 0000 0000 0019` | Blocked for fraud |

Full list: https://stripe.com/docs/testing#cards

## 5. Cron reconcile manual trigger

To smoke-test the safety-net cron locally (instead of waiting 15 min):

```bash
curl -X GET 'http://localhost:3300/api/cron/stripe-reconcile-pending' \
     -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

Returns JSON like `{ "reconciled": N, "results": [{ "id": "…", "outcome": "STILL_PENDING" | "CONFIRMED" | "CANCELLED" | "CANCELLED_TIMEOUT" | "ERROR" }] }`.

To force the timeout branch, manually backdate a row's `created_at`:

```sql
UPDATE payments
   SET created_at = NOW() - INTERVAL '90 minutes'
 WHERE id = '<test-row-id>' AND status = 'PROCESSING';
```

Then re-run the curl — should see `CANCELLED_TIMEOUT` for that row.

## 6. LIVE cutover gate (NOT for dev)

This is a separate ops step, not a code change:

1. UK entity registration completed and Stripe account flipped from TEST mode to LIVE.
2. Vercel **production** env vars swapped:
   - `STRIPE_SECRET_KEY` → `sk_live_…`
   - `STRIPE_PUBLISHABLE_KEY` → `pk_live_…`
   - `STRIPE_WEBHOOK_SECRET` → `whsec_…` from the LIVE Stripe Dashboard webhook endpoint
3. Register the LIVE webhook endpoint at the prod URL (e.g. `https://greengate.africa/api/webhooks/stripe`) in the Stripe Dashboard. Subscribe to: `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.expired`.
4. First real payment = canary; monitor `/admin/payments` and the Vercel logs closely.

**Do NOT** commit live keys to the repo. Use only Vercel env or a similarly secured secret store.

---

**Last updated**: 2026-05-11 (Plan 7D initial smoke runbook)
