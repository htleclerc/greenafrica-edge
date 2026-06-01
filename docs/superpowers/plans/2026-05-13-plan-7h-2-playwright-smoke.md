# Plan 7H-2 — Playwright E2E smoke suite

> **Phase H sub-plan 2.** Installs Playwright, builds the auth + fixture + cleanup harness, and ships 3 critical happy-path E2E scenarios. The remaining 8 scenarios from master spec §11.3 are documented as a follow-up backlog — the harness here makes adding them straightforward.
>
> Successor plan: **7H-3** (monitoring + canary runbook). Closes Phase H.

---

## Cadrage (locked)

| Decision | Choice |
|---|---|
| Scope | Setup + 3 smoke scenarios (out of 11 in spec §11.3) |
| Base branch | `develop` (parallel to PRs #26/#28/#29 — does not require them merged) |
| Test database | Hosted Supabase via existing `.env.local`; isolated via UUID-prefixed test data + aggressive cleanup |
| Auth strategy | Direct session bootstrap via Supabase admin API (`auth.admin.createUser` + `auth.admin.generateLink`) — no UI login flow |
| CI integration | npm script `e2e` defined; **not added to PR CI** (manual / nightly only — Playwright + headless browser in CI is its own infra setup, deferred to 7H-3 if needed) |
| Scenario picks (3 of 11) | (1) Signup auto-claim, (2) Wire payment happy path, (3) Refund WALLET happy path |

---

## Why these 3 scenarios

- **Signup auto-claim** — exercises Plan 7B onboarding + the most-likely high-volume new-owner path
- **Wire payment happy path** — exercises Plan 7C-1/2/3 (the heart of the payment system) + Plan 7C-4 receipt generation
- **Refund WALLET happy path** — exercises Plan 7G refunds + mig 050 wallet_ledger trigger (the riskiest money-mutation surface)

Each scenario touches a different vertical slice of the portal, giving us confidence the cross-system integration works.

**Note on dependencies**: scenario 3 (Refund WALLET) requires Plan 7G's `executeRefund` action which is on PR #28 (not yet merged). The test is written but **marked `test.skip()` with a TODO** until 7G merges. The harness is exercised by the first 2 scenarios.

---

## Out of scope

- 8 deferred scenarios from spec §11.3 (KYC C wizard, Stripe payment, partial payment, overpayment→wallet, wallet topup+auto-apply, RLS isolation, multi-currency EUR — backlog for post-v1)
- CI integration of Playwright into the PR pipeline (manual `npm run e2e` only for v1)
- Visual regression tests
- Cross-browser matrix (Chromium only)
- Mobile viewport tests

---

## Task list

1. **Install Playwright + base config** (`@playwright/test`, `playwright.config.ts`, `npm run e2e` script)
2. **`e2e/helpers/auth.ts`** — programmatic session bootstrap
3. **`e2e/helpers/fixtures.ts`** + **`e2e/helpers/cleanup.ts`** — seed + teardown harness
4. **Scenario 1**: `e2e/scenarios/01-signup-auto-claim.spec.ts`
5. **Scenario 2**: `e2e/scenarios/02-wire-payment.spec.ts`
6. **Scenario 3 (skipped pending 7G merge)**: `e2e/scenarios/03-refund-wallet.spec.ts`
7. **`e2e/README.md`** — how to run, env requirements, test isolation guarantees, scenario backlog
8. **Final gates** — `tsc --noEmit` clean (no new TS errors), full vitest still green, manual `npm run e2e` proves the 2 active scenarios pass

---

## Task 1 — Install Playwright + base config

### Dependency install

In `frontend/`:
```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

`playwright install` fetches the chromium binary into the local cache. CI would need the same — out of scope.

### `frontend/playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/scenarios',
  timeout: 30_000,            // per-test timeout
  expect: { timeout: 5_000 }, // per-assertion timeout
  fullyParallel: false,        // tests share DB rows — keep sequential
  retries: 0,                  // expose flakes; don't paper over
  workers: 1,                  // see fullyParallel
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3300',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  webServer: process.env.E2E_NO_SERVER === '1' ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3300',
    timeout: 60_000,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

### `package.json` scripts

Add:
```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui",
"e2e:debug": "playwright test --debug"
```

### `.gitignore` additions

```
/test-results/
/playwright-report/
/playwright/.cache/
```

---

## Task 2 — `e2e/helpers/auth.ts`

### Purpose

Most scenarios need to be "logged in as a specific shipowner" without going through the magic-link UI (which would require email interception). Use Supabase's admin API to mint a session directly.

### Signature

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface TestSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function createTestUser(opts: {
  email: string;
  role?: 'SHIPOWNER' | 'FINANCE_ADMIN' | 'SUPERADMIN' | 'PORT_OFFICER';
  shipownerId?: string;  // attach profile to this shipowner row
}): Promise<TestSession>;

export async function authedRequest(session: TestSession): Promise<{
  Authorization: string;
  Cookie: string;
}>;

/**
 * Set the supabase-auth cookies on the page so subsequent navigations
 * are authenticated. Call before page.goto() in beforeEach.
 */
export async function setSessionCookies(page: Page, session: TestSession): Promise<void>;

export async function deleteTestUser(userId: string): Promise<void>;
```

### Implementation notes

- Service-role admin client: `createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` with `auth.admin` namespace.
- `createTestUser` flow:
  1. `auth.admin.createUser({ email, password: randomString, email_confirm: true })` → returns user with id
  2. INSERT a `profiles` row with the given role
  3. If `shipownerId` passed: UPDATE `shipowners.profile_id = user.id`
  4. Use `auth.admin.generateLink({ type: 'magiclink', email })` to get a session-creating URL OR sign in via password
  5. Extract access/refresh tokens
- `setSessionCookies(page, session)` writes the Supabase-formatted auth cookies (`sb-${project_ref}-auth-token`) on the page context.
- `deleteTestUser` cleans up: DELETE the profile row, then `auth.admin.deleteUser(userId)`.

### Naming convention

All test data uses `e2e-{timestamp}-{nanoid}` prefixes so cleanup can sweep by pattern if needed.

---

## Task 3 — Fixtures + Cleanup

### `e2e/helpers/fixtures.ts`

```ts
export interface TestShipowner {
  id: string;
  imoCompanyNo: string;
  name: string;
  email: string;
  state: 'GHOST' | 'PENDING_REVIEW' | 'ACTIVE';
}

export interface TestVessel {
  id: string;
  imoNumber: string;
  name: string;
  shipownerId: string | null;
}

export interface TestTransaction {
  id: string;
  invoiceRef: string;
  vesselId: string;
  shipownerId: string;
  documentType: 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND';
  taxAmountUsd: number;
  status: string;
}

export async function seedShipowner(opts: Partial<TestShipowner>): Promise<TestShipowner>;
export async function seedVessel(opts: Partial<TestVessel>): Promise<TestVessel>;
export async function seedProforma(opts: { shipownerId: string; vesselId: string; amountUsd: number }): Promise<TestTransaction>;
export async function ensurePortalEnabled(): Promise<void>;  // UPSERTs feature.shipowner_portal_v1_enabled=true
export async function ensureSelfServiceEnabled(): Promise<void>;
```

### `e2e/helpers/cleanup.ts`

Each test owns its data. Pattern:

```ts
const cleanupHandles: Array<() => Promise<void>> = [];

export function registerCleanup(fn: () => Promise<void>): void {
  cleanupHandles.push(fn);
}

export async function runCleanup(): Promise<void> {
  while (cleanupHandles.length) {
    const fn = cleanupHandles.shift()!;
    try { await fn(); } catch (e) { console.warn('[cleanup]', e); }
  }
}
```

Tests call `registerCleanup(() => deleteShipowner(s.id))` inline; the test's `afterEach` runs `runCleanup()`.

---

## Task 4 — Scenario 1: Signup auto-claim

### `e2e/scenarios/01-signup-auto-claim.spec.ts`

**Setup**:
1. `ensurePortalEnabled()` + `ensureSelfServiceEnabled()`
2. Seed a GHOST shipowner: `imo_company_no='9999001'`, `state='GHOST'`, no profile linked.
3. Seed a vessel for that shipowner: `imo='9999001'` (vessel IMO ≠ company IMO in real data, but our auto-claim matches on `imo_company_no` per Plan 7B).

**Test**:
1. `page.goto('/owner/register')`
2. Fill the form:
   - Company name: matching the GHOST row
   - IMO company number: `9999001`
   - Email: `e2e-{timestamp}@e2e.test`
   - Password / other required fields
3. Submit
4. **Assert**: redirect to a confirmation page (specific URL pattern from Plan 7B)
5. Read the shipowners row from DB: state should now be `ACTIVE` (auto-claim succeeded since IMO matched)
6. The profile should be linked.

**Cleanup**: delete the profile + the shipowner + the vessel + the auth.user.

---

## Task 5 — Scenario 2: Wire payment happy path

### `e2e/scenarios/02-wire-payment.spec.ts`

**Setup**:
1. `ensurePortalEnabled()`
2. Seed an ACTIVE shipowner (with profile_id) + vessel + proforma transaction ($30,000 USD).
3. Seed a FINANCE_ADMIN user for the admin half of the flow.

**Test (owner side, first context)**:
1. `setSessionCookies(page, shipownerSession)`
2. `page.goto('/owner/invoices')`
3. Click the proforma row → PayDialog opens
4. PayDialog step 1: pick WIRE_TRANSFER rail → step 2: fill bank reference + upload a tiny PDF as proof → step 3: confirm
5. **Assert**: dialog closes, success toast appears
6. **Assert via DB**: a `payments` row exists with `rail='WIRE_TRANSFER'`, `status='INITIATED'`, transaction_id matches the proforma.

**Test (admin side, second context)**:
1. `setSessionCookies(adminPage, adminSession)`
2. `adminPage.goto('/admin/payments')`
3. Find the new INITIATED payment → click → drawer opens
4. Click "Confirm"
5. **Assert via DB**: payment row `status='CONFIRMED'`, `confirmed_by` set
6. **Assert via DB**: a `payment_receipts` row exists (Plan 7C-4 hook)
7. **Assert via DB**: an `owner_notifications` row with `kind='PAYMENT_RECEIVED'` exists for the shipowner

**Cleanup**: delete payment + transaction + shipowner + vessel + 2 users + the receipt + the notification.

---

## Task 6 — Scenario 3: Refund WALLET happy path (skipped pending 7G merge)

### `e2e/scenarios/03-refund-wallet.spec.ts`

**Top of file**:
```ts
import { test } from '@playwright/test';

test.describe.skip('Refund WALLET happy path', () => {
  // TODO: unskip when PR #28 (Plan 7G) merges into develop.
  // Depends on:
  //  - mig 066 (auto-INSERT refunds trigger)
  //  - approveRefund / executeRefund server actions
  //  - /admin/refunds page
```

**Setup**:
1. Seed ACTIVE shipowner + vessel + a CONFIRMED payment.
2. Manually INSERT a REFUND transaction (mig 066 trigger should auto-create the refunds row).
3. Seed FINANCE_ADMIN.

**Test**:
1. `setSessionCookies(adminPage, adminSession)`
2. `adminPage.goto('/admin/refunds')`
3. Click the REQUESTED row → drawer opens
4. Pick WALLET rail → click "Refund to wallet"
5. **Assert**: refunds.status='EXECUTED', executed_by set
6. **Assert**: a wallet_ledger row with kind='REFUND_CREDIT' exists
7. **Assert**: wallets.balance_usd_minor increased by the refund amount
8. **Assert**: owner_notifications row with kind='REFUND_ISSUED' exists

**Cleanup**: comprehensive — ledger row, refund row, REFUND transaction, payment, shipowner, vessel, user, notification.

---

## Task 7 — `e2e/README.md`

Document:
- Prerequisites: hosted Supabase env in `.env.local`, `CRON_SECRET` not needed
- How to run: `npm run e2e` from `frontend/`
- How to run a single test: `npx playwright test 01-signup`
- How to inspect failures: `npx playwright show-report`
- Test isolation: each test owns its data; cleanup runs in `afterEach`
- Manual run only: not in CI for v1
- Backlog: the 8 deferred scenarios from spec §11.3 (numbered list with brief notes per scenario)
- Anti-patterns: do NOT enable `fullyParallel` without per-test DB schema isolation

---

## Task 8 — Final gates

- `tsc --noEmit` clean (new e2e/ files use their own tsconfig, but inheritance from the root tsconfig means types stay strict)
- `vitest run` — full unit suite still green (Playwright is dev-only; no production code changes)
- `npx playwright test 01 02` — both active scenarios pass against the local dev server
- Manual confirmation: trace artifacts captured on a deliberate failure injection (to verify the screenshot/video machinery works)

**Note**: scenario 3 stays `.skip()` — `playwright test` reports it as skipped. PR description documents the unskip path.

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tests pollute hosted Supabase with orphan data on failure | Med | Low | UUID-prefixed test data + log-only cleanup; weekly sweep query in 7H-3 runbook |
| Auth bootstrap brittleness (admin API signature drift) | Low | Med | Pin `@supabase/supabase-js` version in `package.json`; document the expected admin API methods in the helper |
| Magic-link generation rate limits on hosted Supabase | Low | Low | Use password-based test users instead of magic links — admin API allows password set on createUser |
| Race between test setup and dev server hot reload | Med | Low | `webServer.reuseExistingServer: true` + retries on the first navigation in each test |
| Scenario 3 unskip forgotten after 7G merges | Med | Med | PR description has a checklist item; add a follow-up issue or comment in MEMORY.md |
| Playwright binary install size in dev env (~150MB) | Low | Low | Add to `.gitignore`; document in README |

---

## Acceptance criteria

- `npm run e2e` from `frontend/` runs Chromium tests against `localhost:3300`
- Scenarios 1 and 2 pass green
- Scenario 3 is skipped with a clear TODO
- `e2e/README.md` documents prerequisites + the 8 deferred scenarios
- No regressions in unit tests (vitest still 450+ passing)
- No new `as any` in production code (test code is exempt for mock chains)

---

*Authored 2026-05-13. Cadrage locked. Ready for subagent-driven execution.*
