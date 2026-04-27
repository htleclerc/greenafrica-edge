# Plan 7 — Equasis Proposals v0 (hybrid scaffolded)

**Spec**: `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` (Phase 2 §6.7).
**Branch**: `feat/equasis-proposals-v0` from `develop` (after Plan 6 merges).
**Feature flag**: `feature.equasis_scraper_enabled` (default `false`, mig 027).
**Sessions estimate**: 3.

## Outcome

Owner-email discovery pipeline that ships **operational from day one** for
manual entry, while the scraping worker is fully scaffolded but gated.
Two distinct paths reach the same review queue:

1. **Manual** — Port Officer pastes data from any source (Equasis lookup,
   third-party data feed, agent disclosure) into a "create proposal" form.
   Always available, no flag gating.
2. **Automated (scaffolded)** — Go worker `cmd/scraper/main.go` polls
   `pgmq.scrape_queue`, fetches HTML, parses, inserts proposals. Default
   wiring runs against **local fixture files**; real Equasis access stays
   off until the feature flag is flipped AND legal sign-off is obtained.

Both feed `equasis_scrape_proposals`. Port Officer reviews each proposal;
applying it writes the data into `shipowners.official_email` etc. with
source = `EQUASIS_VERIFIED` (trust 2 — overrides `AGENT_CLAIM`, not
`PORT_OFFICER`).

Out of scope for v0:
- Real Equasis HTTP integration (legal sign-off + auth flow)
- CAPTCHA solving
- Rate-limit infrastructure beyond a basic per-domain delay
- Bulk import (CSV / spreadsheet upload)

## Why this order

Manual entry + review UI is operational immediately and lets the team
start collecting owner emails today. The scraper scaffold is a
fixture-driven implementation — it proves the pipeline end-to-end without
touching Equasis. When legal clears the use, flipping a flag + replacing
fixture loader with a real HTTP client is a one-day change.

Human-in-the-loop is the load-bearing constraint per the spec
(§4 split rationale: "outputs are proposals, never direct writes").

## Tasks

### Task 0 — Schema + RLS gap

Migration `040_equasis_proposals_rls.sql`:

- `equasis_scrape_proposals` has no RLS yet (mig 030 only created the
  table). Add:
  - SELECT for PORT_OFFICER, MANAGER, SUPERADMIN
  - INSERT for service_role only (worker writes via service key)
  - UPDATE for PORT_OFFICER, MANAGER, SUPERADMIN (review actions)
- Add a CHECK constraint: `applied=true` requires `reviewed_by` and
  `reviewed_at`. The existing schema lets you set applied=true with no
  reviewer — that's a hole.
- Add column `source TEXT` (enum-like: `'manual' | 'scraper' | 'fixture'`)
  to distinguish where a proposal came from. Default `'manual'`.

Migration tests: schema introspection (policies, check, source column).

### Task 1 — Manual create + review actions

Server actions, all gated `PORT_OFFICER | MANAGER | SUPERADMIN`:

- `createEquasisProposal({ imoNumber, ownerName?, manager?, email?, country? })`
  Inserts a manual proposal. Validates IMO format. Sets `source='manual'`.

- `applyEquasisProposal({ proposalId })`
  - Loads proposal + linked shipowner
  - Calls `upsertShipownerEmail(shipowner.id, proposal.email, 'EQUASIS_VERIFIED')`
    if email present (existing helper enforces trust chain)
  - Updates shipowners.name from `proposed_owner_name` ONLY IF current
    name is null/empty (don't clobber port officer overrides)
  - Updates shipowners.country_code if currently null
  - Marks proposal `applied=true, reviewed_by=auth.uid(), reviewed_at=now()`
  - Audit log entry

- `rejectEquasisProposal({ proposalId, reason })`
  - Marks `applied=false, reviewed_by, reviewed_at, rejected_reason=reason`

### Task 2 — Admin review UI

New route: `/admin/equasis-proposals` (gated PORT_OFFICER+).

- Two sections: **Pending review** (where reviewed_at is null) and
  **Recently resolved** (last 30 days).
- Each row: IMO, vessel name (joined from vessels), proposed owner,
  manager, email, country, source badge (manual / fixture / scraper),
  scraped_at, actions (Apply, Reject).
- "Create proposal" button → modal with the manual entry form.
- Apply opens a confirmation modal showing the diff against the current
  shipowners row (so the officer sees exactly what changes).

### Task 3 — Enqueue logic

When a vessel needs owner-email discovery, enqueue an IMO into
`pgmq.scrape_queue`. Triggers:

- `pg_cron` job `equasis-enqueue` (every 30 min) — finds alerts that are
  `UNCLAIMED` past SLA AND linked vessel has no `shipowner_id` OR
  `shipowner.official_email IS NULL`. Idempotent: won't re-enqueue an
  IMO that has a pending pgmq message OR an unreviewed proposal in the
  last 24h.

Migration `041_equasis_enqueue_cron.sql`. Disabled by default
(`feature.equasis_scraper_enabled=false`); the cron checks the flag and
no-ops when off.

### Task 4 — Go scraper worker (fixture-driven)

`backend/cmd/scraper/main.go` — long-running worker:

- Loop: poll pgmq.scrape_queue (visibility 30s), pop IMO, dispatch to
  fetcher, parse HTML, insert proposal, ack.
- Two fetchers, selected by env var `EQUASIS_FETCHER` (default `fixture`):
  - `fixture` — reads `backend/testdata/equasis/<imo>.html` from disk.
    Returns 404-equivalent if the file is missing.
  - `http` — real Equasis fetch (stub: returns "not implemented" until
    legal sign-off; the function exists so the wiring is ready).
- Per-domain delay (1 req / 5 sec) configurable via env even on fixture.
- Sets `source='fixture'` or `source='scraper'` on inserted proposals.
- Health endpoint on :8081/health.
- Graceful shutdown (5s timeout, mirroring P1.1 pattern).

Dockerfile + Fly.io machine config can come in v0+1; for v0 the worker
runs locally via `go run ./cmd/scraper`.

### Task 5 — Equasis HTML parser

`backend/internal/equasis/parser.go` + `parser_test.go`:

- `Parse(html string) (Proposal, error)` — extracts owner name, manager,
  email (if visible), country, IMO from the page DOM.
- Tests against `backend/testdata/equasis/*.html` fixtures (one happy
  case, one missing-email case, one CAPTCHA-shown case which returns a
  specific "needs login" error).
- Uses `golang.org/x/net/html` for parsing — no JS execution needed for
  the public unauthenticated view.

If the real Equasis structure changes, tests catch it before deployment.

### Task 6 — Frontend tests

Mirror Plan 6 Task 8a pattern — vi.mock supabase, assert payloads:

- `applyEquasisProposal` — role check, applies through trust chain
  (refuses to overwrite PORT_OFFICER source), audit log, idempotent
  (re-applying a `applied=true` proposal returns short-circuit error).
- `rejectEquasisProposal` — role check, sets rejected_reason, doesn't
  touch shipowners.
- `createEquasisProposal` — schema validation, source='manual'.

### Task 7 — i18n + docs

- New `AdminEquasis` namespace, EN + FR (AR/PT/SW use EN fallback per
  Plan 6 v0 convention).
- `docs/dev-setup-equasis-worker.md` — how to run locally, how fixtures
  work, what flipping the prod flag entails.
- `docs/legal-equasis-scraping.md` — placeholder noting that real HTTP
  fetching needs sign-off, listing the questions to address with legal.

## Risk & rollout

- **Legal**: feature flag stays OFF in production until sign-off. The
  fixture fetcher is the only one wired by default. The HTTP fetcher
  exists as a stub that throws — so no accidental real fetch can happen.
- **RLS regression**: Task 0 adds policies to a previously-unprotected
  table. Run pre-existing /admin queries after migration to confirm no
  false denials.
- **pgmq deadlocks**: the scraper goroutine pops messages with 30s
  visibility. If parsing hangs, message re-delivers. Worker has SIGTERM
  hard-kill at 5s (Plan 6 P1.1 pattern).
- **Idempotence**: enqueue cron skips IMOs with a pending message or
  recent unreviewed proposal — prevents queue spam if the worker is down.

## Dependencies between tasks

```
Task 0 (RLS + source col) ──┬─→ Task 1 (actions)  ──→ Task 2 (admin UI)
                            ├─→ Task 6 (action tests)
                            └─→ Task 4 (worker writes proposals)

Task 5 (parser + fixtures) ──→ Task 4
Task 3 (cron enqueue) ──→ Task 4 (consumes)

Task 7 (i18n + docs) closes.
```

Tasks 0+1+2+6 are the "manual entry + admin review" critical path —
ships value immediately. Tasks 3+4+5 are the scraper scaffold — can be
parallelised behind the same branch.

## Out-of-scope follow-ups (v0+1)

- Real Equasis HTTP fetcher with auth + session handling
- CAPTCHA solver integration (or fail-fast detection + human queue)
- CSV bulk-import for migrating existing owner data
- Cron `equasis-enqueue` smarter scheduling (priority for high-traffic
  vessels, dampen for repeat offenders)
- Equasis API partnership if it materialises (replaces scraper entirely)
