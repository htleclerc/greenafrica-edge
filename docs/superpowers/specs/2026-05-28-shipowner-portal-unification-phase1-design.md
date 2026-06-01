# Shipowner Portal Unification — Phase 1 (Identity & Routing Backbone)

**Date:** 2026-05-28
**Status:** Approved (pending written-spec review)
**Author:** Loic Leclerc + Claude

## Background

Today there are TWO parallel shipowner-side experiences:

| | Login | Routes | Identity |
|---|---|---|---|
| **Legacy armateur** (`SHIPPING_AGENT`) | `/login` (password) | `/dashboard/*` (subset) | `profiles.role='SHIPPING_AGENT'`, **no** `shipowners` row |
| **v7 owner** | `/owner/login` (magic-link) | `/owner/*` | `profiles` + `shipowners(ACTIVE)` |

Staff (SUPERADMIN/FINANCE_ADMIN/PORT_OFFICER/MANAGER) stay on `/login` + `/dashboard` + `/admin` and are **out of scope**.

### Decisions (locked)
1. Converge all shipowner-side users onto the **v7 `/owner` portal**.
2. Unified login = **password + magic-link** on `/owner/login` (Phase 2).
3. `/owner` nav becomes a **superset** that ports Map, Tax Simulator, TCO, Disputes, My Fleet (Phase 3).
4. Identity model = **`shipowners(ACTIVE)` row** (the v7 model). Migrate `SHIPPING_AGENT` accounts.
5. **Accept the temporary nav regression** between Phase 1 and Phase 3 (migrated armateurs get the slim `/owner` nav until Phase 3).

### 3-phase decomposition
- **Phase 1 (this spec):** identity migration + routing — delivers "one portal".
- **Phase 2:** dual-method `/owner/login` + `/login` becomes staff-only.
- **Phase 3:** nav superset (port Map/Simulator/TCO/Disputes/My Fleet into `/owner`).

## Goal (Phase 1)

Every legacy armateur (`SHIPPING_AGENT`) becomes an `shipowners(ACTIVE)` owner, lands on `/owner`, and **sees their existing invoices/vessels there**. No change to how they log in yet (the existing `/login` password works: middleware already redirects an active shipowner from `/dashboard/*` to `/owner/*`). Staff unaffected.

## Non-Goals
- Login page changes (Phase 2).
- Porting Map/Simulator/TCO/Disputes/My Fleet into `/owner` (Phase 3).
- Changing `profiles.role` values (kept as-is; routing is `shipowners`-based).
- Touching staff (`/dashboard` + `/admin`) behaviour.

## Key facts established (do not re-investigate)
- `shipowners` (mig 024): only `name` is `NOT NULL`. `profile_id` FK→profiles (nullable), `account_state` enum (`shipowner_account_state`) default `'GHOST'`, `official_email`/`official_email_source` (CHECK in `AGENT_CLAIM|PORT_OFFICER|EQUASIS_VERIFIED`)/`country_code`/`address`/`imo_company_no` nullable.
- Owner→transaction visibility RLS keys on **`transactions.shipowner_id`** (mig 033: `WHERE s.id = transactions.shipowner_id`). Legacy transactions have `shipowner_id = NULL` (linked only via `vessels.owner_id`).
- Middleware already redirects active shipowners off `/dashboard/*` to `/owner/*` (`frontend/src/middleware.ts:205-212`, `isActiveShipowner` 85-107, `mapLegacyToOwner` 113-125). `requireOwner` (`frontend/src/lib/auth/requireOwner.ts`) gates `/owner` on a `shipowners(ACTIVE)` row for `auth.uid()`.
- Master flag `feature.shipowner_portal_v1_enabled` is now **true** (enabled this session).
- Migration tip = 069. Next = **070**. Docker pg-test is broken (per project memory) → pg test DEFERRED; hosted apply via `supabase db push --db-url` or the dashboard SQL Editor (the direct DB host has intermittent DNS issues — note in the plan).
- SUPERADMIN demo impersonation of `SHIPPING_AGENT` (`/post-login`, `PostLoginPage.tsx` IMPERSONATION_ROLES) sets demo cookies → `/dashboard`; demo sessions BYPASS the shipowner redirect and have NO real `shipowners` row, so they cannot satisfy `requireOwner` on `/owner`.

## Design

### 1. Migration 070 — promote SHIPPING_AGENT profiles to active shipowners

For every `profiles` row with `role='SHIPPING_AGENT'` that does **not** already have a `shipowners` row (`profile_id` match), insert one:
- `name` = `COALESCE(profiles.full_name, profiles.email, 'Shipowner')`
- `profile_id` = the profile id
- `official_email` = `profiles.email`
- `official_email_source` = `'AGENT_CLAIM'`
- `account_state` = `'ACTIVE'`

Idempotent: guard with `WHERE NOT EXISTS (SELECT 1 FROM shipowners s WHERE s.profile_id = p.id)`.

### 2. Backfill `transactions.shipowner_id` (data visibility — REQUIRED)

For each newly-linked owner, set `shipowner_id` on their legacy transactions so `/owner/invoices` (RLS) shows them:

```sql
UPDATE public.transactions t
SET shipowner_id = s.id
FROM public.shipowners s
JOIN public.vessels v ON v.owner_id = s.profile_id
WHERE t.vessel_id = v.id
  AND t.shipowner_id IS NULL
  AND s.account_state = 'ACTIVE'
  AND s.profile_id IS NOT NULL;
```

(Only fills NULLs — never overwrites an existing `shipowner_id`.)

### 3. Vessels visibility on `/owner/vessels` (verify + backfill if needed)

`/owner/vessels` must show the migrated armateur's vessels. **Verify** how `/owner/vessels` scopes (owner RLS on `vessels`): if it keys on `vessels.owner_id = auth.uid()` the existing `owner_id` already works; if it keys on a `shipowner_id`/mapping, add the equivalent backfill. The implementation plan resolves this by reading the vessels owner-RLS policy before deciding whether a backfill statement is needed.

### 4. Routing — rely on existing middleware (verify, no change expected)

After migration a `SHIPPING_AGENT` is an active shipowner, so:
- Login via existing `/login` (password) → role redirect to `/dashboard` → middleware `isActiveShipowner` → bounce to `/owner/*`.
- Direct `/owner/*` visits pass `requireOwner`.

No middleware edit is expected. The plan **verifies** the flow end-to-end and only adjusts if a gap is found (e.g., the `isActiveShipowner` 5-min cache requires a fresh Edge instance — acceptable).

### 5. Remove the SHIPPING_AGENT impersonation option

In `PostLoginPage.tsx`, remove `SHIPPING_AGENT` from `IMPERSONATION_ROLES` (it routes to `/dashboard` with demo cookies and cannot satisfy `requireOwner` on `/owner`, so it no longer maps to a coherent portal). Testing the owner portal is done by logging in as a real active shipowner (e.g., Acme Maritime Corp). Keep the other impersonation roles (PORT_OFFICER, FINANCE_ADMIN) for staff demo.

## Error handling / edge cases
- Profiles already having a `shipowners` row → skipped (idempotent guard).
- Armateurs with zero vessels/transactions → still get a shipowners row; `/owner` shows empty lists (correct).
- A transaction already carrying a `shipowner_id` → not overwritten.
- `vessels.owner_id` NULL → that transaction keeps `shipowner_id` NULL (no owner to attribute; stays staff-only).

## Security / RLS
- Migration runs with migration privileges (service-role). The new `shipowners(ACTIVE)` rows + backfilled `shipowner_id` are exactly what the existing owner RLS expects — no policy changes.
- No widening of staff access. No new public surface.

## Testing
- **Migration pg test** — DEFERRED (Docker broken per memory); the plan documents the manual hosted-apply + verification path.
- **Manual:** pick one `SHIPPING_AGENT` profile with vessels+transactions; run the migration on hosted; log in as that account; confirm (a) redirect to `/owner`, (b) their invoices appear in `/owner/invoices`, (c) `requireOwner` passes. Confirm a staff account is unaffected (still `/dashboard`).
- **Regression:** existing v7 owners (e.g. Acme) still work; their data unchanged (backfill only touches NULL `shipowner_id`).

## Rollback (DOWN)
Data migrations are not cleanly reversible. `official_email_source` is NOT a safe
discriminator (real owners can also be `AGENT_CLAIM`). The migration MUST record a
reliable marker for the rows it creates/touches so rollback is precise — e.g.:
- write the created `shipowners.id` set and the backfilled `transactions.id` set into a
  dedicated `app_config` key (or a one-row audit table) within the same transaction, and
- the DOWN reads that record to delete exactly those `shipowners` rows and NULL exactly
  those `transactions.shipowner_id` values.

If a reliable marker can't be guaranteed, the DOWN is documented as **"manual review
required"** rather than a blind revert (matches the project's caution after the mig 062
data-loss incident). The plan picks the concrete marker mechanism.

## Files (anticipated)
**New**
- `supabase/migrations/070_promote_shipping_agents_to_owners.sql`

**Modified**
- `frontend/src/app/(auth)/post-login/PostLoginPage.tsx` (drop SHIPPING_AGENT from IMPERSONATION_ROLES)

**Verified (maybe modified)**
- `frontend/src/middleware.ts` (expected: no change)
- `/owner/vessels` data scoping (backfill only if it keys on shipowner_id)

## Open questions
None — design approved. Pending user review of this written spec.
