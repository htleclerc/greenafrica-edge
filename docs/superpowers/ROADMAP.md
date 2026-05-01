# Carbon Tax Pro-Forma — Project Roadmap

**Last updated**: 2026-04-27 after Plan 8 v0 merged (feat/ais-global-v0)
**Master spec**: [`specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md`](specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md)

> Single pane of glass for this project. Start here when resuming in a new session.

---

## Current state

### ✅ MVP feature-complete (5 plans, 63 commits on `develop`)

| Plan | Branch (merged) | Focus | Spec status line |
|---|---|---|---|
| 1 | `feat/carbon-tax-schema-foundation` | Schema foundation (mig 023-031, RLS, seeds, tests) | "Plan 1 status" |
| 2 | `feat/carbon-tax-go-backend` | Go backend — corridor + EEZ + tax cascade + distance-final | "Plan 2 status" |
| 3 | `feat/carbon-tax-proforma-pipeline` | Pro-forma pipeline — agent-match, worker, claim UI | "Plan 3 status" |
| 4 | `feat/carbon-tax-reconciliation` | Reconciliation — DEPARTED_EEZ → FINAL/COMPLEMENT/REFUND | "Plan 4 status" |
| 5 | `feat/carbon-tax-admin-escalation` | Admin surfaces + owner escalation + A2 audit | "Plan 5 status" |
| 8 | `feat/ais-global-v0` | AIS global origin-port detection (Phase 2) | "Plan 8 status" |

### End-to-end flow that works today

```
AIS position → Go corridor.Watcher (500 NM)
  → arrival_alerts DETECTED
pg_cron agent-match (every 2 min)
  → MATCHED_AUTO (or UNCLAIMED)
  → enqueue pgmq.proforma_queue
pg_cron proforma-worker (every 1 min, via pg_net)
  → POST /api/queue/process-proforma
  → Go tax API → PROFORMA transaction + PDF + Resend email
  → PROFORMA_SENT
AIS position inside EEZ → Go eez.Tracker
  → ARRIVED
AIS position outside EEZ → Go eez.Tracker / reconcile.Sweeper
  → DEPARTED_EEZ (triggers pgmq.reconciliation_queue)
pg_cron reconciliation-worker (every 1 min)
  → POST /api/queue/process-reconciliation
  → Go distance-final RPC + tax API with real distance
  → FINAL (Δ ≤ 10%) / COMPLEMENT / REFUND transaction + PDF + email
  → RECONCILED
pg_cron unclaimed-escalation (hourly) → UNCLAIMED past SLA → ESCALATED
pg_cron unpaid-escalation (daily) → PROFORMA >= 7d arrived → stage owner_escalation_due_at
Port Officer at /admin/escalations → EscalateDialog → escalateToOwner action
  → Resend owner cover letter EN/FR with PDF attached
  → stamps transaction.escalated_to_owner_at/email/by
```

### Surfaces shipped

- **Agent**: `/dashboard/incoming-vessels` with claim dialog capturing owner email
- **Admin**: `/admin/escalations` (Unclaimed + Unpaid panels + EscalateDialog)
- **Admin**: `/admin/owner-agent-mappings` CRUD for cascade A
- **Admin**: `/admin/tax-settings` extended with pipeline config + feature flags (SUPERADMIN-gated secrets)
- **Go API**: `POST /api/v1/tax/calculate`, `GET /api/v1/alerts/:id/distance-final`, existing AIS + health

---

## Remaining work

Organized by priority and blast radius. Each item is ready to pick up in a fresh session.

### 🔥 P0 — blockers for production rollout

#### B0. CORS credentials mismatch on local Supabase (QA 2026-04-24/25 — root cause now identified)

**Problem**: `@supabase/ssr` `createBrowserClient` calls `fetch(...)` with `credentials: 'include'`. Local Supabase Kong responds with `Access-Control-Allow-Origin: *` AND `Access-Control-Allow-Credentials: true` simultaneously, which violates the CORS spec — when credentials are included, Allow-Origin MUST be a specific origin (not `*`). Browsers therefore reject the response and the fetch promise rejects with `TypeError: Failed to fetch`. The Supabase client swallows this and the UI hangs on the spinner forever.

Production-hosted Supabase echoes the Origin specifically, so this only breaks LOCAL dev, not prod.

**Verified**: manual `fetch(authUrl, {method: 'POST', headers: {...}, body: ...})` from page context returns 200 / 69ms. Adding `credentials: 'include'` to the same call → fails in 8ms with `Failed to fetch`.

**Workarounds, ranked**:
1. **Use the hosted Supabase for local dev** (the default `.env.local`). Migrate Plan 1-5 migrations to hosted via `supabase db push` so the new tables exist there too. This is the "real production-like" path.
2. **Patch local Kong** to echo the request Origin instead of `*`. Edit `~/.cache/supabase/kong-template/cors.lua` (or whichever the CLI uses) to set `Access-Control-Allow-Origin: <Origin>` from the request. Brittle — gets clobbered on `supabase` CLI upgrade.
3. **Use a CORS proxy** (e.g., a tiny Next.js API route that forwards to local Supabase) so requests look same-origin. Disposable scaffolding.
4. **Use `localhost` not `127.0.0.1`** — some Chrome versions are more lenient on `localhost` even with `*`. Worth trying first; cheapest if it works.

**Not viable**: changing the Supabase client to `credentials: 'omit'` — `@supabase/ssr` does not expose this knob, and patching it would break SSR session handling.

**Report**: [`docs/qa-reports/qa-report-africgreen-2026-04-24.md`](../qa-reports/qa-report-africgreen-2026-04-24.md)

**Fixes already merged** (from 2026-04-24 QA run):
- `5ecdc43` ISSUE-001: next-intl dotted keys in `AdminTaxPipeline.labels` crashed every route
- `8c2e5ac` ISSUE-002 + ISSUE-003: CSP hardcoded to hosted-only Supabase; seed.sql created `auth.users` with NULL `email_change` tokens

**Hosted Supabase migration push (2026-04-25)**:
- Hosted DB had partial schema state — migrations 001-008, 011-022 already applied (manually, no tracking) but 009 (`app_config`) and 010 (`eu_mrv_cache`) were missing.
- Marked 001-008, 011-022 as `applied` in remote tracking; marked 009-010 as `reverted` to re-run.
- `supabase db push --include-all` then applied 009, 010, 027-037 cleanly (15 migrations total, including the 13 from Plans 1-5).
- Found same ISSUE-003 (NULL token columns) on hosted's pre-existing `auth.users` rows. Patched in-place via `supabase db query`:
  ```sql
  UPDATE auth.users SET
    email_change = COALESCE(email_change, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    reauthentication_token = COALESCE(reauthentication_token, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, '')
  WHERE … (any IS NULL);
  ```
- After patch, manual `fetch(/auth/v1/token)` returns 200 / 414ms with full access_token. Hosted auth is functional.

**Remaining residual** — UI login flow still hangs in `browse` headless:
- `@supabase/ssr` `createBrowserClient` `signInWithPassword` never resolves in the browse-spawned Chromium even though raw fetch + token endpoint return 200.
- Cookies stay empty after the click. Real Chrome/Firefox in normal use don't have this issue (the user logs in fine in production daily).
- Hypothesis: headless Chromium cookie-write semantics differ from regular Chrome on cross-origin Set-Cookie with `Secure` flag. Likely a `browse` tool quirk, not an app bug.
- For future /qa runs against this app: either (a) run the QA tool in an authenticated session via cookie-import from a real browser, or (b) bypass auth for QA by setting a session cookie programmatically before navigation.

#### ✅ B1. Dev-server secret injection for the two queue workers — DONE 2026-04-26

`QUEUE_WORKER_SECRET`, `AFRICGREEN_API_URL`, `AFRICGREEN_API_SECRET` added to `frontend/.env.local`. `app_config.queue.worker_secret` synchronised on hosted Supabase. Verified live on dev server: wrong secret → 401, right secret + empty queue → 204 on both `/api/queue/process-proforma` and `/api/queue/process-reconciliation`. **Full E2E tests not run** to avoid polluting hosted DB with test data — would require local Supabase or staging DB.

#### ✅ B2. A2 signup audit — 2 P0 bugs — DONE 2026-04-26 (commit `d584ed1`)

- **Wrong role enum**: `/api/auth/approve/route.ts` no longer rewrites `profiles.role`; only flips `is_active`. Register-time `ROLE_MAP` is now the single source of truth. 10 regression tests covering all 8 form roles in [`route.test.ts`](../../frontend/src/app/api/auth/approve/route.test.ts).
- **Sidebar link**: was already present in `DashboardSidebar.tsx:41` with correct RBAC gating in `rbac.ts:56`. Audit was stale on this point.
- **Bonus**: server-side role guard added to [`/dashboard/validations/page.tsx`](../../frontend/src/app/(dashboard)/dashboard/validations/page.tsx) — redirects non-admins to `/dashboard`.

### 🟠 P1 — important polish (all done 2026-04-26)

#### ✅ P1.1 Go backend context propagation — DONE (commit `861816d`)

Added `Ingester.done` channel + `Ingester.Wait(ctx)` + `Handler.Shutdown(ctx)`. `cmd/api/main.go` now bounds AIS shutdown to 5s before HTTP drain. Anchored binary patterns in `backend/.gitignore` (`/api`, `/api.exe`) so they no longer match `cmd/api/` source.

#### ✅ P1.2 host.docker.internal Linux fallback — DONE (commit `0d9c0b9`)

Documented in [`docs/dev-setup-queue-worker.md`](../dev-setup-queue-worker.md). Three workarounds (bridge IP, /etc/hosts in container, shared network). No migration fix because 035/036 are already applied to hosted DB and the value is meant to be per-environment.

#### ✅ P1.3 Delete dead Edge Function — DONE (commit `7bc0b22`)

`supabase/functions/approve-registration/` removed. Old `tax.NewIngester` / `tax.NewHandler` stubs were already removed in Plan 2 review.

#### ✅ P1.4 Rate-limit `/api/auth/register` — DONE (commit `7bc0b22`)

`enforceRateLimit('signup')` wired in with strict 5/min, 30/hour per-IP bucket via existing `lib/rateLimit.ts`. Caps account-creation spam and email-enumeration via the duplicate-email 409 branch. Fail-open in dev when Upstash creds absent; `RATE_LIMIT_STRICT=true` in prod for fail-closed.

### 🟡 P2 — nice-to-have

- **A2 audit P2s**: drop/nullable `registration_requests.password_hash`, reconcile `OPERATIONS_MANAGER` across schema/UI/i18n, resolve `reviewed_by` UUID to a real name in the Validations UI.
- **REFUND badge**: `badge` enum doesn't have a dedicated `REFUND` value — Plan 4 uses `EXEMPT` as closest neutral. Add a `CREDIT` or `REFUND` badge via a follow-up migration.
- **Admin agent assignment** to ESCALATED alerts (Plan 5 Task 4 left the "Assign" button as a disabled stub).
- **Localize AR/PT/SW** strings for `IncomingVessels`, `AdminEscalations`, `AdminMappings`, `AdminTaxPipeline` (currently EN fallback).
- **Observability**: structured logs with request IDs in all queue workers; Sentry/Honeycomb wiring.

### 🔮 Phase 2 — feature-flagged, activate later

- ✅ **`feature.ais_global_enabled`**: Plan 8 v0 merged 2026-04-27. Detects vessels declaring Berbera/Zeila as their AIS Destination at origin port (~1-3 weeks before EEZ entry). Module `backend/internal/originport/` (matcher + cache + watcher); admin review at `/admin/origin-port-proposals`. Default `false`; toggle via `/admin/tax-settings`. Free tier aisstream.io with 2 WS connections (regional dynamic + global static). See [`docs/superpowers/specs/2026-04-27-plan-8-ais-global-origin-port-detection.md`](specs/2026-04-27-plan-8-ais-global-origin-port-detection.md). v0+1 backlog: refactor `OriginPortProposalsPanel.tsx` for `useTranslations('AdminOriginPort')` (i18n keys already loaded EN+FR), AR/PT/SW human translations, real backdated alert creation on proposal approval.
- **`feature.equasis_scraper_enabled`**: Phase 2 owner-email discovery pipeline. Scraper worker + `equasis_scrape_proposals` review UI. Spec §6.7 + mig 030 (schema already in place, dormant).
- **`feature.shipowner_portal_enabled`**: currently `true` in config but the actual portal UI (shipowner-facing dashboard with their alerts + invoices) hasn't been built. Plan 2 Task 0 mig 033 added the RLS policies. Next step: `/owner/*` routes with magic-link invite flow.

### 🧊 Post-MVP — stays dormant

- **`feature.vessel_detention_enabled`**: detention-on-next-call workflow. DB columns added by Plan 1 mig 029 (`vessels.detain_on_next_call` etc). Needs policy, Port Operations integration, UI.
- **BI / reporting dashboards** for MoECC reporting cadence.

---

## Environment setup for a fresh session

### Prerequisites (one-time)

- Windows + Git Bash or similar
- `scoop install supabase postgresql` + `scoop reset` if shims misbehave
- `psql --version` ≥ 16
- `supabase --version` ≥ 2.90
- Docker Desktop running (Supabase CLI uses it)
- Go 1.25+ (`go.mod` requires it after pgx/v5 bump)
- Node 20+ (frontend uses Next.js 16)

### Running the stack

Three shells:

```bash
# Shell 1 — Supabase (DB + storage + auth)
supabase start
# verify:
supabase status

# Shell 2 — Go backend
cd backend
export $(grep -v '^#' .env | xargs)  # if you use direnv, skip
go run ./cmd/api
# serves on :8080

# Shell 3 — Next.js
cd frontend
npm run dev
# serves on :3300
```

Before anything meaningful: ensure `QUEUE_WORKER_SECRET` is in `frontend/.env.local` AND matches `app_config.queue.worker_secret` (see B1 above).

### Key env vars

See [`frontend/.env.example`](../../frontend/.env.example) for the full list. Plan 3-added vars:

```
QUEUE_WORKER_SECRET=...
AFRICGREEN_API_URL=http://127.0.0.1:8080
AFRICGREEN_API_SECRET=<same as Go backend API_SECRET>
```

### Running the test suites

```bash
# SQL migration tests
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do
  ./supabase/tests/run.sh "${f#supabase/tests/}" || exit 1
done

# Go unit tests
cd backend && go test ./... -count=1

# Frontend Vitest
cd frontend
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run
```

---

## Where to find things

- **Spec (truth)**: [`docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md`](specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md)
- **Individual plans**:
  - [Plan 1 — Schema foundation](plans/2026-04-22-plan-1-schema-foundation.md)
  - [Plan 2 — Go backend](plans/2026-04-22-plan-2-go-backend.md)
  - [Plan 3 — Pro-forma pipeline](plans/2026-04-22-plan-3-proforma-pipeline.md)
  - [Plan 4 — Reconciliation](plans/2026-04-22-plan-4-reconciliation.md)
  - [Plan 5 — Admin + owner escalation](plans/2026-04-24-plan-5-admin-and-owner-escalation.md)
- **Audit**: [A2 signup audit](../audits/2026-04-24-a2-signup-audit.md)
- **Migrations**: `supabase/migrations/023_*.sql` through `037_*.sql`
- **Go code**: `backend/internal/{supadb,appconfig,geo,emissions,tax,corridor,eez,reconcile,alerts,ais,config}/`
- **Frontend services**: `frontend/src/services/{arrivalAlertService,shipownerService,proformaPipelineService,reconcilePipelineService,ownerAgentMappingService,escalationService,ownerCascadeEmailService,appConfigService}.ts`
- **Frontend actions**: `frontend/src/actions/{claimArrivalAlert,escalateToOwner,createOwnerAgentMapping,deactivateOwnerAgentMapping,updateAppConfig}.ts`

---

## How to resume in a new session

Paste this into a fresh Claude Code session to get context fast:

> We've completed Plans 1-5 of the AfricGreen carbon tax pro-forma pipeline (63 commits on `develop`, now at `d7576b8`, pushed to origin). Read `docs/superpowers/ROADMAP.md` for the full state. I want to work on **[pick one: B1 dev-server secrets / B2 A2 signup fixes / Phase 2 shipowner portal / etc]**.

Claude will read the roadmap + the specific file references and hand you back a scoped plan.

---

## Suggested next session picks

Ranked by value × effort (B0 → B2 + all P1s closed 2026-04-26):

1. **Live smoke test** of the signup → `/dashboard/validations` → approve flow on hosted, end-to-end (30 min). Confirms B2 fix works in production-shadow before promoting to prod.
2. **E2E pgmq round-trip** — set up a local or staging Supabase, then run `npx vitest run proforma-happy-path reconciliation-happy-path` (1 hour). Validates B1 against a real queue, not just the route auth.
3. **P2 — REFUND badge + AR/PT/SW translations** (2 hours, polish).
4. **A2 audit P2s** — drop/nullable `registration_requests.password_hash`, reconcile `OPERATIONS_MANAGER` across schema/UI/i18n, resolve `reviewed_by` UUID to a real name in Validations UI (1-2 hours).
5. **Phase 2 shipowner portal** (multi-session — write Plan 6 first).

Each of these is a clean restart target.
