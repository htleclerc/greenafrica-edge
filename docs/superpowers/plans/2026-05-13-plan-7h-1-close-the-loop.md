# Plan 7H-1 — Close-the-loop (crons + feature flags)

> **Phase H sub-plan 1.** Closes the three production-readiness gaps carried over from Plans 7F and 7G, and lands the v1 feature-flag fabric required by the rollout plan in master spec §12.
>
> Master spec: [`specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §12 (rollout) + §12.4 (monitoring).
>
> Successor plans: **7H-2** (Playwright E2E suite), **7H-3** (monitoring + rollout runbook). Both deferred to follow-up PRs.

---

## Cadrage (locked)

| Decision | Choice |
|---|---|
| Plan split | **A** — 7H-1 close-the-loop only; 7H-2 / 7H-3 follow |
| Notification email loop | **A** — Vercel Cron daily `/api/cron/notification-email-loop` |
| Stripe refund reconcile cron | **A** — Yes, every 15min, mirrors payment reconcile |
| Feature flags | **A** — Extend `app_config` (reuse existing `CarbonTaxPipelineSection` pattern) |

---

## What ships in 7H-1

1. **`/api/cron/notification-email-loop`** — daily Vercel Cron at 09:00 UTC. Polls `owner_notifications` for unsent EMAIL_KINDS rows from the last 24h, dispatches each via the existing emailService chain.
2. **`/api/cron/stripe-refund-reconcile-pending`** — every 15min Vercel Cron. Catches refunds stuck in APPROVED state with rail=STRIPE for ≥15min; reconciles against Stripe's actual refund status.
3. **5 new feature flag keys** in `app_config` per master spec §12.2:
   - `feature.shipowner_portal_v1_enabled` (master kill switch)
   - `feature.shipowner_self_service_enabled` (public signup)
   - `feature.online_payment_stripe_enabled` (Stripe rail)
   - `feature.wallet_topup_enabled` (voluntary top-up)
   - `feature.notification_sms_enabled` (dormant, never enabled in v1)
4. **Typed flag reader** at `frontend/src/lib/feature-flags.ts` — single async helper that reads all 5 flags with sensible defaults.
5. **Flag gates wired** into 4 entry points:
   - `/owner/register` page + `signupShipowner` action → `shipowner_self_service_enabled`
   - PayDialog STRIPE rail visibility (via `/api/owner/payment-availability`) → `online_payment_stripe_enabled`
   - PayDialog topup mode + `/owner/wallet` "Top up" button → `wallet_topup_enabled`
   - Master switch → owner-portal middleware redirect when disabled
6. **EN+FR i18n** for the 5 new toggles in `AdminTaxPipeline` namespace (the existing `CarbonTaxPipelineSection` UI auto-renders labeled toggles).

---

## Out of scope (Plan 7H-2 / 7H-3 / never)

- Playwright E2E suite (master spec §11.3, 11 scenarios) → **Plan 7H-2**
- Sentry instrumentation + Grafana queries (§12.4) → **Plan 7H-3**
- Production canary runbook + J+7/14/21 progression docs → **Plan 7H-3**
- Owner-facing `/owner/refunds` page (7G optional deferral) → never (REFUND row in `/owner/invoices` + REFUND_ISSUED notif suffices)
- JSONB index `idx_refunds_stripe_refund_id` (7G low-volume optimization) → defer to first ops incident
- AR/PT/SW i18n translation (master spec §10.2 P2) → never (EN fallback is the v1 commitment)
- Refund disputes / chargebacks (master spec §15) → never in v1
- Multi-currency refunds (always USD minor in v1) → never in v1
- Migration pg test batch verify (Docker still broken across 7 plans) → ops concern, not blocking PR merges

---

## Task list

1. **`/api/cron/notification-email-loop`** route + `vercel.json` cron entry + tests
2. **`/api/cron/stripe-refund-reconcile-pending`** route + `vercel.json` cron entry + tests
3. **Feature flag keys**: extend `updateAppConfig.ts` constants + write a thin migration if `app_config` schema needs the new keys pre-seeded, OR rely on the UPSERT default-false pattern (verify first)
4. **`frontend/src/lib/feature-flags.ts`** — typed reader with cache-friendly signature
5. **Flag gates wired**: 4 entry points
6. **EN+FR i18n** for the 5 toggle labels in `AdminTaxPipeline`
7. **Final gates** (tsc + vitest + next build) + code review + PR + memory update

---

## Task 1 — `/api/cron/notification-email-loop`

**File**: `frontend/src/app/api/cron/notification-email-loop/route.ts`

### Rationale

Plan 7F shipped `mig 065` (pg_cron `proforma-reminders-daily`) which INSERTs `owner_notifications` rows with kind=`PROFORMA_REMINDER`. But no code path dispatches the email for those rows. The bell shows them; the email is silent.

This route closes the gap for ALL `EMAIL_KINDS` rows that have `emailed_at IS NULL` AND were inserted recently (24h window). Today only PROFORMA_REMINDER hits this path in practice; future kinds inserted by triggers / cron will benefit automatically.

### Request shape

`GET /api/cron/notification-email-loop`

- Vercel Cron sets the `Authorization: Bearer ${CRON_SECRET}` header (existing convention — same as `stripe-reconcile-pending`).
- Returns `{ processed: number, succeeded: number, failed: number, skipped: number }`.

### Logic

1. Verify `Authorization` header matches `CRON_SECRET` env var. Reject 401 if not.
2. Service-role client.
3. Query: rows where `kind IN EMAIL_KINDS_RUNTIME_LIST` AND `emailed_at IS NULL` AND `created_at > NOW() - INTERVAL '24 hours'`. Limit 100 per run (defensive — large backlog = ops incident, not a single cron run's job).
4. For each row:
   - Load shipowner via `shipowners` join (or batch upfront): need `official_email`, `name`.
   - **Skip and mark** if `official_email IS NULL`: UPDATE `emailed_at = NOW()` with a `body_params.skip_reason='no_email_on_file'` marker (or just log and skip the UPDATE — pick the safer one). Decision: log + skip UPDATE so the next run re-evaluates. But cap at 5 retries via a `body_params.email_attempts` counter to prevent unbounded re-tries.
   - Switch on `kind` to call the right email function. **Reuse the same switch as `notificationService.notifyOwner`** — extract the switch into a shared helper `dispatchNotificationEmail(client, notif, owner)` to avoid duplication.
   - On success: UPDATE `emailed_at = NOW()`. Race-guarded by `.is('emailed_at', null)` (concurrent runs no-op).
   - On failure (Resend 5xx, etc.): log error, increment `body_params.email_attempts`, do NOT set emailed_at. Next run will retry (up to 5 attempts).
5. Aggregate counts, return.

### Shared helper

Extract from `notificationService.notifyOwner` (the switch block) into:

`frontend/src/services/notificationEmailDispatch.ts`:

```ts
export async function dispatchNotificationEmail(params: {
  kind: NotificationKind;
  ownerEmail: string;
  ownerName: string;
  bodyParams: Record<string, unknown>;
}): Promise<EmailResult | null>;
```

Returns `null` for kinds not in EMAIL_KINDS (defensive — caller should pre-filter). Returns the EmailResult otherwise. Pure function — no DB writes.

Then `notificationService.notifyOwner` calls this helper instead of the inline switch. Both call sites stay consistent.

### `vercel.json` entry

```json
{
  "crons": [
    {
      "path": "/api/cron/notification-email-loop",
      "schedule": "0 9 * * *"
    }
  ]
}
```

(Existing `vercel.json` already has the stripe-reconcile cron entry; this is additive.)

### Tests — `frontend/src/app/api/cron/notification-email-loop/route.test.ts`

- 401 on missing/wrong Authorization header
- Processes pending notifications (mocked DB + email function)
- Skips notifications without owner email + logs
- Race-guarded UPDATE — concurrent run with same row finds emailed_at already set
- Counts succeeded / failed / skipped correctly

---

## Task 2 — `/api/cron/stripe-refund-reconcile-pending`

**File**: `frontend/src/app/api/cron/stripe-refund-reconcile-pending/route.ts`

### Rationale

Symmetric to `stripe-reconcile-pending` (Plan 7D) but for refunds. Plan 7G's `executeRefund` STRIPE branch makes a synchronous `stripe.refunds.create()` call; on success the row goes to `EXECUTED`. The `charge.refunded` webhook is the safety net for cases where the API succeeded but our subsequent UPDATE failed.

This cron is a **second-line safety net**: if the webhook also missed (Stripe outage, our endpoint down, etc.), this cron polls every 15min and reconciles any STRIPE refunds stuck in APPROVED for ≥15min.

### Request shape

`GET /api/cron/stripe-refund-reconcile-pending`

- Bearer CRON_SECRET auth.
- Returns `{ checked: number, reconciled: number, skipped: number, errored: number }`.

### Logic

1. Auth gate.
2. Service-role client.
3. Query: `refunds WHERE rail='STRIPE' AND status='APPROVED' AND updated_at < NOW() - INTERVAL '15 minutes'`. Limit 50 per run.
4. For each:
   - Read `rail_details->>'stripe_refund_id'`. If absent: log warning + skip (probably means action threw before persisting — manual intervention needed).
   - Call `stripe.refunds.retrieve(stripeRefundId)`.
   - On Stripe response:
     - `status='succeeded'`: race-guarded UPDATE to `EXECUTED` with `executed_at`, `executed_by=systemActor`. Dispatch REFUND_ISSUED notification fail-soft.
     - `status='pending'`: still in flight, skip.
     - `status='failed'` or `'canceled'`: race-guarded UPDATE to `REJECTED` with `rejection_reason='Stripe refund ${status}: ${failure_reason}'`. **No** owner notification (rejection = we don't owe per Plan 7G convention).
   - On Stripe API error (404 etc.): log warning, increment a `rail_details.reconcile_attempts` counter, skip if >10 attempts.
5. Audit event `REFUND_RECONCILED_BY_CRON` for each transition.

### `vercel.json` entry

```json
{
  "path": "/api/cron/stripe-refund-reconcile-pending",
  "schedule": "*/15 * * * *"
}
```

### Tests — `frontend/src/app/api/cron/stripe-refund-reconcile-pending/route.test.ts`

- 401 on missing auth
- Skips refunds <15min old
- Stripe succeeded → row goes EXECUTED + notify dispatched
- Stripe pending → no-op
- Stripe failed → row goes REJECTED, no notify
- Stripe API throw → counter incremented, row untouched
- Missing stripe_refund_id → logs warning, skips
- Race-guarded UPDATE (status changed mid-flight → no-op)

---

## Task 3 — Feature flag keys in `app_config`

### Files

- `frontend/src/actions/updateAppConfig.ts` — extend `BOOLEAN_KEYS` + `ALLOWED_KEYS` + `KEY_ORDER` with the 5 new flag names.
- **No migration needed** — `app_config` is a key-value table; UPSERT-on-write default-false at read time. Verify the read-side handles missing keys as false (it should per existing CarbonTaxPipelineSection pattern; if not, fix that too).

### Flag list (exact key names per spec §12.2)

```
feature.shipowner_portal_v1_enabled
feature.shipowner_self_service_enabled
feature.online_payment_stripe_enabled
feature.wallet_topup_enabled
feature.notification_sms_enabled
```

### Read-side default

Default `false` for ALL flags. The plan author commits to **manually toggling the master flag to `true` on staging** before any owner-facing testing happens. Production canary plan (Plan 7H-3) will document the toggle sequence.

### Tests

Existing `updateAppConfig.test.ts` should still pass with new keys in `ALLOWED_KEYS`. Add 1 test asserting the 5 new flags are in `ALLOWED_KEYS` and writable.

---

## Task 4 — `frontend/src/lib/feature-flags.ts`

### Exports

```ts
export interface PortalFeatureFlags {
  portalV1Enabled: boolean;
  selfServiceEnabled: boolean;
  onlinePaymentStripeEnabled: boolean;
  walletTopupEnabled: boolean;
  notificationSmsEnabled: boolean;
}

/**
 * Read all 5 portal feature flags in a single round-trip.
 * Missing keys default to false. Caches per-request via React's `cache()`.
 */
export async function readPortalFeatureFlags(): Promise<PortalFeatureFlags>;

/**
 * Read a single flag. Convenience wrapper.
 */
export async function isFeatureEnabled(key: keyof PortalFeatureFlags): Promise<boolean>;
```

### Implementation

- Service-role client (app_config is admin-only via RLS today; service-role bypasses any restriction).
- Single SELECT: `WHERE key IN (5 keys)`.
- Wrap with React 19 `cache()` so a server component reading multiple flags in one render doesn't round-trip 5 times.
- Convert key names to camelCase for the return shape.

### Tests — `frontend/src/lib/feature-flags.test.ts`

- All 5 flags present + true → returns all true
- 0 flags present in DB → all false (defensive defaults)
- Mixed (some present, some missing) → returns correctly
- `isFeatureEnabled` convenience wrapper works

---

## Task 5 — Wire flags into 4 entry points

### 5.1 — `/owner/register` page + `signupShipowner` action

Both must check `shipowner_self_service_enabled`. If disabled:
- Page: redirect to `/login` with a banner explaining signup is currently invite-only.
- Action: return `{ ok: false, error: 'Self-service signup is not currently enabled.' }` defensively (in case someone POSTs directly).

### 5.2 — `/api/owner/payment-availability` route — STRIPE rail visibility

Existing route already returns the list of available rails per owner. Currently, STRIPE is eligible iff `STRIPE_SECRET_KEY` env var is set (per Plan 7D final-review fix). Add a second condition: **also** `online_payment_stripe_enabled` flag. If either is false → STRIPE not eligible.

### 5.3 — PayDialog topup mode + `/owner/wallet` "Top up" button

- `<PayDialog mode='topup'>` is currently rendered by `/owner/wallet/page.tsx`. Hide the trigger button if `wallet_topup_enabled === false`.
- If a user finds the URL anyway and opens the dialog: render a disabled state with a clear "Wallet top-ups are currently unavailable" message. (Simpler: hide the button server-side; client never sees the dialog open.)

### 5.4 — Master switch: middleware redirect for `/owner/*`

`frontend/src/middleware.ts` (or wherever the existing middleware lives):
- If request path starts with `/owner/` (except `/owner/login` and `/owner/auth/callback`) AND `portalV1Enabled === false`: redirect to `/login` with a `?portal_disabled=1` query param so the login page can show a banner.

**Concern**: middleware runs on every request. Reading app_config via service-role on every request is too expensive. Cache the flag value at runtime with a 60s TTL in module-scope (similar to other env-derived caches). Or: rely on Vercel Edge config later. For Plan 7H-1: use a simple in-memory TTL cache (acceptable for v1; production canary will load-test).

### Tests
Each gate needs 1 happy + 1 disabled-path test. Server actions are easiest to test; page-level redirects can be smoke-tested via the integration suite.

---

## Task 6 — EN+FR i18n for toggle labels

Add to `AdminTaxPipeline` namespace (or wherever the existing toggle labels live — `BOOLEAN_KEY_LABELS` map in tax-settings).

5 EN labels + 5 FR labels = 10 strings total:

```
feature.shipowner_portal_v1_enabled:       "Shipowner Portal v1 (master)" / "Portail Armateur v1 (master)"
feature.shipowner_self_service_enabled:    "Self-service signup"          / "Inscription en libre-service"
feature.online_payment_stripe_enabled:     "Online payment (Stripe)"      / "Paiement en ligne (Stripe)"
feature.wallet_topup_enabled:              "Wallet top-up"                / "Recharge du portefeuille"
feature.notification_sms_enabled:          "SMS notifications (dormant)"  / "Notifications SMS (en veille)"
```

The existing tax-settings UI auto-renders each `BOOLEAN_KEYS` entry — labels just need to land in `BOOLEAN_KEY_LABELS` if that's how the panel resolves them, OR in the existing `AdminTaxPipeline.*` namespace if it uses `t(key)` lookup. Match whatever the existing toggles do.

---

## Task 7 — Final gates + commit + PR

1. `tsc --noEmit` clean
2. `vitest run` green (expect ~10 new tests added across cron routes + feature-flags + gates)
3. `next build` green — expect 83 routes (+2 vs Plan 7G's 81: 2 new cron routes). No new pages.
4. Dispatch `feature-dev:code-reviewer` over full diff.
5. Apply final-review fixes.
6. Push branch, open PR #29 against develop.
7. Update memory with Plan 7H-1 entry.

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Notification email loop dispatches duplicate emails on race | Low | Med | Race-guarded UPDATE `.is('emailed_at', null)`; concurrent runs filter to 0 rows on second arrival. |
| Stripe refund reconcile cron races against webhook | Low | Low | Both paths race-guard on `status='APPROVED'`. First-to-write wins; second sees 0 rows and logs idempotent no-op. |
| Middleware feature-flag cache stale after admin toggles flag | Med | Low | 60s TTL; admin toggles staging first, waits a minute, then verifies. Acceptable for v1 canary. |
| `dispatchNotificationEmail` extraction breaks `notifyOwner` callers | Med | Med | Refactor surgical — only the switch block moves; signatures unchanged. Existing notificationService tests catch regressions. |
| `app_config` missing keys read as `null` not `false` | Low | Med | Verify read-side behavior in Task 3; if needed, explicit `?? false` at every consumer. |

---

## Acceptance criteria

- Daily Vercel Cron dispatches emails for `PROFORMA_REMINDER` rows inserted by mig 065 pg_cron. `emailed_at` populated on success. Failed dispatches retry up to 5 times across runs.
- 15-min Vercel Cron reconciles STRIPE refunds stuck in APPROVED. Stripe API confirms → EXECUTED + notify. Stripe failed → REJECTED.
- Admin can toggle 5 portal feature flags from `/admin/tax-settings`. Each toggle has a clear EN+FR label.
- With `shipowner_portal_v1_enabled=false`, `/owner/*` redirects to `/login`. With `=true`, portal is reachable.
- With `shipowner_self_service_enabled=false`, `/owner/register` redirects + `signupShipowner` action returns error.
- With `online_payment_stripe_enabled=false`, STRIPE rail does not appear in PayDialog.
- With `wallet_topup_enabled=false`, the "Top up" button is hidden on `/owner/wallet`.
- All local gates green (tsc / vitest / next build).
- No new `as any` / `@ts-ignore`.

---

*Authored 2026-05-13. Cadrage locked. Ready for subagent-driven execution.*
