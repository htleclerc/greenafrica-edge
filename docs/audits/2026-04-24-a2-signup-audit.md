# A2 Self-Service Signup Audit — SHIPPING_AGENT path

**Date**: 2026-04-24
**Scope**: Plan 5 Task 7 — verify that the existing `/signup` flow works end-to-end for SHIPPING_AGENT role.
**Branch**: `feat/carbon-tax-admin-escalation`
**Auditor**: Claude (static code review only — local Supabase stack not exercised in this session).

## Summary

The `/signup` flow is **functional for the register half** (a SHIPPING_AGENT can submit the form, a `registration_requests` row is created, and an `auth.users` + `profiles(is_active=false)` pair is provisioned atomically by `/api/auth/register`). However, the **approval half has a latent P0 bug**: `/api/auth/approve` writes `regRequest.requested_role` back onto `profiles.role` verbatim, and `requested_role` is a **form role** (e.g. `FLEET_MANAGER`, `LEGAL_REP`, `COMPLIANCE_AUDITOR`) which is not part of the `user_role` Postgres enum — approval of any non-canonical role will throw an enum violation and leave the user permanently stuck at `is_active=false`. A secondary P0 is that the admin UI at `/dashboard/validations` is not gated by role or wired into the sidebar, so in practice SUPERADMIN/PORT_OFFICER admins have no discoverable route to approve pending signups. The `supabase/functions/approve-registration` Edge Function is **dead code** (never called from anywhere, and if it were called it would fail because the user already exists at that point — register route creates them eagerly).

## Files inspected

- `frontend/src/app/(auth)/signup/page.tsx` — thin route wrapper, renders `<SignupPage />`.
- `frontend/src/components/auth/SignupPage.tsx` — 3-step wizard (entity → org/role → account → prefs) with client-side validation; submits to `/api/auth/register`.
- `frontend/src/app/api/auth/register/route.ts` — atomic registration: creates `auth.users` (via service-role admin), `profiles(is_active=false)`, and `registration_requests(status='PENDING')` in one handler. Maps 8 form roles to 4 DB roles via `ROLE_MAP`.
- `frontend/src/app/api/auth/register/route.test.ts` — unit tests for `ROLE_MAP` exhaustiveness and correctness (passes).
- `frontend/src/app/api/auth/approve/route.ts` — real approval path (called by AgentValidationsPage). Flips `is_active=true` and re-assigns `role`.
- `supabase/functions/approve-registration/index.ts` — Edge Function, **dead code** (grep confirms no frontend reference).
- `supabase/migrations/002_create_registration_requests.sql` — table + enums + RLS.
- `supabase/migrations/020_add_manager_role.sql` — adds MANAGER to `user_role` enum + RLS for registration_requests.
- `frontend/src/app/(dashboard)/dashboard/validations/page.tsx` + `frontend/src/components/dashboard/validations/AgentValidationsPage.tsx` — admin UI to approve/reject registrations. Route exists but has **no role guard** on the page.
- `frontend/src/middleware.ts` — auth-only gate; no role-based gating.
- `frontend/src/components/auth/LoginPage.tsx` — checks `profile.is_active` on login and bounces to `/pending-approval` if false.
- `frontend/src/services/registrationService.ts` — helper CRUD for registration_requests (used only by tests / ancillary code).

## Audit checklist

### ✅ Signup form includes SHIPPING_AGENT role

**Evidence**: `SignupPage.tsx:138-142` defines `SHIPPING_AGENT_ROLES` with `FLEET_MANAGER`, `FINANCE_CONTACT`, `LEGAL_REP`. `SignupPage.tsx:267-314` shows the entity-type step where the user picks "Shipping Agent", which routes to these roles. The server schema (`route.ts:12-23`) accepts all three, plus a raw `SHIPPING_AGENT` variant for future forms.

**Caveat**: The UI never offers the literal `SHIPPING_AGENT` form-role value (the three shipping-side buttons expose `FLEET_MANAGER` / `FINANCE_CONTACT` / `LEGAL_REP`), which is fine — `ROLE_MAP` collapses all three to `SHIPPING_AGENT` at register time.

### ✅ Register route stores password (via auth.users) + creates registration_requests row

**Evidence**: `route.ts:104-113` creates the auth user via `auth.admin.createUser` with the real password (bcrypted inside Supabase). `route.ts:125-133` upserts a `profiles` row with `is_active=false`. `route.ts:145-162` inserts a `registration_requests` row with `requested_role=submittedRole` (the original form role, e.g., `FLEET_MANAGER`), and a placeholder `password_hash: '***'` — the actual password is in `auth.users`, not duplicated. This is an **intentional deviation** from the original design in migration 002 (which made `password_hash` NOT NULL for deferred user creation) and is now dead storage.

**Caveat — NOT-NULL mismatch**: `migrations/002_create_registration_requests.sql:38` declares `password_hash TEXT NOT NULL`. The register route passes the literal string `'***'` to satisfy the constraint. This works, but the column is now semantic rubbish and should be dropped or made nullable in a future migration.

### ❌ approve-registration edge function creates auth.users + profiles

**Evidence**: `supabase/functions/approve-registration/index.ts` exists (180 lines) and tries to do what Plan 1 assumed: re-create the auth user at approval time. But:

1. **It is never called.** `grep -r 'approve-registration' frontend/` returns zero hits. The function is orphaned.
2. **If called, it would 409.** Line 115-135 tries `auth.admin.createUser` with the registration's email — but the register route already created that user. Line 128-132 handles the "already been registered" error by returning 409, so the function would immediately abort.
3. The real approval path is `/api/auth/approve` (frontend/src/app/api/auth/approve/route.ts), which does NOT create an auth user; it just sets `is_active=true` on the existing profile.

### ❌ Approved SHIPPING_AGENT can log in + reach /dashboard → P0 bug in approve route

**Evidence (static)**: `/api/auth/approve/route.ts:70-77`:

```ts
const { error: updateError } = await adminClient
    .from('profiles')
    .update({
        is_active: true,
        role: regRequest.requested_role,   // ← bug: form role, not DB role
    })
    .eq('id', targetProfile.id);
```

`regRequest.requested_role` is the **form role** as submitted to `/api/auth/register` (e.g. `FLEET_MANAGER`, `FINANCE_CONTACT`, `LEGAL_REP`, `COMPLIANCE_AUDITOR`, `OPERATIONS_MANAGER`). These are NOT valid values of the `user_role` Postgres enum (which contains `PORT_OFFICER | FINANCE_ADMIN | SHIPPING_AGENT | INSTITUTION | SUPERADMIN | MANAGER` after migration 020). Approving any non-canonical role will raise `invalid input value for enum user_role`, the update silently returns an error, and the user remains `is_active=false`. Meanwhile `registration_requests.status` is updated to `APPROVED` right after (line 82-90) even if the profile update failed — divergent state between profile and registration_requests.

The register route already mapped the role correctly onto `profiles.role` at signup time (line 80 `ROLE_MAP[submittedRole]`), so the approve route's re-assignment is both wrong and redundant. Simplest fix: **drop the `role` field from the approve update** — just flip `is_active`, trust the mapping that register did. Alternate fix: re-apply `ROLE_MAP` on the approve side. The first is strictly better (single source of truth, no drift).

**Not tested locally** — dev stack not exercised this session. The static read is unambiguous enough to treat as confirmed.

### ⚠️ Admin UI exists to approve pending registrations (but is not discoverable and not guarded)

**Evidence**:

- Page: `frontend/src/app/(dashboard)/dashboard/validations/page.tsx` (a 9-line wrapper). Component: `AgentValidationsPage.tsx` — full CRUD UI for PENDING/APPROVED/REJECTED/MORE_INFO tabs, calls `/api/auth/approve` (line 436) correctly.
- **Gap 1 — no role guard**: unlike `incoming-vessels/page.tsx:23-25` which checks `profile.role`, the `validations` page has no role check. Any authenticated user can load `/dashboard/validations`, see pending registrations (RLS restricts to PORT_OFFICER/SUPERADMIN/MANAGER in migration 020, so unauthorized users just see an empty list), and click "approve" (which `/api/auth/approve` blocks via `requireRole`). Safe but noisy.
- **Gap 2 — no sidebar link**: I grepped for `'/dashboard/validations'` under `components/dashboard/layout/` — **zero matches**. An admin has to type the URL manually to reach the page. This is the primary reason A2 probably feels "broken" in practice.

### ⚠️ Rate limits + email verification — partial

- **Rate limiting**: `frontend/src/lib/rateLimit.ts` exists and is used by `/api/invoices/[ref]/download` and `/verify/[ref]`, but **not by `/api/auth/register`**. A scripted attacker could enumerate / spam the registration endpoint.
- **Email verification**: `register/route.ts:107` passes `email_confirm: true` — Supabase treats the email as pre-confirmed. No real email-ownership check happens. The admin approval flow is treated as the verification step (i.e., the admin manually sanity-checks the address and org before flipping `is_active`). Acceptable for a gov-gated platform, but worth documenting as a deliberate choice, not a gap. See P2 below.

## Fixes needed (priority order)

### P0 — blockers

1. **`/api/auth/approve/route.ts:70-77` writes an invalid enum value onto `profiles.role`.** Two options:
   - (Preferred) Remove the `role: regRequest.requested_role` line entirely — the register route already set the correct mapped role.
   - (Alt) Re-apply the same `ROLE_MAP` from the register route.
   Also: if the profile update fails, short-circuit before updating `registration_requests.status` to APPROVED — otherwise the two rows desync.
2. **No sidebar entry for `/dashboard/validations`.** Admins can't find the approval UI. Either (a) add a sidebar link gated on `SUPERADMIN | PORT_OFFICER | MANAGER`, or (b) surface a "Pending approvals" widget on `/dashboard` for admin roles.

### P1 — important

3. **Add role guard to `/dashboard/validations/page.tsx`** — mirror the pattern from `incoming-vessels/page.tsx:12-25`. Redirect non-admin users to `/dashboard`.
4. **Delete the dead edge function `supabase/functions/approve-registration/`** (or clearly mark it `@deprecated` in a comment and add a README in `supabase/functions/`). The stale code is confusing — Plan 1 explicitly pointed at it as "the approval path", which it is not.
5. **Rate-limit `/api/auth/register`.** Reuse `lib/rateLimit.ts`. Suggested: 5 req / IP / minute.
6. **Sync the approve route's role-enum handling with migration 020.** If the "re-map" path is chosen, use the same `ROLE_MAP` object exported from register route (DRY).

### P2 — nice to have

7. **Drop `password_hash` from `registration_requests`** (or make it nullable + add a comment: `-- legacy; password lives on auth.users, not here`). Current `'***'` placeholder is a code smell.
8. **Document the "email pre-confirmed" decision** in the register route or a short `docs/adr/` note — explain that admin approval is the human verification step, so `email_confirm: true` is intentional. Add a sentence to the signup form's security notice.
9. **The `route.ts` zod schema has `OPERATIONS_MANAGER`** (line 17) but the signup UI never offers it (the Port-Authority role list is Port Officer / Finance Admin / Compliance Auditor / Superadmin). Either add the Operations Manager button to the UI (makes sense given migration 020 introduced the MANAGER DB role), or drop it from the schema. Also `role_operations_manager` / `_desc` exist in `messages/en.json:1537-1538` — dead i18n keys today.
10. **UI edge case**: `SignupPage.tsx:135` lists `SUPERADMIN` as a Port Authority role — it's permanently disabled (`isRestricted = r.key === 'SUPERADMIN'`) and not in the zod schema, so it's cosmetic-only. Minor polish: just remove it and leave the "SUPERADMIN is created manually" rule to route.ts. But the UI intent (showing users "this role exists but isn't self-serve") has some value — non-blocker.
11. **`registration_requests.reviewed_by` display is faked** — `AgentValidationsPage.tsx:52` sets `reviewedBy: row.review_note ? 'Admin' : undefined` instead of reading the real `reviewed_by` UUID and resolving it to a name. Cosmetic only.

## Fixes applied in this task

No code fixes were applied in the same commit. Every identified finding is either (a) a P0 that deserves its own task and a test (fix the approve route's role handling) or (b) a non-trivial UI/UX change (sidebar link, role guard, dead-code removal) that shouldn't ride in a `docs(audit):` commit.

The audit itself is the deliverable.

## Deferred (require future work)

All items in P0/P1/P2 above are deferred to follow-up tasks. Suggested grouping for the next plan:

- **Task A (P0, 1–2h)**: Fix `/api/auth/approve` role-enum bug + add a test that approves each of the 8 form roles end-to-end and asserts `profiles.role` lands on a valid enum value. Add error-path test: profile update fails → registration_requests stays PENDING.
- **Task B (P0, ~1h)**: Add sidebar entry "Validations" under admin, gated on `SUPERADMIN | PORT_OFFICER | MANAGER`, pointing to `/dashboard/validations`.
- **Task C (P1, 30min)**: Add role guard to `validations/page.tsx`; delete dead `approve-registration` edge function.
- **Task D (P1, 30min)**: Rate-limit `/api/auth/register` via existing `lib/rateLimit.ts`.
- **Task E (P2, cleanup)**: Drop or nullable-ify `registration_requests.password_hash`; reconcile `OPERATIONS_MANAGER` between schema/UI/i18n; resolve `reviewed_by` to a real name in the UI.
