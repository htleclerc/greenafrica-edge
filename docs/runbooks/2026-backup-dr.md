# GreenGate — Backup & Disaster Recovery Runbook

> **Authoritative runbook** for database backup posture, restore procedures, and the monthly restore drill.
>
> **Owner**: Loïc Leclerc (`admin@drwintech.com`)
> **Last updated**: 2026-06-12 (Wedge 4 — P0-5 of the 2026-06-12 general review)
> **Production DB**: hosted Supabase project `dyjolepwxxsedwngkfox` (eu-north-1, PostgreSQL 17.x)
> **Companion**: [`2026-canary-rollout-shipowner-portal-v1.md`](2026-canary-rollout-shipowner-portal-v1.md) (rollout/monitoring), `scripts/backup/restore-test.sh` (the drill).

GreenGate is a **fiscal platform**. The database holds sovereign tax records — losing it is not "losing an app", it is losing the tax ledger of one or more States. Treat every section below as money-correctness critical.

---

## 1. What's at stake — fiscal data classes

| Table / class | Why it is irreplaceable |
|---|---|
| `transactions` | The invoices themselves: PROFORMA/FINAL/COMPLEMENT, `tax_amount_usd`, `invoice_ref`, `content_hash` (PDF verification), jurisdiction. Append-only since mig 089 — the DB **is** the fiscal ledger. |
| `payments` | Per-rail payment rows (WIRE/STRIPE/provider webhooks), confirmation state, external references. The proof money moved. |
| `wallet_ledger` / `wallets` | Append-only money ledger (top-ups, credits, refunds). Drift = money-correctness incident. |
| `tariffs` | Versioned rates per jurisdiction (immutability triggers migs 080/088). Reconstructing "what rate applied on date X" is legally required. |
| `audit_logs` | Who did what, when — the compliance trail for every fiscal action. |
| `revenue_split_rules` + `v_revenue_split_settlement` | Inter-State settlement math (escrow vs jurisdiction shares). |
| `auth.users` + `user_jurisdictions` | Staff/owner identities and jurisdiction scoping (RLS depends on them). |

**RPO/RTO targets (general-review D7): RPO ≤ 24h, RTO ≤ 72h.** See §5 for where we actually stand.

---

## 2. Current backup posture

- **Supabase automated backups**: daily logical/physical backups, retention depends on plan tier (Free: none → Pro: 7 days daily → larger tiers: longer).
- **PITR (point-in-time recovery)**: paid add-on on Pro+, brings RPO from "up to 24h" down to **~2 minutes** (WAL archiving). **Recommended for this platform** — a day of lost invoices/payments is not acceptable for a fiscal system.
- **CLI tier check attempted 2026-06-12 — blocked, must be done in the dashboard.** Verbatim outcome:
  - `supabase projects list` (CLI v2.90.0) succeeds but the production project `dyjolepwxxsedwngkfox` is **not in the list** — the configured access token belongs to orgs that do not include the production project.
  - `supabase backups list --project-ref dyjolepwxxsedwngkfox` →
    ```text
    unexpected list backup status 403: {"message":"Your account does not have the
    necessary privileges to access this endpoint. For more details, refer to our
    documentation https://supabase.com/docs/guides/platform/access-control"}
    ```
  - Same class of failure as the known `supabase link` 403 (memory note 2026-05-22). Management-API operations on this project are not possible from this machine's token.

> ### ⚠️ USER ACTIONS (dashboard — cannot be done from the CLI on this machine)
>
> Supabase dashboard → project `dyjolepwxxsedwngkfox` → **Settings → Database → Backups** (and **Settings → Billing**):
>
> 1. **Confirm the plan is ≥ Pro.** Free tier has NO automated backups — if the project is on Free, this entire runbook's §2/§3.1/§3.2 are fiction and §3.3 (pg_dump) is the only safety net.
> 2. **Enable PITR** (paid add-on). Given fiscal data, the ~2min RPO is worth it. Pick a WAL retention window (7 days minimum recommended).
> 3. **Confirm the daily-backup retention window** and note it here once known: `retention = ____ days` (fill in).
> 4. Optional but recommended: grant the CI/CLI access token org membership on the production project so `supabase backups list` works for future audits.
>
> Until 1–3 are confirmed, assume **worst case: RPO = 24h if Pro, RPO = ∞ if Free**.

---

## 3. Restore procedures

### 3.1 Full project restore (dashboard — primary path)

1. Dashboard → `dyjolepwxxsedwngkfox` → **Database → Backups**.
2. Pick the most recent daily backup → **Restore**. This restores the whole Postgres instance: `public`, `auth` (users/sessions), `storage` metadata, `supabase_migrations`.
3. Restore is **destructive in-place** — everything after the backup point is lost. Before clicking, capture a fresh logical dump (§3.3) of the current (broken) state for forensics.
4. After restore: run the §4 smoke queries, then the 4 invariant views (canary runbook §9).

### 3.2 Point-in-time restore (requires PITR enabled — see USER ACTIONS)

1. Dashboard → **Database → Backups → Point in time** → choose timestamp (e.g. 1 minute before the incident).
2. Same destructive-in-place caveat as §3.1.
3. After restore, reconcile the gap window: query `audit_logs` / Vercel logs for actions between the restore point and the incident, replay manually if needed.

### 3.3 Logical fallback — `pg_dump` / `psql` (works today, proven 2026-06-12)

Connection strings (NEVER commit a password; NEVER paste one in this file):

- **Pooler (preferred — proven path)**: a ready-made URL lives in `backend/.env` as `SUPABASE_DB_URL` (`postgresql://postgres.dyjolepwxxsedwngkfox:<password>@aws-1-eu-north-1.pooler.supabase.com:5432/postgres`, session mode). Same secret exists in GitHub Actions as `SUPABASE_DB_URL` (used by `deploy-production.yml` migrations job).
- **Direct**: `postgresql://postgres:<SUPABASE_DB_PASSWORD>@db.dyjolepwxxsedwngkfox.supabase.co:5432/postgres` — the password is `SUPABASE_DB_PASSWORD` in `frontend/.env.local`. ⚠️ Two known gotchas: (a) direct DNS can fail on VPN/split-horizon setups (memory note 2026-05-13) — use the pooler; (b) the password contains URL-special characters — percent-encode it if you build the URL by hand (the pooler URL in `backend/.env` is already correctly encoded; prefer it).

Tools on this dev machine: `scoop install postgresql` → `pg_dump`/`psql`/`pg_restore` 18.x in `~/scoop/apps/postgresql/current/bin` (on PATH).

```bash
# Full data dump (custom format, restorable with pg_restore)
export SUPABASE_DB_URL="<from backend/.env — do not echo it>"
pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges \
  --schema=public --schema=supabase_migrations --schema=auth \
  -f "backups/full-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Restore into a disposable local Postgres (NEVER into production directly)
createdb greengate_restore_test
pg_restore --no-owner --no-privileges -d greengate_restore_test "backups/full-<ts>.dump"
```

Dumps land under `backups/` which is **gitignored** — a dump of production fiscal data must never reach the repo or any shared drive.

### 3.4 Sovereign replica — explicit backlog (D7)

The general review's D7 target (a jurisdiction-controlled replica so each State holds its own fiscal records independent of Supabase) is **NOT implemented**. This runbook covers Supabase-internal recovery only. The sovereign replica is a tracked backlog item for a future wedge — do not consider DR "done" until it exists.

---

## 4. Monthly restore drill

Run `scripts/backup/restore-test.sh` **on the 1st of every month** (read-only against production):

```bash
# URL from backend/.env (SUPABASE_DB_URL) — never hardcoded
export SUPABASE_DB_URL="<pooler url>"
bash scripts/backup/restore-test.sh
```

It (1) takes a schema-only `pg_dump` to `backups/restore-test-schema-<ts>.sql`, (2) runs fiscal row-count smoke queries, (3) validates the dump contains the fiscal tables, and prints `RESULT: PASS|FAIL`. A FAIL means the logical-backup safety net is broken — treat as a P1 incident.

**Quarterly extension**: do the full §3.3 dump + restore into a disposable local Postgres and re-run the smoke queries against the restored copy (proves restorability, not just dumpability).

First execution — 2026-06-12, against hosted (verbatim):

```text
── Backup/restore drill — 20260612T020016Z ──────────────────────────────────────
[1/3] pg_dump --schema-only (public supabase_migrations)
  [ OK ] dump written (209742 bytes)
[2/3] Row-count smoke (psql, read-only)
  [ OK ] transactions              = 9
  [ OK ] payments                  = 1
  [ OK ] wallets                   = 0
  [ OK ] tariffs                   = 4
  [ OK ] v_revenue_split_settlement = 2
  [ OK ] auth.users                = 17
  [ OK ] schema_migrations tip = 086
[3/3] Dump validation (CREATE TABLE markers present)
  [ OK ] CREATE TABLE public.transactions
  [ OK ] CREATE TABLE public.payments
  [ OK ] CREATE TABLE public.tariffs
  [ OK ] CREATE TABLE public.wallets
  [ OK ] CREATE TABLE public.wallet_ledger
  [ OK ] CREATE TABLE public.audit_logs
RESULT: PASS
```

---

## 5. RPO / RTO statement

| Posture | RPO (data loss window) | RTO (time to restore) |
|---|---|---|
| **Today, plan unconfirmed** (see USER ACTIONS) | Up to **24h** if Pro daily backups exist; **unbounded** if Free | Hours (dashboard restore) — but **untested** |
| **Pro + daily backups confirmed** | ≤ 24h | ≤ 72h (meets D7 target, barely) |
| **Pro + PITR enabled** (recommended) | **~2 min** | Hours (dashboard PITR restore) |
| Logical fallback (`pg_dump`, §3.3) | Age of last manual dump (monthly drill → up to 1 month — this is a **safety net**, not the plan) | Hours (local restore proven path) |

D7 targets (RPO ≤ 24h / RTO ≤ 72h) are met **only once the plan tier is confirmed ≥ Pro**. PITR comfortably exceeds them.

---

## 6. What is NOT covered by a Postgres restore

- **Storage buckets** — Supabase Storage *objects* (the files) are not in the Postgres dump; only the metadata is. Buckets in production (from migrations 012/055/059):
  - `documents` (private since mig 017) — invoice PDFs, receipts. *Mitigation*: PDFs are regenerable from `transactions` rows, BUT mig 089 makes `content_hash` first-write-only — a regenerated PDF must hash-match, so losing the bucket loses the distributed originals' bytes. Back up this bucket separately if PDFs are legally "the" document.
  - `shipowner-kyc` (private) — KYC proof uploads. NOT regenerable.
  - `payment-proofs` (private) — MT103/wire proof uploads. NOT regenerable, fiscally relevant.
  - *Backlog*: scripted bucket sync (e.g. `supabase storage cp -r` or S3-compatible sync) alongside the monthly drill.
- **Auth users** — the `auth` schema **IS in the same Postgres database**, so dashboard restores and §3.3 dumps that include `--schema=auth` DO cover users/identities. (Password hashes restore fine; active sessions/JWTs are invalidated — users just re-login.)
- **Env vars / secrets** — not in the DB at all. Inventory of where they live (re-provision by hand after a platform-level loss):
  - **Vercel** (frontend): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `CRON_SECRET` (canary runbook §1.2).
  - **Fly.io** (Go backend): `fly secrets list -a <app>` — DB URL etc.
  - **GitHub Actions** (repo `htleclerc/africgreen`): `SUPABASE_DB_URL`, `FLY_API_TOKEN`, `BACKEND_URL`, `PRODUCTION_URL`, `VERCEL_TOKEN` (see `.github/workflows/deploy-production.yml`).
  - Local masters: `frontend/.env.local`, `backend/.env` — keep an offline copy in the password manager.
- **Supabase project config** — Auth providers/allowlists, custom domains, webhook endpoints (Stripe dashboard side), Vercel cron registrations: all dashboard-side config, restored by hand. Keep this runbook + canary runbook §1 as the checklist.

---

*Authored 2026-06-12 for Wedge 4 Task 7 (P0-5 of the general review). The monthly drill keeps this honest — a backup that has never been restored is a rumor, not a backup.*
