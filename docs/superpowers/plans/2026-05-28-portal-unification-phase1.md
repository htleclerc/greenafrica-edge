# Shipowner Portal Unification — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote every legacy `SHIPPING_AGENT` profile to an `shipowners(ACTIVE)` owner (with data-visibility backfill) so they land on the v7 `/owner` portal and see their existing invoices, and remove the now-dead `SHIPPING_AGENT` impersonation option.

**Architecture:** A single data migration (mig 070) does the identity promotion + a precise, rollback-tagged `transactions.shipowner_id` backfill. Routing needs no code change — the existing middleware already bounces active shipowners from `/dashboard/*` to `/owner/*`, and `vessels` RLS already keys on `owner_id = auth.uid()`. One small frontend edit drops the SHIPPING_AGENT demo-impersonation tile.

**Tech Stack:** Supabase (Postgres migration, plpgsql DO block), Next.js (PostLoginPage), Vitest.

---

## Established facts (do not re-investigate)
- `shipowners` (mig 024): only `name` is NOT NULL. `account_state` is enum `shipowner_account_state` ('GHOST'|'INVITED'|'ACTIVE'). `official_email_source` CHECK ∈ ('AGENT_CLAIM','PORT_OFFICER','EQUASIS_VERIFIED'). `profile_id` FK→profiles.
- `profiles` (mig 001): `email` NOT NULL, `full_name` NOT NULL, `role` enum `user_role`.
- Owner→transaction RLS keys on `transactions.shipowner_id` (mig 033). Legacy transactions have `shipowner_id IS NULL` (linked via `vessels.owner_id`).
- Owner→vessel RLS keys on `vessels.owner_id = auth.uid()` (mig 004:17, mig 020:56). **No vessels backfill needed** — a migrated armateur's vessels are already `owner_id = their profile id`.
- Middleware already redirects active shipowners `/dashboard/*` → `/owner/*` (`frontend/src/middleware.ts:205-212`); `requireOwner` gates `/owner` on a `shipowners(ACTIVE)` row.
- `app_config.key` is unique (PostgREST upsert with `on_conflict=key` works); `value` is jsonb.
- Migration tip = 069 → next = **070**. Docker pg-test broken → pg test DEFERRED. Hosted apply: the direct DB host `db.dyjolepwxxsedwngkfox.supabase.co` has intermittent DNS resolution (VPN/split-horizon); prefer the **dashboard SQL Editor** to run the migration, or `supabase db push --db-url` when DNS resolves.
- `IMPERSONATION_ROLES` is in `frontend/src/components/auth/PostLoginPage.tsx:24-49`; the SHIPPING_AGENT tile is lines 33-40.

---

### Task 1: Migration 070 — promote SHIPPING_AGENT → shipowners(ACTIVE) + backfill

**Files:**
- Create: `supabase/migrations/070_promote_shipping_agents_to_owners.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 070: Promote SHIPPING_AGENT profiles to active shipowners
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Portal unification Phase 1. Every legacy armateur (profiles.role='SHIPPING_AGENT')
-- without a shipowners row gets one in account_state='ACTIVE', linked by profile_id.
-- This makes the existing middleware bounce them from /dashboard/* to /owner/*, and
-- lets requireOwner admit them. We also backfill transactions.shipowner_id for their
-- vessels so /owner/invoices (RLS keyed on shipowner_id) shows their existing invoices.
-- Vessels need no backfill: their owner RLS already keys on vessels.owner_id=auth.uid().
--
-- Precise rollback: the created shipowner ids and backfilled transaction ids are
-- recorded in app_config (migration_070_*) so the DOWN reverts EXACTLY these rows.

DO $$
DECLARE
  v_created     uuid[] := '{}';
  v_backfilled  uuid[] := '{}';
  v_row         record;
BEGIN
  -- 1. Create one ACTIVE shipowner per SHIPPING_AGENT profile that lacks one.
  FOR v_row IN
    INSERT INTO public.shipowners (name, profile_id, official_email, official_email_source, account_state)
    SELECT COALESCE(p.full_name, p.email, 'Shipowner'), p.id, p.email, 'AGENT_CLAIM', 'ACTIVE'
    FROM public.profiles p
    WHERE p.role = 'SHIPPING_AGENT'
      AND NOT EXISTS (SELECT 1 FROM public.shipowners s WHERE s.profile_id = p.id)
    RETURNING id
  LOOP
    v_created := array_append(v_created, v_row.id);
  END LOOP;

  -- 2. Backfill transactions.shipowner_id for vessels owned by the newly-created
  --    owners (only NULLs; never overwrite an existing attribution).
  FOR v_row IN
    UPDATE public.transactions t
    SET shipowner_id = s.id
    FROM public.shipowners s
    JOIN public.vessels v ON v.owner_id = s.profile_id
    WHERE t.vessel_id = v.id
      AND t.shipowner_id IS NULL
      AND s.id = ANY(v_created)
    RETURNING t.id
  LOOP
    v_backfilled := array_append(v_backfilled, v_row.id);
  END LOOP;

  -- 3. Record precise rollback markers.
  INSERT INTO public.app_config (key, value)
  VALUES
    ('migration_070_created_shipowners',      to_jsonb(v_created)),
    ('migration_070_backfilled_transactions', to_jsonb(v_backfilled))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RAISE NOTICE 'mig 070: created % shipowners, backfilled % transactions',
    array_length(v_created, 1), array_length(v_backfilled, 1);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (precise revert via recorded markers):
-- DO $$
-- DECLARE v_created uuid[]; v_backfilled uuid[];
-- BEGIN
--   SELECT array(SELECT jsonb_array_elements_text(value)::uuid) INTO v_created
--     FROM public.app_config WHERE key='migration_070_created_shipowners';
--   SELECT array(SELECT jsonb_array_elements_text(value)::uuid) INTO v_backfilled
--     FROM public.app_config WHERE key='migration_070_backfilled_transactions';
--   UPDATE public.transactions SET shipowner_id = NULL WHERE id = ANY(v_backfilled);
--   DELETE FROM public.shipowners WHERE id = ANY(v_created);
--   DELETE FROM public.app_config
--     WHERE key IN ('migration_070_created_shipowners','migration_070_backfilled_transactions');
-- END $$;
-- ─────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Apply to the hosted DB**

Preferred (no DNS dependency): open the Supabase dashboard → project `dyjolepwxxsedwngkfox` → **SQL Editor**, paste the `DO $$ ... END $$;` block from Step 1, run it.

Or, if the direct DB host resolves:
```bash
PW=$(grep '^SUPABASE_DB_PASSWORD=' frontend/.env.local | cut -d= -f2- | tr -d '"' | tr -d "\r")
supabase db push --db-url "postgresql://postgres:${PW}@db.dyjolepwxxsedwngkfox.supabase.co:5432/postgres"
```
(If `db push` errors with "Remote migration versions not found in local migrations directory", do NOT run the suggested `migration repair --status reverted`; use the SQL Editor path instead — the migration history mismatch is a separate, pre-existing CLI issue.)

- [ ] **Step 3: Verify on hosted**

```bash
URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' frontend/.env.local | cut -d= -f2- | tr -d '"' | tr -d "\r")
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' frontend/.env.local | cut -d= -f2- | tr -d '"' | tr -d "\r")
echo "-- SHIPPING_AGENT profiles still missing a shipowners row (should be 0) --"
curl -s "$URL/rest/v1/profiles?select=id&role=eq.SHIPPING_AGENT" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" > /tmp/sa.json
echo "-- markers recorded --"
curl -s "$URL/rest/v1/app_config?select=key,value&key=like.migration_070*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
echo ""
echo "-- spot-check: every SHIPPING_AGENT profile now has a shipowners row --"
curl -s "$URL/rest/v1/shipowners?select=profile_id,account_state&account_state=eq.ACTIVE" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | head -c 800
echo ""
```
Expected: the `migration_070_created_shipowners` / `migration_070_backfilled_transactions` keys exist; every `SHIPPING_AGENT` profile id appears as a `profile_id` on an ACTIVE shipowner.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/070_promote_shipping_agents_to_owners.sql
git commit -m "feat(portal): mig 070 promote SHIPPING_AGENT profiles to active shipowners + backfill"
```

---

### Task 2: Remove the SHIPPING_AGENT impersonation tile

**Files:**
- Modify: `frontend/src/components/auth/PostLoginPage.tsx` (remove SHIPPING_AGENT from `IMPERSONATION_ROLES`, lines 33-40)
- Test: `frontend/src/components/auth/__tests__/PostLoginPage.impersonation.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/auth/__tests__/PostLoginPage.impersonation.test.tsx
import { describe, it, expect, vi } from 'vitest';

// next-intl + next/navigation are pulled in transitively; stub them so the module imports cleanly.
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { getUser: vi.fn() } }) }));

import { __IMPERSONATION_ROLES_FOR_TEST } from '../PostLoginPage';
import { UserRole } from '@/types/secure';

describe('PostLoginPage impersonation roles', () => {
    it('no longer offers SHIPPING_AGENT (armateurs now use the /owner portal)', () => {
        const keys = __IMPERSONATION_ROLES_FOR_TEST.map((r) => r.key);
        expect(keys).not.toContain(UserRole.SHIPPING_AGENT);
        expect(keys).toContain(UserRole.PORT_OFFICER);
        expect(keys).toContain(UserRole.FINANCE_ADMIN);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/auth/__tests__/PostLoginPage.impersonation.test.tsx`
Expected: FAIL — `__IMPERSONATION_ROLES_FOR_TEST` is not exported (and SHIPPING_AGENT still present).

- [ ] **Step 3: Edit PostLoginPage.tsx**

(a) Delete the SHIPPING_AGENT object (lines 33-40) from the `IMPERSONATION_ROLES` array so it reads:

```tsx
const IMPERSONATION_ROLES: RoleOption[] = [
    {
        key: UserRole.PORT_OFFICER,
        icon: <Anchor className="w-5 h-5" />,
        titleKey: 'role_port_officer',
        descriptionKey: 'role_port_officer_desc',
        accessLevel: 'LEVEL 3',
        color: '#10B981',
    },
    {
        key: UserRole.FINANCE_ADMIN,
        icon: <Building2 className="w-5 h-5" />,
        titleKey: 'role_finance_admin',
        descriptionKey: 'role_finance_admin_desc',
        accessLevel: 'LEVEL 3',
        color: '#EAB308',
    },
];
```

(b) Export the array for the test (add right after the array definition):

```tsx
// Exported for tests only — asserts the impersonation tile set.
export const __IMPERSONATION_ROLES_FOR_TEST = IMPERSONATION_ROLES;
```

(c) If `Ship` (lucide-react) is now unused after removing the tile, remove it from the import to keep the lint/build clean. Verify by searching the file for `Ship` usages before deleting.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/auth/__tests__/PostLoginPage.impersonation.test.tsx`
Expected: PASS.
Then: `cd frontend && npx tsc --noEmit` → EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/auth/PostLoginPage.tsx frontend/src/components/auth/__tests__/PostLoginPage.impersonation.test.tsx
git commit -m "feat(portal): drop SHIPPING_AGENT impersonation tile (armateurs use /owner now)"
```

---

### Task 3: End-to-end routing verification (manual smoke — no code change expected)

**Files:** none (verification task). If a gap is found, capture it and STOP for a follow-up task rather than improvising a middleware rewrite.

- [ ] **Step 1: Confirm a migrated armateur lands on /owner**

After mig 070 is applied to hosted, identify one migrated `SHIPPING_AGENT` account that has vessels+transactions (from Task 1 Step 3 output). With the dev server on :3300 and `feature.shipowner_portal_v1_enabled=true`:
- Log in as that account via `/login` (their existing password).
- Expected: role redirect to `/dashboard`, then middleware `isActiveShipowner` bounces to `/owner/*`. (The `isActiveShipowner` cache is 5-min/Edge-instance; a fresh login on a fresh server instance is clean.)
- On `/owner/invoices`: their previously-visible invoices appear (proves the `shipowner_id` backfill worked).
- On `/owner/vessels`: their vessels appear (proves `owner_id` RLS).

- [ ] **Step 2: Confirm staff are unaffected**

Log in as a staff account (e.g. SUPERADMIN/FINANCE_ADMIN). Expected: lands on `/dashboard`, no bounce to `/owner`, `/admin/*` still reachable.

- [ ] **Step 3: Confirm the impersonation tile is gone**

Visit `/post-login` as SUPERADMIN. Expected: only PORT_OFFICER and FINANCE_ADMIN tiles; no "Shipping Agent" tile.

- [ ] **Step 4: Record results**

Note pass/fail for each in the PR description. No commit (verification only).

---

## Final verification (after all tasks)
- [ ] `cd frontend && npx tsc --noEmit` → EXIT 0
- [ ] `cd frontend && npx vitest run` → all pass, no regressions
- [ ] `cd frontend && npx next build` → green
- [ ] Mig 070 applied to hosted; markers recorded; manual smoke (Task 3) green.

## Notes for the implementer
- **No middleware edit is expected.** If Task 3 reveals the redirect doesn't fire, STOP and report — do not rewrite the middleware speculatively (it already has the active-shipowner bounce; a gap is more likely a cache/flag issue).
- **No `profiles.role` change** — routing is `shipowners`-based; leaving role=SHIPPING_AGENT is intentional. `/login` still role-redirects to `/dashboard`, and the middleware re-routes to `/owner`. Phase 2 makes `/owner/login` itself accept these accounts.
- The i18n keys `role_shipping_agent` / `role_shipping_agent_desc` become unused after Task 2 — harmless; leave them (Phase 2/3 may reuse).
- **Deferred (later phases):** dual-method `/owner/login` (Phase 2); porting Map/Simulator/TCO/Disputes/My Fleet into `/owner` (Phase 3). Migrated armateurs have the slim `/owner` nav until Phase 3 — accepted.
