# Plan 7H-3 — Monitoring + canary runbook (closes Phase H)

> **Phase H sub-plan 3 of 3.** Closes Plan 7's master spec by shipping the monitoring fabric (§12.4) + canary rollout runbook (§12.3) + rollback documentation (§12.5).
>
> Predecessors: 7H-1 (feature flags + crons), 7H-2 (Playwright smoke). All other Phase H items addressed.

---

## Cadrage (locked)

| Decision | Choice |
|---|---|
| Observability | Structured JSON logs only — no Sentry. Vercel log drains handle aggregation. |
| Invariant queries | Mig 067 ships 4 SQL views — admin queries them via Supabase Studio / future Grafana. |
| Playwright CI | Deferred to post-v1 (no nightly workflow this plan). |
| Runbook format | Single comprehensive doc — timeline + toggle reference + invariant queries + rollback. |

---

## What ships in 7H-3

1. **Mig 067**: 4 read-only views for invariant monitoring.
2. **`frontend/src/lib/logger.ts`**: typed structured-JSON logger (timestamp, level, scope, event, context).
3. **Logger wired** into 5 critical money-mutation server actions + 2 cron routes + Stripe webhook handlers.
4. **Canary runbook** at `docs/runbooks/2026-canary-rollout-shipowner-portal-v1.md` covering staging smoke → J+0 prod canary → J+7/14/21 progression → rollback procedure → flag toggle reference + invariant query snippets.
5. Local gates + final code review + PR.

---

## Out of scope (post-v1)

- Sentry SDK install (deferred — structured logs cover v1 needs)
- Playwright CI integration (deferred — manual run for v1 per 7H-2)
- Grafana / Datadog dashboard configuration (views exist; visualization layer is ops-team scope)
- Alert routing (PagerDuty / Opsgenie / Slack webhooks) — runbook documents thresholds but no automation
- Sourcemap upload (Sentry-specific; N/A)
- AR/PT/SW i18n translation (P2 dette per spec §10.2)

---

## Task list

1. **Mig 067** — 4 invariant views (`v_payments_initiated_overdue`, `v_wallet_balance_drift`, `v_transaction_payment_drift`, `v_stripe_webhook_failures`) + tests
2. **`frontend/src/lib/logger.ts`** — typed JSON logger + unit tests
3. **Wire logger into 5 server actions**: `confirmPayment`, `rejectPayment`, `applyWallet`, `executeRefund` (Plan 7G — branch dependency), `adjustWalletManually` (Plan 7E — branch dependency)
4. **Wire logger into cron + webhook surfaces**: 2 cron routes (notification-email-loop, stripe-refund-reconcile-pending) + Stripe webhook handlers (handlePaymentSucceeded, handlePaymentFailed, handleChargeRefunded)
5. **Canary runbook** at `docs/runbooks/2026-canary-rollout-shipowner-portal-v1.md`
6. **Final gates** (tsc + vitest + next build) + code review + PR + memory update

---

## Task 1 — Migration 067: 4 invariant views

**File**: `supabase/migrations/067_invariant_views.sql`

### Rationale

The master spec §12.4 lists 4 invariant queries that ops should monitor:
- Payments stuck INITIATED >24h (admin review backlog signal)
- Stripe webhook failures (integration health)
- `SUM(ledger) ≠ wallet.balance` (ledger drift — money correctness)
- `SUM(payments confirmed) ≠ transaction.paid` (payment-transaction sync drift)

Shipping these as **views** (not RPCs or stored procs) keeps them queryable from Supabase Studio with no extra primitives, gives Grafana / other dashboards a stable surface, and lets us evolve them with future migrations without breaking external consumers.

### SQL

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 067: Invariant monitoring views (read-only, ops-facing)
-- Master spec §12.4
-- ─────────────────────────────────────────────────────────────────────────────

-- View 1: Payments in INITIATED state for more than 24 hours
-- Operational signal: admin review backlog growing.
CREATE OR REPLACE VIEW public.v_payments_initiated_overdue AS
SELECT
    p.id,
    p.shipowner_id,
    s.name AS shipowner_name,
    p.transaction_id,
    p.amount_usd_minor,
    p.rail,
    p.created_at,
    EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 AS age_hours
FROM public.payments p
LEFT JOIN public.shipowners s ON s.id = p.shipowner_id
WHERE p.status = 'INITIATED'
  AND p.created_at < NOW() - INTERVAL '24 hours'
ORDER BY p.created_at ASC;

-- View 2: Stripe webhook failures (rail=STRIPE payments rejected via webhook)
-- Operational signal: Stripe integration health / chargeback patterns.
CREATE OR REPLACE VIEW public.v_stripe_webhook_failures AS
SELECT
    p.id,
    p.shipowner_id,
    s.name AS shipowner_name,
    p.transaction_id,
    p.amount_usd_minor,
    p.rejected_reason,
    p.external_reference AS stripe_payment_intent_id,
    p.created_at,
    p.updated_at AS rejected_at
FROM public.payments p
LEFT JOIN public.shipowners s ON s.id = p.shipowner_id
WHERE p.rail = 'STRIPE'
  AND p.status = 'REJECTED'
  AND p.rejected_reason LIKE 'Stripe:%'
  AND p.updated_at > NOW() - INTERVAL '7 days'
ORDER BY p.updated_at DESC;

-- View 3: Wallet balance drift (SUM(ledger) ≠ wallet.balance_usd_minor)
-- CRITICAL invariant: an immediate-alarm signal per spec §12.4.
CREATE OR REPLACE VIEW public.v_wallet_balance_drift AS
SELECT
    w.id AS wallet_id,
    w.shipowner_id,
    s.name AS shipowner_name,
    w.balance_usd_minor AS reported_balance,
    COALESCE(SUM(l.amount_signed_usd_minor), 0) AS computed_balance,
    w.balance_usd_minor - COALESCE(SUM(l.amount_signed_usd_minor), 0) AS drift_minor
FROM public.wallets w
LEFT JOIN public.wallet_ledger l ON l.wallet_id = w.id
LEFT JOIN public.shipowners s ON s.id = w.shipowner_id
GROUP BY w.id, w.shipowner_id, s.name, w.balance_usd_minor
HAVING w.balance_usd_minor != COALESCE(SUM(l.amount_signed_usd_minor), 0)
ORDER BY ABS(w.balance_usd_minor - COALESCE(SUM(l.amount_signed_usd_minor), 0)) DESC;

-- View 4: Transaction payment drift
-- (SUM(payments confirmed) ≠ transactions.partial_paid_usd in dollars)
-- CRITICAL invariant: an immediate-alarm signal per spec §12.4.
-- Note: payments.amount_usd_minor is BIGINT minor units; transactions.partial_paid_usd
-- is NUMERIC dollars (memory gotcha). Convert payments to dollars for comparison.
CREATE OR REPLACE VIEW public.v_transaction_payment_drift AS
SELECT
    t.id AS transaction_id,
    t.invoice_ref,
    t.shipowner_id,
    s.name AS shipowner_name,
    t.tax_amount_usd,
    t.partial_paid_usd AS reported_paid_usd,
    COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0 AS computed_paid_usd,
    t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0) AS drift_usd
FROM public.transactions t
LEFT JOIN public.payments p ON p.transaction_id = t.id
LEFT JOIN public.shipowners s ON s.id = t.shipowner_id
WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT')
GROUP BY t.id, t.invoice_ref, t.shipowner_id, s.name, t.tax_amount_usd, t.partial_paid_usd
HAVING ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) > 0.01
ORDER BY ABS(t.partial_paid_usd - (COALESCE(SUM(p.amount_usd_minor) FILTER (WHERE p.status = 'CONFIRMED'), 0) / 100.0)) DESC;

-- Grant SELECT to service_role for admin dashboard / Grafana use.
GRANT SELECT ON public.v_payments_initiated_overdue TO service_role;
GRANT SELECT ON public.v_stripe_webhook_failures TO service_role;
GRANT SELECT ON public.v_wallet_balance_drift TO service_role;
GRANT SELECT ON public.v_transaction_payment_drift TO service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_payments_initiated_overdue;
-- DROP VIEW IF EXISTS public.v_stripe_webhook_failures;
-- DROP VIEW IF EXISTS public.v_wallet_balance_drift;
-- DROP VIEW IF EXISTS public.v_transaction_payment_drift;
```

### Tests — `supabase/tests/migrations/067_invariant_views.test.sql`

1. All 4 views exist (pg_views lookup)
2. Empty DB → all 4 views return 0 rows (sanity)
3. Seed a payment INITIATED with `created_at = NOW() - 25h` → `v_payments_initiated_overdue` returns 1 row
4. Seed a STRIPE payment with status=REJECTED + rejected_reason='Stripe: card declined' → `v_stripe_webhook_failures` returns 1 row
5. Seed a wallet with `balance_usd_minor=1000` and a ledger row of `+500` → `v_wallet_balance_drift` returns 1 row with drift=500 (1000 reported - 500 computed)
6. Seed a transaction with `partial_paid_usd=30000` and a single CONFIRMED payment of `2500000` minor (=25000 dollars) → `v_transaction_payment_drift` shows drift=5000

**Test runner**: `./supabase/tests/run.sh migrations/067_invariant_views.test.sql`. **DEFERRED if Docker still broken** — match the 7E/7F/7G precedent (9 migs now pending: 060-067).

---

## Task 2 — `frontend/src/lib/logger.ts`

### File: `frontend/src/lib/logger.ts`

```ts
/**
 * Structured JSON logger for server-side observability.
 *
 * Use at every meaningful state transition in payment / wallet / refund
 * server actions, cron routes, and webhook handlers. Emits to stdout
 * which Vercel captures via its log drain.
 *
 * Format:
 *   { ts, level, scope, event, ...context }
 *
 * Levels: 'debug' | 'info' | 'warn' | 'error'
 * Scope: short identifier of the call site (e.g. 'confirmPayment', 'stripe-webhook')
 * Event: snake_case verb describing what happened ('payment_confirmed', 'wallet_drift_detected')
 *
 * Sensitive data: NEVER log raw IBAN, full email body, JWT tokens, full
 * Stripe API responses (truncate stripe payloads to ids + status).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    ts: string;
    level: LogLevel;
    scope: string;
    event: string;
    [key: string]: unknown;
}

function emit(entry: LogEntry): void {
    // Single-line JSON for Vercel log drains and `vercel logs` CLI.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
}

export function log(
    level: LogLevel,
    scope: string,
    event: string,
    context: Record<string, unknown> = {},
): void {
    emit({
        ts: new Date().toISOString(),
        level,
        scope,
        event,
        ...context,
    });
}

export const logger = {
    debug: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('debug', scope, event, ctx),
    info: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('info', scope, event, ctx),
    warn: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('warn', scope, event, ctx),
    error: (scope: string, event: string, ctx?: Record<string, unknown>) =>
        log('error', scope, event, ctx),
};

/**
 * Helper for scoped loggers: `const log = scopedLogger('confirmPayment')`.
 * All calls auto-fill scope.
 */
export function scopedLogger(scope: string) {
    return {
        debug: (event: string, ctx?: Record<string, unknown>) => log('debug', scope, event, ctx),
        info: (event: string, ctx?: Record<string, unknown>) => log('info', scope, event, ctx),
        warn: (event: string, ctx?: Record<string, unknown>) => log('warn', scope, event, ctx),
        error: (event: string, ctx?: Record<string, unknown>) => log('error', scope, event, ctx),
    };
}
```

### Tests — `frontend/src/lib/logger.test.ts`

- Captures console.log via `vi.spyOn(console, 'log')`
- `logger.info('a', 'b', {foo: 1})` emits a single JSON line with the right fields
- `scopedLogger('confirmPayment').error('payment_rejected', {id: 'x'})` includes the scope
- Timestamps are ISO 8601
- Multiple calls don't share mutable state

---

## Task 3 — Wire logger into 5 critical server actions

### Targets

| Action | Plan origin | Events to log |
|---|---|---|
| `confirmPayment` | 7C-1 (merged) | `payment_confirmed`, `payment_overpayment_to_wallet`, `receipt_generation_failed` (warn), `notification_dispatch_failed` (warn) |
| `rejectPayment` | 7C-1 (merged) | `payment_rejected` |
| `applyWallet` | 7C-1 (merged) | `wallet_applied`, `wallet_insufficient_funds` (warn) |
| `executeRefund` | 7G (PR #28 — branch dependency) | `refund_executed`, `refund_wallet_ledger_inserted`, `refund_stripe_api_failed` (error) |
| `adjustWalletManually` | 7E (PR #26 — branch dependency) | `wallet_manually_adjusted` |

### Pattern

In each action:
```ts
import { scopedLogger } from '@/lib/logger';
const log = scopedLogger('confirmPayment');

// At entry (info — debugging the happy path)
log.info('action_invoked', { paymentId, userId: actor.id });

// On state transition success (info — operational record)
log.info('payment_confirmed', { paymentId, amountUsd, rail, transactionId });

// On fail-soft branch (warn — should not block, but operator should know)
log.warn('receipt_generation_failed', { paymentId, error: err.message });

// On hard failure that the action returns (error — needs investigation)
log.error('payment_confirm_db_error', { paymentId, error: err.message });
```

**Do NOT log**:
- Full request bodies (file uploads, IBAN, full Stripe API responses)
- JWT tokens or session cookies
- Personal email bodies

**DO log**:
- IDs (payment, transaction, shipowner)
- Status transitions (`from → to`)
- Amount + currency + rail (not bank account numbers)
- Error message (Error.message only, not the full stack — Vercel captures stacks separately on uncaught errors)

### Constraint — branch dependency

Tasks for `executeRefund` (Plan 7G) and `adjustWalletManually` (Plan 7E) can't be done on this branch if those PRs aren't merged. **Decision**: include the wiring for them in this plan, gated on:
- (a) If a fresh `git fetch origin develop` shows 7E/7G merged before Task 3 execution: wire them.
- (b) If not: wire only the 3 merged actions (confirmPayment, rejectPayment, applyWallet), and document the remaining 2 as TODO comments in the corresponding `executeRefund.ts` / `adjustWalletManually.ts` once those branches eventually rebase against 7H-3's logger.

The subagent executing Task 3 verifies the merge state first.

### Tests

The existing action tests should keep passing (logger is fire-and-forget; mock console.log if needed to silence test output). Each wired action gets 1 small test assertion that calls `vi.spyOn(console, 'log')` and verifies a specific event was logged on the happy path.

---

## Task 4 — Wire logger into cron + webhook surfaces

### Targets

| Surface | Plan origin | Events to log |
|---|---|---|
| `/api/cron/notification-email-loop` | 7H-1 (merged) | `cron_run_start`, `email_dispatched`, `email_dispatch_failed` (warn), `cron_run_complete` with counts |
| `/api/cron/stripe-refund-reconcile-pending` | 7H-1 (merged) | `cron_run_start`, `refund_reconciled`, `stripe_api_failed` (warn), `cron_run_complete` with counts |
| Stripe webhook `handlePaymentSucceeded` | 7D (merged) | `webhook_payment_succeeded`, `receipt_email_failed` (warn) |
| Stripe webhook `handlePaymentFailed` | 7F (merged) | `webhook_payment_failed` |
| Stripe webhook `handleChargeRefunded` | 7G (branch dependency) — wire only if 7G merged | `webhook_charge_refunded`, `refund_reconciled_by_webhook` |

### Pattern

Each cron route already has counters (`processed`, `succeeded`, etc.) at the end. Add a single `log.info('cron_run_complete', counts)` after the response calculation.

For per-row events inside the loop: `log.debug('row_processed', {id, kind, action})` — debug level so they don't flood production logs at info level, but available if log retention captures debug.

Webhook handlers: log at entry (`log.info('event_received', {eventType, eventId})`), at each branch outcome, and at the unhandled-default case.

### Tests

Existing cron + webhook tests probably mock `console.log` already (or don't care about it). Add minimal assertions: 1 test per surface that verifies a specific event was logged on the success path.

---

## Task 5 — Canary rollout runbook

### File: `docs/runbooks/2026-canary-rollout-shipowner-portal-v1.md`

### Structure

```markdown
# Shipowner Portal v1 — Canary Rollout Runbook

> Authoritative runbook for the J+0 → J+21 rollout of Plan 7 phases A–H to production.
> Owner: Loïc Leclerc. Last updated: 2026-05-13.
> Master spec §12.3.

## 1. Pre-flight checklist (before any flag toggle)

### 1.1 Migrations pushed to hosted
- Confirm `supabase migration list` shows local == hosted for migrations 060-067 (9 migs Phase 7).
- If partial state: use the diagnostic pattern from `2026-04-25` push (memory).

### 1.2 Vercel env vars set
- `STRIPE_SECRET_KEY` (TEST mode keys until J+14)
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### 1.3 Feature flags initial state (all false)
Query: `SELECT key, value FROM app_config WHERE key LIKE 'feature.%' ORDER BY key;`
Expected: all 5 portal flags = false (or absent — read-side default false).

### 1.4 Cron schedules visible in Vercel
- /api/cron/overdue-alerts (daily 09:00 UTC)
- /api/cron/notification-email-loop (daily 09:00 UTC)
- /api/cron/stripe-reconcile-pending (every 15min)
- /api/cron/stripe-refund-reconcile-pending (every 15min)

## 2. Staging smoke (run BEFORE prod toggle)

### 2.1 Toggle ALL flags ON
SQL (run in staging Supabase):
```sql
INSERT INTO app_config (key, value) VALUES
('feature.shipowner_portal_v1_enabled', 'true'::jsonb),
('feature.shipowner_self_service_enabled', 'true'::jsonb),
('feature.online_payment_stripe_enabled', 'true'::jsonb),
('feature.wallet_topup_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

### 2.2 Manual smoke checklist
- [ ] /owner/register flow (form submits, account created)
- [ ] /owner/login magic link arrives
- [ ] /owner/dashboard loads
- [ ] /owner/invoices shows seeded proforma
- [ ] PayDialog WIRE flow submits payment proof
- [ ] Admin /admin/payments confirms payment
- [ ] Receipt PDF emailed (check Resend dashboard)
- [ ] /owner/wallet balance updates after overpayment

### 2.3 Run Playwright smoke
`cd frontend && npm run e2e` — expect scenarios 01 + 02 green.

### 2.4 Run invariant queries
```sql
SELECT * FROM v_payments_initiated_overdue LIMIT 10;
SELECT * FROM v_wallet_balance_drift LIMIT 10;
SELECT * FROM v_transaction_payment_drift LIMIT 10;
SELECT * FROM v_stripe_webhook_failures LIMIT 10;
```
Expected: each returns 0 rows on a clean staging DB. Investigate any drift before proceeding.

## 3. J+0 — Prod canary start

### 3.1 Toggle master flag only
```sql
INSERT INTO app_config (key, value) VALUES
('feature.shipowner_portal_v1_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```
All other flags remain false. Portal is reachable but Stripe / topup / self-service are gated off.

### 3.2 Invite 2-3 known shipowners
- Use the existing admin invite flow at `/admin/registrations` (Plan 7B)
- Send manual onboarding emails referencing the portal URL

### 3.3 Daily monitoring (J+0 through J+7)
**Every morning**:
```sql
-- Stuck payments
SELECT COUNT(*) FROM v_payments_initiated_overdue;  -- alarm if > 5

-- Webhook failures
SELECT COUNT(*) FROM v_stripe_webhook_failures;     -- alarm if > 0

-- Ledger drift
SELECT COUNT(*) FROM v_wallet_balance_drift;        -- alarm if > 0 (IMMEDIATE — money correctness)

-- Transaction payment drift
SELECT COUNT(*) FROM v_transaction_payment_drift;   -- alarm if > 0 (IMMEDIATE — money correctness)
```

**Vercel logs scan** (every morning):
```bash
# In Vercel dashboard → Logs filter:
level:error OR event:wallet_drift_detected OR event:refund_stripe_api_failed
```

## 4. J+7 — Enable wallet top-up

After 7 days of clean canary metrics:

```sql
INSERT INTO app_config (key, value) VALUES
('feature.wallet_topup_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

Smoke: have one canary owner top up $100. Verify wallet_ledger TOPUP entry, balance updated, no drift in v_wallet_balance_drift.

## 5. J+14 — Enable Stripe

**Prerequisites**:
- UK Stripe entity confirmed live
- Replace TEST keys with LIVE keys in Vercel env

```sql
INSERT INTO app_config (key, value) VALUES
('feature.online_payment_stripe_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

Smoke: one canary owner pays one proforma via Stripe ($100 test). Verify:
- payments row → CONFIRMED
- v_stripe_webhook_failures = 0
- Receipt emailed
- PAYMENT_RECEIVED notification dispatched

## 6. J+21 — Enable self-service public signup

```sql
INSERT INTO app_config (key, value) VALUES
('feature.shipowner_self_service_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
```

Monitor for spam wave (per master spec §13 risks). If signup rate > 50/day with high admin-rejection rate: re-disable + revert to invite-only.

## 7. Rollback procedures

### 7.1 Master kill switch (soft rollback — no DB change)
```sql
UPDATE app_config SET value = 'false'::jsonb 
WHERE key = 'feature.shipowner_portal_v1_enabled';
```
Middleware redirects /owner/* to /login within 60s (TTL cache).
Existing in-session work continues until cookie expires.

### 7.2 Sub-flag rollback (targeted)
Toggle individual sub-flag false to disable a single rail / feature without taking down the portal.

### 7.3 Migration rollback (hard)
Each mig 060-067 has a `-- DOWN:` block in comments. Apply via `psql` directly. Order matters (LIFO):
1. 067 → DROP VIEW
2. 066 → DROP TRIGGER + DROP CONSTRAINT + ALTER COLUMN refund_rail SET NOT NULL
3. 065 → DROP cron job + DROP FUNCTION
4. 064 → DROP TRIGGER
5. 063 → DROP INDEX
6. 062 → re-CREATE shipowner_payment_intents (data loss — avoid this)
7. 061 → ALTER TABLE DROP COLUMN (3 cols)
8. 060 → re-CREATE UNIQUE INDEX + ALTER TABLE DROP COLUMN

**Avoid rollback past mig 062** — data loss. Prefer master flag rollback + hotfix forward.

## 8. Feature flag toggle reference (quick)

| Flag | Effect | Toggle ON timing |
|---|---|---|
| `feature.shipowner_portal_v1_enabled` | Master switch — middleware allows /owner/* | J+0 |
| `feature.shipowner_self_service_enabled` | /owner/register accepts public signups | J+21 |
| `feature.online_payment_stripe_enabled` | STRIPE rail appears in PayDialog | J+14 |
| `feature.wallet_topup_enabled` | Top-up CTA + topup mode in PayDialog | J+7 |
| `feature.notification_sms_enabled` | Dormant — never toggled in v1 | Never |

Admin UI for toggles: /admin/tax-settings → "Carbon Tax Pipeline" section.

## 9. Invariant queries quick-reference

Copy-paste ready. Run daily during canary, then weekly post-J+21.

[4 SQL queries inlined]

## 10. Common debugging

- **Owner sees "portal disabled" banner**: middleware cache TTL = 60s; check `feature.shipowner_portal_v1_enabled` is `true::jsonb` (not `'true'::text`).
- **Stripe payment confirmed but no receipt**: check Vercel logs `scope:confirmPayment event:receipt_generation_failed`. The receipt service is fail-soft so payment state is correct.
- **Wallet drift detected**: read the `wallet_ledger` for the affected wallet_id; identify the offending entry; manual adjustment via `adjustWalletManually` (requires SUPERADMIN + justification).
- **CRON not running**: Vercel Crons dashboard → check last run + next run. CRON_SECRET env must be set in Vercel project (the cron route 401s if not set per Plan 7H-1 fix).
- **E2E tests failing on cookie injection**: scenario 02 most likely; verify @supabase/ssr version is 0.9.x.

## 11. Escalation

- Money-correctness alarm (wallet drift, transaction drift): page Loïc immediately.
- Stripe integration outage: defer Stripe canary until UK entity confirms.
- Mass-signup spam wave: re-disable self-service + write follow-up plan.
```

The runbook is ~200 lines of markdown. Concrete, copy-paste-ready, single source of truth for the canary.

---

## Task 6 — Final gates + commit + PR + memory

1. `tsc --noEmit` clean
2. `vitest run` green (expect a few new tests for logger + wired actions; no regressions)
3. `next build` green — no new routes; expect unchanged route count
4. `feature-dev:code-reviewer` over full diff
5. Apply final-review fixes inline
6. Push branch, open PR #31 against develop
7. Update memory with Plan 7H-3 entry (closes Phase H)

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Logger emits sensitive data accidentally | Low | High | Pattern enforced in plan: IDs + statuses + Error.message only. Code review explicitly checks each wired call site. |
| Views perform poorly on large data (full SUM aggregates) | Low | Med | Views aggregate over `wallet_ledger` (append-only, partitioned by wallet_id) and `payments`. Both have indices on the FK + status columns. Acceptable for v1 volume; revisit if perf surfaces. |
| Runbook drift after the first canary | Med | Med | Append "post-canary updates" section after J+21 with lessons learned. Live document, not a one-shot artifact. |
| `executeRefund` / `adjustWalletManually` not yet on develop when Task 3 runs | Med | Low | Task 3 subagent checks `git log` for those actions; wires the available ones, leaves TODO for the rest. |
| Mig 067 pg test deferred due to Docker | High | Low | Document in commit; ops verifies on hosted post-push. Carries 7E/7F/7G precedent. |

---

## Acceptance criteria

- 4 invariant views queryable in Supabase Studio with the documented SQL
- Logger emits structured JSON for at least 3 server actions + 2 cron routes + 3 webhook handlers
- Canary runbook reads top-to-bottom as a runnable script (no missing steps, no TBD markers)
- All Phase H goals from master spec §12 addressed across 7H-1 / 7H-2 / 7H-3
- Local gates: tsc clean, vitest green, next build green
- No new `as any` in production code

---

## What Phase H closes

After 7H-3 merges, Phase H is complete:
- 7H-1: feature flags + 2 close-the-loop crons (PR #29 — MERGED)
- 7H-2: Playwright smoke suite (PR #30 — open)
- 7H-3: monitoring + canary runbook (this PR)

Master spec §12 (rollout) + §12.4 (monitoring) + §12.5 (rollback) — all documented.

**Plan 7 complete after 7E (PR #26) + 7G (PR #28) + 7H-2 (PR #30) + 7H-3 (this PR) merge.** Production canary can begin immediately after merge.

---

*Authored 2026-05-13. Cadrage locked. Ready for subagent-driven execution.*
