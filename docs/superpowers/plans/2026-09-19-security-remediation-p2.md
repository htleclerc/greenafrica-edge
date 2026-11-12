# Security Remediation P2 Implementation Plan

> **Renumbered 2026-11-12 — read this before following any migration path below.**
> These migrations shipped as **167–171**, not 161–165. Migration 166
> (`166_revoke_all_user_sessions.sql`, session closure on staff password reset)
> reached production first, on 2026-11-11, so this branch was renumbered to keep
> the journal in order: **161→167, 162→168, 163→169, 164→170, 165→171**.
> The file names and cross-references on the branch are correct; the numbers kept
> in the body below are the ones originally assigned on 2026-09-19.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Second remediation batch for AfricGreen (Next.js + Supabase money-rail app) — the P2 items deferred from the 2026-09-19 review, plus the parked wallet-jurisdiction follow-up.

**Architecture:** Continues on branch `feat/security-remediation-2026-09` (do NOT create a new branch). Code/SQL fixes only. Nothing is pushed. Commits: `git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`, explicit staging, humanized messages, no AI attribution.

**Tech Stack:** Next.js 16.3.5, TypeScript, Supabase (Postgres + RLS + GoTrue MFA), Vitest, `@supabase/supabase-js`.

**Spec:** the verified findings of the 2026-09-19 security review (source of truth).

## Global Constraints

- Continue on `feat/security-remediation-2026-09`. Migrations `supabase/migrations/NNN_name.sql`; highest existing is now **163**. This plan uses **164** (Task C) and **165** (Task D).
- New/replaced `SECURITY DEFINER` functions MUST keep `SET search_path` set and use fully-qualified `public.*` identifiers, with a `-- DOWN:` block.
- TypeScript bans `any` (`no-explicit-any`); use `unknown` + narrowing or concrete types.
- Service-role access only via `createTenantClient`/`createPlatformClient` (`@/lib/supabase/tenant`).
- MFA is OPTIONAL for staff (project decision): any AAL gate must only bite when the user has an enrolled factor but an un-elevated session (`currentLevel==='aal1' && nextLevel==='aal2'`) — a user with no factor (`nextLevel==='aal1'`) must pass unaffected.
- No live database this session (Docker down): migration tasks (C, D) write + review the SQL but their apply/psql verification is PENDING for the owner. Code tasks (A, B) run their vitest suites (DB mocked).
- Tests: `npm --prefix frontend test -- <file>`. Lint may OOM full-project; fall back to scoped `cd frontend && npx eslint <files>`.

---

### Task 1: Enforce AAL2 (elevated MFA) inside `requireRole` — closes the `/api` gap

**Why:** The middleware redirects `mfaPending` sessions away from `/dashboard`/`/admin` pages, but `/api/**` route handlers are not under those prefixes, and `requireRole` never checks AAL. So a staff member who enrolled TOTP but holds an un-elevated (AAL1) session can call money-rail endpoints (`/api/transactions/mark-paid`, `/api/admin/payment-config`, `/api/admin/payments/*`, `/api/admin/refunds/*`, `/api/admin/wallets/*`, …) directly. Adding the AAL check to `requireRole` closes every `requireRole`-gated route at once, and — because it only bites when a factor is enrolled — keeps MFA optional.

**Files:**
- Modify: `frontend/src/lib/auth/requireRole.ts` (add the AAL check + a 403 branch)
- Test: `frontend/src/lib/auth/requireRole.test.ts` (create)

**Interfaces:**
- Consumes: `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` from the server client already created in `requireRole`.
- Produces: unchanged `RequireRoleResult`; a new 403 failure when the session is AAL1-with-factor-enrolled.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/auth/requireRole.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

let aal: { currentLevel: string | null; nextLevel: string | null } = { currentLevel: 'aal1', nextLevel: 'aal1' };
let profileRow: Record<string, unknown> | null = {
    id: 'u-1', email: 'a@b.com', full_name: 'A', role: 'FINANCE_ADMIN',
    operational_site: null, country_code: 'SO', timezone: null, preferred_language: 'en',
    is_active: true, ip_address: null, can_settle_payments: true, payments_only: false,
};

const supabase = {
    auth: {
        getUser: async () => ({ data: { user: { id: 'u-1', last_sign_in_at: '' } }, error: null }),
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal, error: null }) },
    },
    from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: profileRow, error: null }) }) }),
    }),
};

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => supabase) }));

beforeEach(() => {
    aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
    profileRow = {
        id: 'u-1', email: 'a@b.com', full_name: 'A', role: 'FINANCE_ADMIN',
        operational_site: null, country_code: 'SO', timezone: null, preferred_language: 'en',
        is_active: true, ip_address: null, can_settle_payments: true, payments_only: false,
    };
    vi.clearAllMocks();
});

describe('requireRole AAL gate', () => {
    it('rejects an AAL1 session when a factor is enrolled (nextLevel aal2)', async () => {
        aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
        const { requireRole } = await import('./requireRole');
        const { UserRole } = await import('@/types/secure');
        const res = await requireRole([UserRole.FINANCE_ADMIN]);
        expect(res.error).not.toBeNull();
        expect(res.error?.status).toBe(403);
    });

    it('allows a user with no enrolled factor (nextLevel aal1)', async () => {
        aal = { currentLevel: 'aal1', nextLevel: 'aal1' };
        const { requireRole } = await import('./requireRole');
        const { UserRole } = await import('@/types/secure');
        const res = await requireRole([UserRole.FINANCE_ADMIN]);
        expect(res.error).toBeNull();
        expect(res.user?.role).toBe(UserRole.FINANCE_ADMIN);
    });

    it('allows an already-elevated AAL2 session', async () => {
        aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
        const { requireRole } = await import('./requireRole');
        const { UserRole } = await import('@/types/secure');
        const res = await requireRole([UserRole.FINANCE_ADMIN]);
        expect(res.error).toBeNull();
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm --prefix frontend test -- src/lib/auth/requireRole.test.ts`
Expected: the first test FAILS (no AAL gate yet — returns success instead of 403).

- [ ] **Step 3: Add the AAL gate to `requireRole`**

In `frontend/src/lib/auth/requireRole.ts`, insert this block AFTER the `if (!profile.is_active)` check (around line 96) and BEFORE `const role = profile.role as UserRole;`:

```ts
    // MFA elevation gate. Middleware only enforces AAL2 on page prefixes
    // (/dashboard, /admin, …); /api route handlers slip past it. Enforce it here
    // so a valid-but-un-elevated AAL1 session cannot drive money-rail endpoints.
    // MFA stays optional: this only bites when a factor is enrolled — nextLevel
    // is 'aal2' while currentLevel is still 'aal1'. A user with no factor has
    // nextLevel 'aal1' and passes untouched.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
        return {
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Forbidden — MFA elevation required' }, { status: 403 }),
        };
    }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm --prefix frontend test -- src/lib/auth/requireRole.test.ts`
Expected: all three tests PASS.

- [ ] **Step 5: Scoped lint + commit**

Run: `cd frontend && npx eslint src/lib/auth/requireRole.ts src/lib/auth/requireRole.test.ts` → clean.
Stage those two files; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(auth): exige l'élévation MFA (AAL2) aussi sur les routes /api"`.

---

### Task 2: Scope the arrival-alert claim to the agent's jurisdiction

**Why:** `claimArrivalAlert` claims an alert and writes an owner email via an UNSCOPED `createPlatformClient()`; `claimAlert` filters only on `id`+`status`. `arrival_alerts` is a tenant-scoped table. A `SHIPPING_AGENT` in one jurisdiction can claim an alert in another (given its UUID) and stamp an attacker-supplied email onto that shipowner. The code comment defers scoping to "Wedge 2" — which has shipped (Djibouti live). Fix: resolve the alert's jurisdiction, verify the agent belongs to it, then do all writes through `createTenantClient(jid)` (which auto-scopes `arrival_alerts`, `shipowners`, and stamps the ghost owner's jurisdiction).

**Files:**
- Modify: `frontend/src/actions/claimArrivalAlert.ts`
- Test: `frontend/src/actions/claimArrivalAlert.test.ts` (extend)

**Interfaces:**
- Consumes: `createTenantClient` from `@/lib/supabase/tenant`; `user_jurisdictions` (agent membership).
- Produces: same return contract `{ ok: true; alertId } | { ok: false; reason }`.

- [ ] **Step 1: Read the current file and its test** to match structure. Current claim flow: auth → SHIPPING_AGENT role check → `createPlatformClient()` → `claimAlert` → resolve/create ghost → `upsertShipownerEmail` → `rpc('pgmq_enqueue_proforma')`.

- [ ] **Step 2: Refactor the client resolution.** Replace the `createPlatformClient()` block with: (a) look up the alert's `jurisdiction_id` using a platform client (read-only, by id); if not found, return `{ ok:false, reason:'alert not found or already claimed' }` (same opaque message the claim uses); (b) verify the agent is a member of that jurisdiction; (c) build a tenant client for the rest.

Concretely, after the `profile?.role !== 'SHIPPING_AGENT'` check, replace the platform-client acquisition with:

```ts
    // Resolve the alert's jurisdiction and confirm the agent belongs to it BEFORE
    // any write. arrival_alerts is tenant-scoped; without this an agent could claim
    // another State's alert by guessing its id and stamp an email onto that owner.
    let lookup;
    try {
        lookup = createPlatformClient();
    } catch {
        return { ok: false, reason: 'supabase service role not configured' };
    }
    const { data: alertRow } = await lookup
        .from('arrival_alerts')
        .select('jurisdiction_id')
        .eq('id', alertId)
        .maybeSingle();
    // Opaque: same message whether it doesn't exist or belongs to another State.
    if (!alertRow?.jurisdiction_id) {
        return { ok: false, reason: 'alert not found or already claimed' };
    }
    const jurisdictionId = alertRow.jurisdiction_id as string;

    const { data: membership } = await lookup
        .from('user_jurisdictions')
        .select('user_id')
        .eq('user_id', auth.user.id)
        .eq('jurisdiction_id', jurisdictionId)
        .maybeSingle();
    if (!membership) {
        return { ok: false, reason: 'alert not found or already claimed' };
    }

    // All subsequent writes go through the jurisdiction-scoped client: the claim
    // UPDATE, the ghost shipowner, and the email upsert are all auto-confined and
    // auto-stamped to this jurisdiction.
    const admin = createTenantClient(jurisdictionId);
```

Keep the rest of the flow (`claimAlert(admin, …)`, ghost creation, `upsertShipownerEmail(admin, …)`, `rpc('pgmq_enqueue_proforma', …)`) unchanged — it now runs on the tenant client. Update the import line to bring in `createTenantClient` alongside `createPlatformClient`. Remove the now-stale "Single-country foundation … deferred to Wedge 2 … UNSCOPED platform client" comment.

- [ ] **Step 3: Extend the test.** In `frontend/src/actions/claimArrivalAlert.test.ts`, add mocks so:
  - `createPlatformClient` returns a client whose `from('arrival_alerts').select().eq().maybeSingle()` yields `{ jurisdiction_id: 'jur-1' }` and whose `from('user_jurisdictions')...maybeSingle()` yields a membership row (or `null` to simulate a foreign alert).
  - `createTenantClient` is mocked (`vi.fn`) and the test asserts it is called with `'jur-1'`.
  - Add a test: when the membership lookup returns `null`, the action returns `{ ok:false, reason:/not found/i }` and `createTenantClient` is NOT called.
  Keep the existing "validates owner email" test passing. Use concrete types, no `any`.

- [ ] **Step 4: Run the test**

Run: `npm --prefix frontend test -- src/actions/claimArrivalAlert.test.ts`
Expected: PASS (existing + new membership-rejection + jurisdiction-scoping tests).

- [ ] **Step 5: Scoped lint + commit**

Run: `cd frontend && npx eslint src/actions/claimArrivalAlert.ts src/actions/claimArrivalAlert.test.ts` → clean.
Stage those two files; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(alerts): confine la réclamation d'escale à la juridiction de l'agent"`.

---

### Task 3: Pin `search_path` on every SECURITY DEFINER function (migration 164)

**Why:** Several `SECURITY DEFINER` functions lack a pinned `search_path`; in Postgres that is a privilege-escalation vector (a caller-controlled schema earlier in the path can shadow an unqualified reference). Rather than hand-enumerate a fragile list (some candidates are redefined by later migrations, some are not SECURITY DEFINER, one migration has no function), use a `DO` block that pins every SECURITY DEFINER function in `public` that isn't already pinned — idempotent, exact, body-preserving (`ALTER FUNCTION` does not touch the function body, so it cannot break behavior).

**Files:**
- Create: `supabase/migrations/164_pin_secdef_search_path.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/164_pin_secdef_search_path.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 164: pin search_path on every SECURITY DEFINER function in public
-- that isn't already pinned. Unpinned SECURITY DEFINER functions let a caller
-- shadow unqualified references via a schema earlier in the search_path — a
-- privilege-escalation vector. ALTER FUNCTION only sets the config; it does not
-- rewrite the body, so behavior is unchanged. Idempotent: re-running skips
-- functions that already carry a search_path.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef                                   -- SECURITY DEFINER only
       AND NOT EXISTS (
             SELECT 1
               FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c
              WHERE c LIKE 'search_path=%'
           )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', r.sig);
    RAISE NOTICE 'pinned search_path on %', r.sig;
  END LOOP;
END $$;

-- DOWN:
-- No automatic rollback. Pinning search_path is a safe hardening; un-pinning
-- would also strip functions that were pinned before this migration. To revert a
-- specific function: ALTER FUNCTION public.<name>(<args>) RESET search_path;
```

- [ ] **Step 2: Sanity-check the SQL parses** (no DB to apply). Read it back; confirm the `pg_proc`/`pg_namespace` join, the `proconfig` unnest guard, and the `format(... %s ...)` with `regprocedure` are syntactically correct (this is the standard Supabase-linter-style remediation). Confirm migration number 164 is free (`ls supabase/migrations | grep '^164'` returns nothing).

- [ ] **Step 3: Commit**

Stage only `supabase/migrations/164_pin_secdef_search_path.sql`; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(db): épingle le search_path des fonctions SECURITY DEFINER"`. Report DB-apply verification as PENDING for the owner (apply to staging, confirm the RAISE NOTICE lists the expected functions and none error).

---

### Task 4: Stamp the real jurisdiction on wallet-applied payments (migration 165)

**Why:** The atomic wallet RPC `apply_wallet_credit` (migration 161) inserts `payments` (and `wallet_ledger`) without `jurisdiction_id`, so both fall back to the fixed Somaliland `DEFAULT` (migration 072). With Djibouti live, wallet-applied payments for non-Somaliland shipowners are mis-attributed in settlement reporting. This is the same class as the recordManualPayment fix (Task 2 of the first batch); the wallet path was parked because the RPC is service-role and not rejected by RLS. Fix: `CREATE OR REPLACE` the RPC to look up the shipowner's `jurisdiction_id` and stamp it on both inserts.

**Files:**
- Create: `supabase/migrations/165_wallet_apply_jurisdiction.sql`

**Interfaces:**
- Consumes: `public.shipowners.jurisdiction_id`.
- Produces: `apply_wallet_credit` with the same signature and return shape as migration 161 (no TS change needed).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/165_wallet_apply_jurisdiction.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 165: stamp the shipowner's real jurisdiction on wallet-applied
-- payments + ledger. apply_wallet_credit (mig 161) omitted jurisdiction_id, so
-- both rows fell back to the Somaliland DEFAULT (mig 072) — wrong for Djibouti
-- shipowners, corrupting settlement attribution. Same signature/return as 161;
-- the TS caller is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_wallet_credit(
  p_txn_id         UUID,
  p_shipowner_id   UUID,
  p_actor_user_id  UUID,
  p_amount_minor   BIGINT
) RETURNS TABLE(payment_id UUID, wallet_id UUID) AS $$
DECLARE
  v_wallet_id UUID;
  v_balance   BIGINT;
  v_jid       UUID;
  v_payment   UUID;
BEGIN
  -- Real jurisdiction of the shipowner (not the Somaliland column default).
  SELECT jurisdiction_id INTO v_jid
    FROM public.shipowners WHERE id = p_shipowner_id;
  IF v_jid IS NULL THEN
    RAISE EXCEPTION 'shipowner not found or has no jurisdiction: %', p_shipowner_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Lock the wallet row FIRST — serializes concurrent applications (the mig-161 fix).
  SELECT id, balance_usd_minor INTO v_wallet_id, v_balance
    FROM public.wallets WHERE shipowner_id = p_shipowner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet not found for shipowner %', p_shipowner_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_balance < p_amount_minor THEN
    RAISE EXCEPTION 'insufficient wallet balance: % < %', v_balance, p_amount_minor
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.wallet_ledger (wallet_id, kind, amount_signed_usd_minor, created_by, jurisdiction_id)
    VALUES (v_wallet_id, 'PROFORMA_APPLY', -p_amount_minor, p_actor_user_id, v_jid);

  INSERT INTO public.payments (
    transaction_id, shipowner_id, declared_by, amount_minor, currency,
    amount_usd_minor, rail, status, confirmed_by, confirmed_at, rail_details, jurisdiction_id
  ) VALUES (
    p_txn_id, p_shipowner_id, p_actor_user_id, p_amount_minor, 'USD',
    p_amount_minor, 'WALLET', 'CONFIRMED', p_actor_user_id, NOW(),
    jsonb_build_object('applied_by_owner', true), v_jid
  ) RETURNING id INTO v_payment;

  RETURN QUERY SELECT v_payment, v_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_wallet_credit(UUID, UUID, UUID, BIGINT) TO service_role;

-- DOWN:
-- Restore the migration-161 body (without jurisdiction_id stamping). See
-- supabase/migrations/161_wallet_apply_atomic.sql for the prior definition.
```

- [ ] **Step 2: Verify consistency.** Confirm: signature identical to migration 161 (so `walletApplyService.ts` needs no change); `wallet_ledger` and `payments` both have a `jurisdiction_id` column (migration 072 — yes); `SET search_path = ''` retained with fully-qualified identifiers; REVOKE/GRANT retained. Confirm 165 is free.

- [ ] **Step 3: Commit**

Stage only `supabase/migrations/165_wallet_apply_jurisdiction.sql`; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(wallet): tampon de juridiction réelle sur les paiements portefeuille"`. DB-apply verification PENDING for the owner (apply after 161; confirm a Djibouti shipowner's wallet application stamps Djibouti on both payment and ledger).

---

## Self-Review

**Spec coverage:** 2.1 AAL2 `/api` gate (Task A); 2.2 arrival-alert scoping (Task B); 2.5 search_path pins (Task C); parked wallet-jurisdiction follow-up (Task D). NOT in this plan: P3 defense-in-depth (CSP nonce, ESLint-rule hardening, dispute scheme allowlist, timing-safe compares) and the pre-commit/CI secret-scanning prevention — offer as a P3 batch next.

**Placeholder scan:** none — every step has real code. Task B step 3 gives concrete mock requirements + assertions against the existing test file rather than inventing its full harness (the file already exists and its shape must be matched).

**Type/interface consistency:** Task D keeps `apply_wallet_credit`'s signature and `RETURNS TABLE(payment_id, wallet_id)` identical to migration 161, so `walletApplyService.ts` is untouched. Task A's AAL branch returns the same `RequireRoleFailure` shape as the existing 401/403 branches. Migration order 164 (search_path) then 165 (wallet replace) is safe: 164 skips `apply_wallet_credit` (already pinned since 161), and 165 re-declares it still pinned.

## Notes for the executor

- Continue on `feat/security-remediation-2026-09`; do NOT push. Commit per task (author Loïc Leclerc, no AI attribution, explicit staging).
- Order A → B → (C+D batched) is reasonable; C and D are independent migration-only tasks and may be one dispatch with two commits.
- Tasks C and D need a DB to fully verify; apply/psql steps are PENDING for the owner.
