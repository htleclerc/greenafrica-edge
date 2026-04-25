# Carbon Tax Pro-Forma — Project Roadmap

**Last updated**: 2026-04-24 after Plan 5 merge (commit `d7576b8` on `origin/develop`)
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

#### B1. Dev-server secret injection for the two queue workers

**Problem**: the Plan 3 and Plan 4 E2E tests are marked `DONE_WITH_CONCERNS` because the running Next.js dev server doesn't have `QUEUE_WORKER_SECRET` in its env. Route handlers return 500 before auth is checked. The frontend tests pass; the full pgmq round-trip does not.

**Fix** (manual, one-off):

1. Add to `frontend/.env.local`:
   ```
   QUEUE_WORKER_SECRET=<openssl rand -hex 32>
   AFRICGREEN_API_URL=http://127.0.0.1:8080
   AFRICGREEN_API_SECRET=<same value as Go backend's API_SECRET>
   ```
2. Update `app_config.queue.worker_secret` in Supabase to the same value:
   ```sql
   UPDATE public.app_config
      SET value = to_jsonb('<same value>'::text)
    WHERE key = 'queue.worker_secret';
   ```
3. Restart `npm run dev`. Re-run both E2E tests:
   ```bash
   cd frontend && npx vitest run proforma-happy-path reconciliation-happy-path
   ```

**Expected after fix**: both E2E tests go green end-to-end.

#### B2. A2 signup audit — 2 P0 bugs

From [`audits/2026-04-24-a2-signup-audit.md`](../audits/2026-04-24-a2-signup-audit.md):

- **Wrong role enum in approve route**: `/api/auth/approve/route.ts:70-77` writes `regRequest.requested_role` (a form role like `FLEET_MANAGER`) directly onto `profiles.role`, which is not a valid `user_role` enum value. Approval of any SHIPPING_AGENT silently fails, leaving the user stuck at `is_active=false`. Fix: remove the `role:` line from the approve update — register already sets the correct mapped role. Add a test covering all 8 form roles.
- **Missing sidebar link**: admins have no discoverable path to `/dashboard/validations`. Add the sidebar entry gated on `SUPERADMIN | PORT_OFFICER | MANAGER`.

### 🟠 P1 — important polish

#### P1.1 Go backend context propagation

Plan 2 code review (commit `3f7fdfa` applied partial fixes). Remaining known concern: the `ais.Ingester` now owns a cancellable ctx (Plan 2 follow-up fix), BUT long-running operations inside hook handlers may still not unwind instantly on SIGTERM. Add a hard-kill timeout of ~5s on the in-flight hook ctx during shutdown. Low-severity — surfaces only on forcibly-terminated deploys.

#### P1.2 Sanitize secret storage in Docker-reachable URLs

`supabase/migrations/035_proforma_worker_cron.sql` and `036_reconciliation_trigger_and_cron.sql` both use `host.docker.internal` for the worker URL. On Linux (non-Docker-Desktop), this doesn't resolve by default. Document in the README OR add a `supabase/config.toml` entry:

```toml
[db]
extra_hosts = ["host.docker.internal:host-gateway"]
```

#### P1.3 Delete dead code

- `supabase/functions/approve-registration/` Edge Function is unused (audit Task 7 found zero frontend references; would 409 if called).
- The old `tax.NewIngester` / `tax.NewHandler` stubs were removed in Plan 2 review cleanup — confirm nothing in other project repos still imports them.

#### P1.4 Rate-limit `/api/auth/register`

Audit Task 7 flagged this. The repo already has `frontend/src/lib/rateLimit.ts` (Upstash Redis-backed). Wire it into the register route.

### 🟡 P2 — nice-to-have

- **A2 audit P2s**: drop/nullable `registration_requests.password_hash`, reconcile `OPERATIONS_MANAGER` across schema/UI/i18n, resolve `reviewed_by` UUID to a real name in the Validations UI.
- **REFUND badge**: `badge` enum doesn't have a dedicated `REFUND` value — Plan 4 uses `EXEMPT` as closest neutral. Add a `CREDIT` or `REFUND` badge via a follow-up migration.
- **Admin agent assignment** to ESCALATED alerts (Plan 5 Task 4 left the "Assign" button as a disabled stub).
- **Localize AR/PT/SW** strings for `IncomingVessels`, `AdminEscalations`, `AdminMappings`, `AdminTaxPipeline` (currently EN fallback).
- **Observability**: structured logs with request IDs in all queue workers; Sentry/Honeycomb wiring.

### 🔮 Phase 2 — feature-flagged, activate later

All three dormant, gated by `app_config.feature.*`:

- **`feature.ais_global_enabled`**: scenario A in the spec — detection at origin port departure using global AIS coverage. Requires paid aisstream.io tier + robustness against sloppy `Destination` field.
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

Ranked by value × effort:

1. **B1 — fix QUEUE_WORKER_SECRET** (15 min, unblocks both E2E tests going fully green). Start here.
2. **B2 — approve route role bug** (1 hour, fixes a real production-blocking bug; adds test coverage). Independent of B1.
3. **P1.2 — host.docker.internal Linux fallback** (30 min, removes a platform-specific footgun).
4. **P2 — REFUND badge + proper Arabic translations** (2 hours, polish).
5. **Phase 2 shipowner portal** (multi-session — write Plan 6 first).

Each of these is a clean restart target.
