# E2E Tests (Playwright)

Browser-driven smoke suite for the AfricGreen frontend. Targets the real Next.js dev server and hits the (currently hosted) Supabase project. Tests run sequentially, share the DB, and clean up after themselves.

## Quick start

```bash
cd frontend
npm run e2e                 # run all scenarios against http://localhost:3300
npm run e2e -- 01           # run only scenarios with "01" in their filename
npm run e2e:ui              # interactive watch mode (Playwright UI)
npm run e2e:debug           # step-through debugger
```

## Prerequisites

- `frontend/.env.local` with at least
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

  Currently this points to the hosted Supabase project — see project memory.
- Chromium binary installed once via `npx playwright install chromium` (~150 MB).
- Dev server: started automatically by `playwright.config.ts.webServer` running `npm run dev` on port 3300. If you already have it running, Playwright reuses it (`reuseExistingServer: true`). Set `E2E_NO_SERVER=1` to opt out (useful when pointing `E2E_BASE_URL` at a remote preview deploy).

## Test isolation strategy

- Sequential execution — `workers: 1`, `fullyParallel: false`. Tests share rows on a real database, so parallel runs would race.
- Per-test cleanup — each test calls `registerCleanup(fn)` immediately after creating a resource. The `afterEach` hook drains the queue LIFO, so child rows are removed before their parents and FK constraints stay happy. Cleanup runs even on test failure (best-effort; errors are logged, not thrown).
- Identifiable test data — strings use the prefix `e2e-{timestamp}-{nanoid}` (via `uniqueTag()`), emails end in `@e2e.test`, IMOs start with `9` (via `fakeImo()`). A weekly orphan sweep query against these prefixes is part of the Plan 7H-3 runbook.

## CI integration

Not wired into CI in v1. Manual runs only — Vercel preview builds and PR merges do not trigger Playwright. The intent is to add a nightly GitHub Actions workflow as a follow-up.

## Cookie shape (auth bootstrap)

`helpers/auth.ts` programmatically mints sessions via the Supabase admin API and writes the `@supabase/ssr` auth cookie directly. The cookie format was reverse-engineered from `node_modules/@supabase/ssr/dist`:

- Name: `sb-${projectRef}-auth-token` where `projectRef` is the first label of `NEXT_PUBLIC_SUPABASE_URL`.
- Value: `base64-${base64url(JSON.stringify(sessionPayload))}` — the literal prefix `base64-` is hard-coded.
- Payload mirrors the supabase-js Session shape (`access_token`, `refresh_token`, `expires_at`, `user`, …).

If the cookie format ever drifts (e.g. a new `@supabase/ssr` release changes `cookieEncoding`), the symptom is 401s on every authed nav. Fall back to `request.fetch()` with `authedHeaders()` for API-level checks until the cookie helper catches up.

## Scenarios

| #   | Status   | Description                                                                                            | Plan deps             |
| --- | -------- | ------------------------------------------------------------------------------------------------------ | --------------------- |
| 00  | active   | Smoke: config loads, dev server is reachable                                                            | —                     |
| 01  | active   | Signup auto-claim — owner registers, IMO matches GHOST shipowner, account auto-activates                | 7B                    |
| 02  | active   | Wire payment happy path — owner declares wire via PayDialog, admin confirms in /admin/payments, payment row flips to CONFIRMED + PAYMENT_RECEIVED owner_notifications row | 7C-1, 7C-2, 7C-3, 7F |
| 03  | skipped  | Refund WALLET happy path — placeholder + TODO; unskip when Plan 7G (PR #28) merges                      | 7G                    |

### Backlog (master spec §11.3)

Deferred for post-v1 — listed here so future contributors know what slots remain unfilled:

1. ~~Signup auto-claim~~ — active (scenario 01)
2. Signup review path (admin approves a `PENDING_REVIEW` shipowner)
3. KYC C wizard
4. Stripe payment happy path (mocked webhook)
5. ~~Wire payment happy path~~ — active (scenario 02)
6. Partial payment (two wires, half each)
7. Overpayment Stripe → wallet credit
8. Wallet topup + auto-apply
9. ~~Refund WALLET happy path~~ — skipped placeholder (scenario 03)
10. RLS isolation (direct DB)
11. Multi-currency EUR

## Anti-patterns

- Do NOT enable `fullyParallel: true` without per-test DB-schema isolation (or a separate test DB). Sequential is a load-bearing assumption.
- Do NOT skip cleanup. Orphan data accumulates and slows the hosted DB over time. If a test exits early, the `afterEach` still drains the queue — but only if cleanup was registered.
- Do NOT use real owner emails or production-shaped data in tests. Stick to the `e2e-*@e2e.test` and `9*` IMO conventions so the sweep query is reliable.
- Do NOT mutate `wallet_ledger` rows in cleanup directly — there's a `prevent_ledger_mutation` trigger (mig 050). Delete the parent (wallets / shipowner) or rely on FK cascades.
