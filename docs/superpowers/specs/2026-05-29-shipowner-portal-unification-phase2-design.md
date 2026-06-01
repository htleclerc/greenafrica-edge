# Shipowner Portal Unification — Phase 2 (Unified Dual-Method Login)

**Date:** 2026-05-29
**Status:** Approved (pending written-spec review)
**Author:** Loic Leclerc + Claude

## Background

Part of converging the legacy armateur and v7 owner onto the single `/owner` portal (see `2026-05-28-shipowner-portal-unification-phase1-design.md`). Phase 1 made all shipowner-side users land on `/owner` (identity + routing). **Phase 2 unifies the login**: `/owner/login` gains password auth alongside the existing magic-link, and `/login` is branded staff-first with an owner sign-in link.

Today: `/owner/login` is magic-link only (`signInWithOtp`, `shouldCreateUser=false` → `/owner/auth/callback`); owners are passwordless. Staff `/login` uses `signInWithPassword`. Reset infra already exists for staff (`ForgotPasswordPage`, `ResetPasswordPage`, `resetPasswordForEmail`/`updateUser`).

### Decisions (locked)
1. `/owner/login` = **password + magic-link** on one page.
2. Owners get a password via an **email reset/set flow** (`resetPasswordForEmail` → owner reset page → `updateUser`). Magic-link stays for the passwordless path.
3. `/login` stays **functional** but is branded staff-first + gets an **"Armateur ? → /owner/login"** link (no pre-auth shipowner detection — avoids email enumeration; a shipowner who logs in via `/login` is already routed to `/owner` by the Phase-1 middleware).

## Goal (Phase 2)
A shipowner can sign in at `/owner/login` with **either** a password **or** a magic-link, and can set/reset their password via email. Staff are unaffected and find a clear path to the owner portal from `/login`.

## Non-Goals
- Porting Map/Simulator/TCO/Disputes/My Fleet into `/owner` (Phase 3).
- Removing magic-link (it stays — canonical first-entry that redeems invites).
- Pre-auth shipowner detection / hard-blocking `/login` (enumeration risk; rejected).
- Changing the invite/`account_state` lifecycle (the `/owner/auth/callback` INVITED→ACTIVE redeem is unchanged).

## Key facts (established)
- `OwnerLoginForm` (`frontend/src/app/owner/login/OwnerLoginForm.tsx`): magic-link only; uses `OsInput`/`OsButton`, `useTranslations('OwnerPortal.login')`, generic "link sent" success (anti-enumeration).
- Staff reset components exist: `frontend/src/components/auth/ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` (pattern: recovery session from the email link → `updateUser({ password })`).
- Middleware (`frontend/src/middleware.ts`): `OWNER_PUBLIC_PATHS = ['/owner/login','/owner/register','/owner/auth/callback']`; owner-protected paths without a session bounce to `/owner/login`.
- `requireOwner` admits only `shipowners(account_state='ACTIVE')` for `auth.uid()`.
- Supabase Auth redirect allowlist already includes `http://localhost:3300/owner/auth/callback` (verified this session via `generate_link`). A new `/owner/reset-password` redirect target must be **added to the allowlist** (dashboard → Auth → URL config) — ops step.

## Design

### 1. `/owner/login` — dual-method form
Refactor `OwnerLoginForm` into a single form with:
- **Email + password** fields → `supabase.auth.signInWithPassword({ email, password })`. On success: client-side redirect to the `redirectTo` query param if present and owner-scoped, else `/owner/dashboard`. (`requireOwner` validates server-side; an INVITED/non-ACTIVE owner is bounced back to `/owner/login` — expected.)
- **"Email me a login link" toggle/secondary action** → the existing `signInWithOtp` path (unchanged: `shouldCreateUser:false`, `emailRedirectTo=/owner/auth/callback`, generic "link sent" message).
- **"Set / reset password" link** → `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${origin}/owner/reset-password\` })`; always show the same generic "if that email exists, we sent a link" confirmation (anti-enumeration).
- Password sign-in errors render a single generic message (`errors.invalidCredentials`) — never reveal whether the email exists or whether a password is set. Add a hint: "No password yet? Use the email link or set one."

Keep the component focused; if it grows unwieldy, split the magic-link branch into a small sub-component (decided at plan time).

### 2. `/owner/reset-password` page (new)
- Route `frontend/src/app/owner/reset-password/page.tsx` + a client form component mirroring the staff `ResetPasswordPage` logic: the reset email link establishes a recovery session; the form collects a new password (with confirm + min-length validation) and calls `supabase.auth.updateUser({ password })`; on success redirect to `/owner/dashboard` (or `/owner/login` with a success notice).
- Add `'/owner/reset-password'` to `OWNER_PUBLIC_PATHS` in the middleware so the email link is reachable (the recovery session is established by the link, not a prior portal session).

### 3. `/login` — staff-first + owner link
- In `LoginPage.tsx`, add a visible link "Armateur ? Connectez-vous ici → `/owner/login`". No functional change to staff auth; the Phase-1 middleware still routes any shipowner who logs in here to `/owner`.

### 4. i18n (EN + FR)
New `OwnerPortal.login.*` keys: `passwordLabel`, `passwordSubmit`, `useMagicLink`, `usePassword`, `setPassword`, `resetSent`, `errors.invalidCredentials`, `noPasswordHint`. New `OwnerPortal.resetPassword.*` keys for the reset page. One `Auth.*` (or `LoginPage.*`) key for the owner-portal link on `/login`.

## Error handling / edge cases
- Password login for an owner who never set one → generic "invalid credentials"; the hint nudges them to the email link / set-password.
- Password login for an INVITED (non-ACTIVE) owner → auth succeeds but `requireOwner` bounces to `/owner/login?error=state_invited` (existing behavior). The canonical first-entry remains magic-link (which redeems the invite → ACTIVE).
- `resetPasswordForEmail` for an unknown email → generic success (Supabase does not reveal existence).
- Reset link redirect not allowlisted → Supabase falls back to Site URL; documented ops step to add `/owner/reset-password` to the allowlist.

## Security
- No email enumeration: generic responses on magic-link, password sign-in, and reset.
- Owner password reset uses the same Supabase recovery-session mechanism as staff; no new trust boundary.
- `/owner/reset-password` is public (pre-session) like `/owner/login`; it only acts on a valid recovery session (Supabase-issued) — without one, `updateUser` fails and the page shows an error.

## Testing
- **OwnerLoginForm:** password submit calls `signInWithPassword` and redirects; magic-link action calls `signInWithOtp`; "set/reset password" calls `resetPasswordForEmail` and shows the generic confirmation; a failed password login shows the generic error and does NOT reveal existence.
- **Owner reset page:** submitting a new password calls `updateUser({ password })` and redirects to `/owner`; mismatch/short password is rejected client-side before any call.
- **Middleware:** `/owner/reset-password` is treated as public (no redirect to `/owner/login`).
- No regression in existing magic-link behavior or staff `/login`.

## Files (anticipated)
**New**
- `frontend/src/app/owner/reset-password/page.tsx`
- `frontend/src/app/owner/reset-password/OwnerResetPasswordForm.tsx`
- tests for the dual-method form + reset form

**Modified**
- `frontend/src/app/owner/login/OwnerLoginForm.tsx` (dual-method)
- `frontend/src/middleware.ts` (add `/owner/reset-password` to `OWNER_PUBLIC_PATHS`)
- `frontend/src/components/auth/LoginPage.tsx` (owner sign-in link)
- `frontend/messages/en.json`, `frontend/messages/fr.json` (i18n)

## Open questions
None — design approved. Pending user review of this written spec.
