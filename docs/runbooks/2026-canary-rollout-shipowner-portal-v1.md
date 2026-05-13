# Shipowner Portal v1 — Canary Rollout Runbook

> **Authoritative runbook** for the J+0 → J+21 production rollout of Plan 7 phases A–H (Shipowner Portal v1).
>
> **Owner**: Loïc Leclerc (`admin@drwintech.com`)
> **Last updated**: 2026-05-13
> **References**: Master spec [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../superpowers/specs/2026-05-01-shipowner-portal-v1-design.md) §12.3 (rollout), §12.4 (monitoring), §12.5 (rollback). Plan 7H-1/7H-2/7H-3.

This document is the **single source of truth** for portal rollout. Read top-to-bottom on canary day. Every SQL block is copy-paste runnable in Supabase Studio. Every alarm has a threshold.

---

## 1. Pre-flight checklist (BEFORE any flag toggle)

### 1.1 Migrations pushed to hosted

```bash
supabase migration list --linked
```

Expected: local == hosted up through `067_invariant_views.sql`.

At time of writing (2026-05-13), the following are **pending push to hosted** and must be pushed as a batch:

| Mig | From plan | Purpose |
|---|---|---|
| 060 | 7C-2 | Drop `payment_config_single_active` idx + add `routes_rail TEXT[]` |
| 061 | 7C-4 | Add `payments.receipt_*` cols + `profiles.can_record_cash` |
| 062 | 7C-5 | Drop `shipowner_payment_intents` (legacy cutover) |
| 063 | 7D | Partial idx `idx_payments_stripe_pi` on `external_reference WHERE rail='STRIPE'` |
| 064 | 7E | Trigger `apply_topup_credit_on_confirm` (auto TOPUP ledger) |
| 065 | 7F | pg_cron `proforma-reminders-daily` |
| 066 | 7G (PR #28) | Refunds — pending merge of Plan 7G |
| 067 | 7H-3 | 4 invariant monitoring views |

Push command:
```bash
supabase db push --include-all
```

If partial-apply errors appear (`column already exists`, `constraint already exists`): follow the diagnostic pattern from the 2026-04-25 push (memory note) — inspect schema state, drop conflicting bits, retry, `migration repair --status applied <N>` as needed.

### 1.2 Vercel env vars set (production environment)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Hosted Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role for trigger/system actor paths |
| `STRIPE_SECRET_KEY` | **TEST mode** until J+14 LIVE cutover |
| `STRIPE_WEBHOOK_SECRET` | Per Stripe dashboard endpoint |
| `RESEND_API_KEY` | Email dispatcher |
| `CRON_SECRET` | Required — cron routes 401 if unset (Plan 7H-1 fix) |
| `NEXT_PUBLIC_FEATURE_MANAGER_ROLE` | Optional gate (MANAGER role) |

Verify via Vercel CLI:
```bash
vercel env ls production
```

### 1.3 Cron schedules visible in Vercel dashboard

| Route | Schedule | Owner plan |
|---|---|---|
| `/api/cron/overdue-alerts` | Daily 09:00 UTC | Pre-Plan 7 |
| `/api/cron/notification-email-loop` | Daily 09:00 UTC | 7H-1 |
| `/api/cron/stripe-reconcile-pending` | `*/15 * * * *` | 7D |
| `/api/cron/stripe-refund-reconcile-pending` | `*/15 * * * *` | 7H-1 (active post-7G merge) |

Vercel Crons dashboard → confirm last/next run timestamps look sane.

### 1.4 Feature flags initial state — fail-secure default

```sql
SELECT key, value FROM app_config WHERE key LIKE 'feature.%' ORDER BY key;
```

Expected: all 5 portal flags either absent OR `'false'::jsonb`. Read-side default is **false** when key absent (Plan 7H-1 `feature-flags.ts` typed reader).

The 5 portal flags:
- `feature.shipowner_portal_v1_enabled` (master kill switch)
- `feature.shipowner_self_service_enabled`
- `feature.online_payment_stripe_enabled`
- `feature.wallet_topup_enabled`
- `feature.notification_sms_enabled` (dormant — never toggled in v1)

---

## 2. Staging smoke (BEFORE any prod toggle)

### 2.1 Toggle ALL portal flags ON in staging

```sql
INSERT INTO app_config (key, value) VALUES
  ('feature.shipowner_portal_v1_enabled', 'true'::jsonb),
  ('feature.shipowner_self_service_enabled', 'true'::jsonb),
  ('feature.online_payment_stripe_enabled', 'true'::jsonb),
  ('feature.wallet_topup_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

**Note**: Plan 7H-1 enforces strict-boolean policy — the `'true'::jsonb` cast is mandatory. `'true'::text` will read as `false`.

### 2.2 Manual smoke checklist (10 items)

- [ ] `/owner/register` — form submits, PENDING_REVIEW row created
- [ ] `/owner/login` — magic link arrives (Resend dashboard)
- [ ] `/owner/dashboard` — loads, KycCBanner visible if applicable
- [ ] `/owner/invoices` — seeded proforma visible
- [ ] PayDialog WIRE flow — submits payment proof, payments row INITIATED
- [ ] `/admin/payments` — confirm payment → payments row CONFIRMED
- [ ] Receipt PDF emailed via Resend (check inbox + `payments.receipt_ref`)
- [ ] `/owner/wallet` — balance reflects any TOPUP credit
- [ ] `/owner/notifications` — bell shows unread, list page loads
- [ ] `/admin/refunds` — **DEFERRED: requires Plan 7G merge** (currently PR #28)

### 2.3 Run Playwright smoke

```bash
cd frontend && npm run e2e
```

Expect scenarios 01 + 02 green. If scenario 02 (cookie injection) fails: verify `@supabase/ssr` is pinned to 0.9.x (memory note).

**Note**: Playwright is **not in CI** in v1 — operator runs locally before flip.

### 2.4 Run invariant queries

```sql
SELECT * FROM v_payments_initiated_overdue LIMIT 10;
SELECT * FROM v_wallet_balance_drift LIMIT 10;
SELECT * FROM v_transaction_payment_drift LIMIT 10;
SELECT * FROM v_stripe_webhook_failures LIMIT 10;
```

Expected: **all 4 return 0 rows** on a clean staging DB. Any non-zero result must be investigated before promotion to prod canary.

---

## 3. J+0 — Prod canary START

### 3.1 Toggle MASTER flag only

```sql
INSERT INTO app_config (key, value) VALUES
  ('feature.shipowner_portal_v1_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

Other 4 flags stay false. Portal reachable but Stripe / topup / self-service public signup all gated off. Invite-only flow only.

### 3.2 Invite 2-3 known shipowners

- Admin invite via `/admin/registrations` (Plan 7B)
- Manual onboarding emails with portal URL
- Confirm magic-link login succeeds for each

### 3.3 Daily monitoring (J+0 → J+7)

**Every morning — run the 4 invariant queries** (see §10 for copy-paste block):

```sql
SELECT COUNT(*) AS stuck_payments FROM v_payments_initiated_overdue;
SELECT COUNT(*) AS webhook_failures FROM v_stripe_webhook_failures;
SELECT COUNT(*) AS wallet_drift FROM v_wallet_balance_drift;
SELECT COUNT(*) AS txn_payment_drift FROM v_transaction_payment_drift;
```

Thresholds: see §10.

**Vercel logs scan — every morning** (see §11 for filter recipes).

---

## 4. J+7 — Enable wallet top-up

After 7 days of clean canary metrics (all 4 invariants stayed at threshold):

```sql
INSERT INTO app_config (key, value) VALUES
  ('feature.wallet_topup_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

### Smoke

- Have one canary owner top up $100 via PayDialog `mode='topup'` (WIRE rail).
- Admin confirms the payment at `/admin/payments`.
- Verify in Vercel logs: `event:payment_overpayment_to_wallet` (info, scope=`confirmPayment`) — fires from mig 064 trigger path.
- Query: `SELECT * FROM wallet_ledger WHERE wallet_id=<id> ORDER BY created_at DESC LIMIT 5;` — expect 1 fresh `TOPUP` row.
- Re-run 4 invariant queries — all stay at 0.

### Rollback

```sql
UPDATE app_config SET value = 'false'::jsonb WHERE key = 'feature.wallet_topup_enabled';
```

---

## 5. J+14 — Enable Stripe

### 5.1 Prerequisites

- **UK Stripe entity confirmed live** (master spec §12.3).
- TEST keys replaced with LIVE keys in Vercel env:
  - `STRIPE_SECRET_KEY` → LIVE
  - `STRIPE_WEBHOOK_SECRET` → LIVE endpoint secret
- Webhook endpoint in Stripe dashboard pointing at `https://<prod>/api/webhooks/stripe`.

### 5.2 Toggle Stripe flag

```sql
INSERT INTO app_config (key, value) VALUES
  ('feature.online_payment_stripe_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

### 5.3 Smoke

Have one canary owner pay one proforma ($100) via Stripe. Verify:

- `payments` row → `status='CONFIRMED'`, `rail='STRIPE'`, `external_reference=<pi_xxx>`
- Vercel logs (`scope:stripe-webhook event:webhook_payment_succeeded`)
- `v_stripe_webhook_failures` = 0 rows
- Receipt PDF emailed (check `payments.receipt_ref` is set)
- Owner sees PAYMENT_RECEIVED notification (`/owner/notifications`)
- `v_wallet_balance_drift` = 0 rows
- `v_transaction_payment_drift` = 0 rows

### 5.4 Rollback

```sql
UPDATE app_config SET value = 'false'::jsonb WHERE key = 'feature.online_payment_stripe_enabled';
```

In-flight Checkout sessions: existing PROCESSING payments will continue to reconcile via `/api/cron/stripe-reconcile-pending` every 15min. Webhook handler still functions even when flag is off (idempotent by design).

---

## 6. J+21 — Enable self-service public signup

```sql
INSERT INTO app_config (key, value) VALUES
  ('feature.shipowner_self_service_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

**Monitor for spam wave** (master spec §13 risks). Rate-limit at `signup-shipowner` = 3/day/IP is in place (Plan 7B).

If signup rate exceeds **50/day with high admin-rejection rate** (>70% rejected):
1. Re-disable the flag (SQL below).
2. Write a follow-up plan: CAPTCHA, email-verification gate, or admin-allowlist.

### Rollback

```sql
UPDATE app_config SET value = 'false'::jsonb WHERE key = 'feature.shipowner_self_service_enabled';
```

`/owner/register` returns to invite-only.

---

## 7. Rollback procedures

### 7.1 Soft rollback — master kill switch (no DB change)

```sql
UPDATE app_config SET value = 'false'::jsonb
WHERE key = 'feature.shipowner_portal_v1_enabled';
```

Middleware redirects `/owner/*` → `/login` within **~60s** (TTL cache from Plan 7H-1 typed reader). Existing in-session work continues until cookie expires.

Use this for any **non-money-correctness** emergency.

### 7.2 Sub-flag rollback (targeted)

Toggle a single sub-flag false. Portal stays up; only the affected rail/feature disappears. See §4–§6 individual rollback blocks.

### 7.3 Hard rollback — migration DOWN (LIFO order)

Each mig 060-067 has a `-- DOWN:` block in comments. Apply via direct `psql` (NOT `supabase db reset`). Order matters:

```text
1. 067 → DROP VIEW v_payments_initiated_overdue, v_stripe_webhook_failures,
                   v_wallet_balance_drift, v_transaction_payment_drift
2. 066 → DROP TRIGGER refund_audit_t; DROP CONSTRAINT refund_audit_ck;
         ALTER refunds ALTER COLUMN refund_rail SET NOT NULL   -- (post-7G merge only)
3. 065 → SELECT cron.unschedule('proforma-reminders-daily');
         DROP FUNCTION proforma_reminders_run()
4. 064 → DROP TRIGGER apply_topup_credit_on_confirm ON payments
5. 063 → DROP INDEX idx_payments_stripe_pi
6. 062 → re-CREATE shipowner_payment_intents     -- ⚠ DATA LOSS — AVOID
7. 061 → ALTER payments DROP COLUMN receipt_ref, receipt_storage_path, receipt_generated_at;
         ALTER profiles DROP COLUMN can_record_cash
8. 060 → CREATE UNIQUE INDEX payment_config_single_active …;
         ALTER payment_config DROP COLUMN routes_rail
```

> ⚠ **AVOID rollback past mig 062.** Mig 062 dropped `shipowner_payment_intents` CASCADE — re-creating loses all post-Plan 7C-5 history. Prefer **master flag rollback + hotfix forward** over hard schema rollback.

---

## 8. Feature flag toggle reference (quick)

| Flag | Effect | Toggle ON timing | Default |
|---|---|---|---|
| `feature.shipowner_portal_v1_enabled` | Master switch — middleware allows `/owner/*` | J+0 | false |
| `feature.wallet_topup_enabled` | Top-up CTA + `mode='topup'` in PayDialog | J+7 | false |
| `feature.online_payment_stripe_enabled` | STRIPE rail appears in PayDialog | J+14 | false |
| `feature.shipowner_self_service_enabled` | `/owner/register` accepts public signups | J+21 | false |
| `feature.notification_sms_enabled` | **Dormant in v1** — never toggled | Never | false |

**Admin UI** for toggles: `/admin/tax-settings` → "Carbon Tax Pipeline" section (Plan 7H-1 wired all 5 with EN+FR labels).

---

## 9. Invariant queries quick-reference

Run daily during canary (J+0 → J+21); weekly post-J+21.

```sql
-- (1) Stuck payments — INITIATED for > 24 hours with no terminal state.
-- THRESHOLD: alarm if COUNT > 5. Investigate any row > 7 days old (admin review SLA).
SELECT * FROM v_payments_initiated_overdue;

-- (2) Stripe webhook failures — failed signature checks or unhandled events in last 7 days.
-- THRESHOLD: alarm if COUNT > 0. Each failure is a delivery loss until next reconcile cron.
SELECT * FROM v_stripe_webhook_failures;

-- (3) Wallet balance drift — SUM(wallet_ledger) ≠ wallets.balance_usd_minor.
-- THRESHOLD: alarm if COUNT > 0. IMMEDIATE — money correctness invariant violated.
SELECT * FROM v_wallet_balance_drift;

-- (4) Transaction payment drift — confirmed-payments SUM ≠ transactions.partial_paid_usd.
-- THRESHOLD: alarm if COUNT > 0. IMMEDIATE — invoice/payment accounting drift.
SELECT * FROM v_transaction_payment_drift;
```

| View | Source | Alarm threshold | Severity |
|---|---|---|---|
| `v_payments_initiated_overdue` | `payments WHERE status='INITIATED' AND created_at < now() - INTERVAL '24 hours'` | > 5 | WARN — operational |
| `v_stripe_webhook_failures` | webhook audit rows last 7d, status=failed | > 0 | WARN — integration |
| `v_wallet_balance_drift` | `wallets.balance_usd_minor ≠ SUM(wallet_ledger.amount_signed_usd_minor)` | > 0 | **CRITICAL — page Loïc** |
| `v_transaction_payment_drift` | confirmed payments SUM ≠ `transactions.partial_paid_usd` | > 0 | **CRITICAL — page Loïc** |

---

## 10. Vercel log scan recipes

All log events emit via Plan 7H-3 Task 2 structured logger (`frontend/src/lib/logger.ts`). Format: JSON line, fields include `level`, `scope`, `event`, plus contextual IDs (no PII, no secrets).

### Tail money flow (info)
```text
level:info AND (event:payment_confirmed OR event:payment_rejected OR event:wallet_applied OR event:wallet_manually_adjusted OR event:payment_overpayment_to_wallet)
```

### Tail failures (warn + error)
```text
level:error OR (level:warn AND (event:wallet_insufficient_funds OR event:receipt_generation_failed OR event:email_send_failed OR event:notification_dispatch_failed OR event:stripe_api_failed OR event:email_dispatch_failed))
```

### Tail cron health
```text
(event:cron_run_start OR event:cron_run_complete) AND (scope:cron.notification-email-loop OR scope:cron.stripe-refund-reconcile)
```

### Tail Stripe webhook
```text
scope:stripe-webhook
```
(then filter by event: `webhook_event_received`, `webhook_payment_succeeded`, `webhook_payment_failed`, `webhook_checkout_expired`, `webhook_unhandled_event`)

### Event catalogue (what to expect to see)

| Event | Level | Scope(s) | Meaning |
|---|---|---|---|
| `payment_confirmed` | info | `confirmPayment` | Admin / system confirmed a payment |
| `payment_rejected` | info | `rejectPayment` | Admin rejected a payment |
| `wallet_applied` | info | `applyWallet` | Owner applied wallet credit to a proforma |
| `wallet_manually_adjusted` | info | `adjustWalletManually` | SUPERADMIN manual wallet adjustment |
| `payment_overpayment_to_wallet` | info | `confirmPayment` | Overpayment auto-credited to wallet ledger |
| `wallet_insufficient_funds` | warn | `applyWallet` | Owner tried to apply more than balance |
| `receipt_generation_failed` | warn | `confirmPayment` | Receipt PDF generation failed (fail-soft) |
| `email_send_failed` | warn | various | Resend dispatch failed (fail-soft) |
| `notification_dispatch_failed` | warn | various | In-app notification insert failed |
| `stripe_api_failed` | warn | `stripe-webhook`, crons | Stripe SDK call failed |
| `email_dispatch_failed` | warn | `cron.notification-email-loop` | Cron-batch email dispatch failed |
| `cron_run_start` / `cron_run_complete` | info | `cron.*` | Cron route entry / exit |
| `webhook_event_received` | info | `stripe-webhook` | Stripe event arrived (pre-handler) |
| `webhook_payment_succeeded` | info | `stripe-webhook` | `payment_intent.succeeded` handled |
| `webhook_payment_failed` | info | `stripe-webhook` | `payment_intent.payment_failed` handled |
| `webhook_checkout_expired` | info | `stripe-webhook` | `checkout.session.expired` handled |
| `webhook_unhandled_event` | warn | `stripe-webhook` | Stripe event type we don't handle yet |

> **Note**: Sentry / structured log aggregation is **deferred** in v1. Vercel raw log search is the primary tool. If volume justifies it post-canary, add Logflare / Sentry / Better Stack as a follow-up.

---

## 11. Common debugging recipes

### 11.1 Owner sees "portal disabled" / 404 on `/owner/*`
- Middleware caches feature flag reads for **60s TTL** (Plan 7H-1).
- Check: `SELECT value FROM app_config WHERE key='feature.shipowner_portal_v1_enabled';`
- Common bug: stored as `'true'::text` instead of `'true'::jsonb` — typed reader returns false.
- Wait 60s after correcting; the cache will refresh.

### 11.2 Stripe payment confirmed but no receipt
- Vercel logs filter: `scope:confirmPayment event:receipt_generation_failed`
- Receipt service is **fail-soft** — payment state remains canonical.
- Manual re-generation: replay `confirmPayment` is NOT idempotent for receipts. Use the receipt service directly via a one-off script if needed; or accept that the payment is confirmed and email a manual receipt.

### 11.3 Wallet drift detected (`v_wallet_balance_drift` > 0)
- **CRITICAL — page Loïc immediately.**
- Query the affected wallet:
  ```sql
  SELECT id, balance_usd_minor FROM wallets WHERE id = '<wallet_id>';
  SELECT SUM(amount_signed_usd_minor) FROM wallet_ledger WHERE wallet_id = '<wallet_id>';
  SELECT * FROM wallet_ledger WHERE wallet_id = '<wallet_id>' ORDER BY created_at DESC LIMIT 20;
  ```
- Identify the offending entry (likely a manual SQL touch bypassing trigger, since `wallet_ledger` is append-only).
- Correction via `adjustWalletManually` server action (SUPERADMIN role + ≥5 char justification — triple-defense UI/server/DB).

### 11.4 CRON not running
- Vercel Crons dashboard → check last/next run timestamps.
- `CRON_SECRET` env must be set; cron routes 401 if unset (Plan 7H-1 fix).
- Manual trigger for debugging: `curl -H "Authorization: Bearer $CRON_SECRET" https://<prod>/api/cron/notification-email-loop`

### 11.5 E2E tests fail on cookie injection (scenario 02)
- Most likely cause: `@supabase/ssr` version drift. Pin to 0.9.x.
- `cd frontend && npm ls @supabase/ssr`

### 11.6 Unhandled Stripe webhook event surfaced
- Logs: `event:webhook_unhandled_event`
- Inspect Stripe dashboard for event type.
- Decision: add handler (then mig + deploy) OR ignore (most likely safe — handler is no-op idempotent return 200).

### 11.7 Stuck INITIATED payment (`v_payments_initiated_overdue` non-zero)
- For STRIPE rail: `/api/cron/stripe-reconcile-pending` should have reconciled within 15min. If still INITIATED after 1hr, check `external_reference` against Stripe dashboard.
- For WIRE/CHEQUE/CASH rails: payment proof was uploaded but admin never confirmed/rejected. Surface via `/admin/payments` queue.

---

## 12. Escalation

| Trigger | Action |
|---|---|
| `v_wallet_balance_drift` > 0 | **Page Loïc immediately.** Money correctness. |
| `v_transaction_payment_drift` > 0 | **Page Loïc immediately.** Invoice/payment drift. |
| Stripe integration outage (5xx from Stripe API for > 30min) | Defer Stripe canary until UK entity ops confirm. Disable `feature.online_payment_stripe_enabled`. |
| Mass-signup spam wave (> 50/day, > 70% rejected) | Re-disable `feature.shipowner_self_service_enabled` + write follow-up plan (CAPTCHA / email verification / allowlist). |
| Critical bug needing hotfix | Revert master flag (§7.1). Deploy hotfix to develop. Re-enable. |
| Vercel deploy failure | Production hotfix path: revert last commit on develop, force-push (verify Vercel auto-deploy picks it up). The `.github/workflows/deploy-production.yml` is chronically failing — Vercel direct integration is the actual deploy path (memory note). |

---

## 13. Honest deferral notes

The following items are **explicitly NOT in v1** — flag them when planning post-canary work:

- **Sentry / structured-log aggregation** — Vercel raw logs only. Acceptable for v1 volume; revisit at scale.
- **Playwright in CI** — Plan 7H-2 set up the suite but it runs **locally only** at canary time. CI integration deferred.
- **pg tests for migs 060-067** — Docker is broken on the dev machine; all 8 migs verified via SQL on hosted post-push, not via the `supabase/tests/run.sh` runner. Carries 7E/7F/7G precedent.
- **Refunds runbook entries** — Plan 7G (PR #28) is not yet on develop at time of writing. Smoke step §2.2 line 10 (`/admin/refunds`) + Vercel filter event `refund_stripe_api_failed` + mig 066 DOWN block become live once 7G merges.
- **SMS notification rail** — `feature.notification_sms_enabled` flag exists but the dispatcher does not. Dormant flag, never toggled in v1.
- **CAPTCHA / advanced anti-abuse** — only rate-limit 3/day/IP on `signup-shipowner`. If spam wave hits, see §12.

---

## 14. Post-canary updates (J+21+)

> *To be filled in after the first canary completes.*
>
> Append observations here:
> - What thresholds were too loose / too tight?
> - What log events were noisy or missing?
> - What invariant query took unexpected time to run?
> - What rollback path was actually exercised?
> - What flag should be flipped earlier / later next time?

Live document — not a one-shot artifact. Append, never delete.

---

*Authored 2026-05-13 for Plan 7H-3, closing Phase H of Plan 7. Reviewed against master spec §12.3/§12.4/§12.5. Single source of truth for canary day.*
