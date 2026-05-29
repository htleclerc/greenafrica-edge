# Shipowner Portal Unification — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/owner/login` password auth alongside the existing magic-link, let owners set/reset a password by email (reusing the staff reset page), and add an owner sign-in link to the staff `/login`.

**Architecture:** Refactor `OwnerLoginForm` into a dual-method form (`signInWithPassword` + the existing `signInWithOtp` + a `resetPasswordForEmail` trigger). Reuse the staff `ResetPasswordPage` for the owner reset page by adding a `redirectTo` prop (DRY — no duplicate form/i18n). Add `/owner/reset-password` to the middleware's public owner paths. Add one link on `/login`.

**Tech Stack:** Next.js (client components, App Router), Supabase Auth (`signInWithPassword`/`signInWithOtp`/`resetPasswordForEmail`/`updateUser`), next-intl, Vitest + Testing Library.

---

## Established facts (do not re-investigate)
- `OwnerLoginForm` (`frontend/src/app/owner/login/OwnerLoginForm.tsx`): magic-link only; `useTranslations('OwnerPortal.login')`; `OsInput`/`OsButton`; generic "linkSent" success.
- `OwnerPortal.login` i18n EXISTS with: `title, subtitle, footerNote, emailLabel, submit, sending, linkSent, errors.{noOwnerRecord,invited,ghost,callbackFailed,generic}` (both `en.json` and `fr.json`).
- Staff `ResetPasswordPage` (`frontend/src/components/auth/ResetPasswordPage.tsx`): `useTranslations('Auth')`, `MIN_PASSWORD_LENGTH=8`, strength rules, on submit calls `supabase.auth.updateUser({ password })`, success state shows a button that does `window.location.href = '/login'`. Generic `Auth.reset_*` keys exist (`reset_title, reset_subtitle, reset_label_new, reset_label_confirm, reset_btn_submit, reset_btn_go_login, reset_error_mismatch, reset_error_weak, reset_success_title, reset_success_desc, reset_rule_*`).
- Middleware (`frontend/src/middleware.ts:13`): `const OWNER_PUBLIC_PATHS = ['/owner/login', '/owner/register', '/owner/auth/callback'];`.
- `LoginPage` (`frontend/src/components/auth/LoginPage.tsx`): `useTranslations('Auth')`; has links like `<a href="/forgot-password">{t('forgot_password')}</a>` (~L186) and `<a href="/signup">{t('request_access')}</a>` (~L229).
- Supabase redirect allowlist includes `http://localhost:3300/owner/auth/callback`; `/owner/reset-password` must be **added to the allowlist in the dashboard** (ops step — note in PR, not code).
- Tests: api routes run under the vitest `node` project; component tests under `jsdom`. Use a per-test `vi.mock('next-intl', ...)` returning the key (existing pattern). `createClient` from `@/lib/supabase/client` is the browser client.

---

### Task 1: i18n — new keys for dual-method login + owner link (EN + FR)

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

- [ ] **Step 1: Add keys inside the existing `OwnerPortal.login` object in `en.json`**

Add these keys (siblings of the existing `submit`/`sending`; keep `errors` merged — add `invalidCredentials` into the existing `errors` object):

```json
"passwordLabel": "Password",
"passwordSubmit": "Sign in",
"signingIn": "Signing in…",
"useMagicLink": "Email me a sign-in link instead",
"setPassword": "Set or reset my password",
"resetSent": "If that email is registered, a password-reset link is on its way. Check your inbox.",
"noPasswordHint": "No password yet? Use the email link, or set one below.",
```
and inside `OwnerPortal.login.errors` add:
```json
"invalidCredentials": "Invalid email or password.",
```

- [ ] **Step 2: Add the same keys (French) in `fr.json` under `OwnerPortal.login`**

```json
"passwordLabel": "Mot de passe",
"passwordSubmit": "Se connecter",
"signingIn": "Connexion…",
"useMagicLink": "Recevoir plutôt un lien par email",
"setPassword": "Définir ou réinitialiser mon mot de passe",
"resetSent": "Si cet email est enregistré, un lien de réinitialisation est en route. Vérifiez votre boîte mail.",
"noPasswordHint": "Pas encore de mot de passe ? Utilisez le lien par email, ou définissez-en un ci-dessous.",
```
and inside `OwnerPortal.login.errors`:
```json
"invalidCredentials": "Email ou mot de passe invalide.",
```

- [ ] **Step 3: Add the owner-portal link key in the `Auth` object (both files)**

`en.json` `Auth`:
```json
"owner_portal_link": "Shipowner? Sign in to the owner portal",
```
`fr.json` `Auth`:
```json
"owner_portal_link": "Armateur ? Connectez-vous à l'espace armateur",
```

- [ ] **Step 4: Validate**

Run:
```
cd frontend && node -e "const en=require('./messages/en.json'),fr=require('./messages/fr.json'); for(const m of [en,fr]){const l=m.OwnerPortal.login; if(!l.passwordLabel||!l.passwordSubmit||!l.useMagicLink||!l.setPassword||!l.resetSent||!l.noPasswordHint||!l.errors.invalidCredentials) throw new Error('missing login key'); if(!m.Auth.owner_portal_link) throw new Error('missing owner_portal_link');} console.log('keys ok')"
```
Expected: `keys ok`.

- [ ] **Step 5: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git commit -m "i18n(portal): keys for dual-method owner login + owner-portal link"
```

---

### Task 2: Owner reset-password page (reuse staff ResetPasswordPage via redirectTo)

**Files:**
- Modify: `frontend/src/components/auth/ResetPasswordPage.tsx` (add optional `redirectTo` prop)
- Create: `frontend/src/app/owner/reset-password/page.tsx`
- Modify: `frontend/src/middleware.ts` (add `/owner/reset-password` to `OWNER_PUBLIC_PATHS`)
- Test: `frontend/src/components/auth/__tests__/ResetPasswordPage.redirect.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/auth/__tests__/ResetPasswordPage.redirect.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const updateUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { updateUser } }) }));

import { ResetPasswordPage } from '../ResetPasswordPage';

beforeEach(() => { vi.clearAllMocks(); });

it('calls updateUser and shows success, then routes to the redirectTo target', async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordPage redirectTo="/owner/dashboard" />);
    const [pwd, confirm] = screen.getAllByPlaceholderText('••••••••••••');
    fireEvent.change(pwd, { target: { value: 'Abcdef1!' } });
    fireEvent.change(confirm, { target: { value: 'Abcdef1!' } });
    fireEvent.click(screen.getByText('reset_btn_submit'));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'Abcdef1!' }));
    // success state renders the go-to-app button
    expect(await screen.findByText('reset_btn_go_login')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/auth/__tests__/ResetPasswordPage.redirect.test.tsx`
Expected: FAIL — `ResetPasswordPage` doesn't accept a `redirectTo` prop (TS error) / or the success button still hardcodes `/login`. (It will at least fail typecheck once the test passes a prop the component doesn't declare; the runtime assertions guide the change.)

- [ ] **Step 3: Add the `redirectTo` prop to `ResetPasswordPage`**

Change the signature and the success-button target. Replace:
```tsx
export function ResetPasswordPage() {
```
with:
```tsx
export function ResetPasswordPage({ redirectTo = '/login' }: { redirectTo?: string }) {
```
and replace the success button's handler:
```tsx
                                    onClick={() => { window.location.href = '/login'; }}
```
with:
```tsx
                                    onClick={() => { window.location.href = redirectTo; }}
```
(Leave everything else unchanged. The staff `/reset-password` route renders `<ResetPasswordPage />` with no prop → still defaults to `/login`.)

- [ ] **Step 4: Create the owner reset route**

```tsx
// frontend/src/app/owner/reset-password/page.tsx
import { ResetPasswordPage } from '@/components/auth/ResetPasswordPage';

export const metadata = { title: 'Reset password — Owner portal' };

export default function OwnerResetPassword() {
    return <ResetPasswordPage redirectTo="/owner/dashboard" />;
}
```

- [ ] **Step 5: Add `/owner/reset-password` to the middleware public owner paths**

In `frontend/src/middleware.ts`, change:
```tsx
const OWNER_PUBLIC_PATHS = ['/owner/login', '/owner/register', '/owner/auth/callback'];
```
to:
```tsx
const OWNER_PUBLIC_PATHS = ['/owner/login', '/owner/register', '/owner/auth/callback', '/owner/reset-password'];
```

- [ ] **Step 6: Run test + typecheck**

Run: `cd frontend && npx vitest run src/components/auth/__tests__/ResetPasswordPage.redirect.test.tsx` → PASS.
Run: `cd frontend && npx tsc --noEmit` → EXIT 0.
Run the existing staff reset test if any (`cd frontend && npx vitest run src/components/auth/`) → no regression.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/auth/ResetPasswordPage.tsx frontend/src/app/owner/reset-password/ frontend/src/middleware.ts frontend/src/components/auth/__tests__/ResetPasswordPage.redirect.test.tsx
git commit -m "feat(portal): owner reset-password route (reuse ResetPasswordPage redirectTo) + public path"
```

---

### Task 3: `OwnerLoginForm` — dual-method (password + magic-link + reset)

**Files:**
- Modify: `frontend/src/app/owner/login/OwnerLoginForm.tsx`
- Test: `frontend/src/app/owner/login/__tests__/OwnerLoginForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/owner/login/__tests__/OwnerLoginForm.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const push = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useSearchParams: () => new URLSearchParams(''),
}));
const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();
const resetPasswordForEmail = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({ auth: { signInWithPassword, signInWithOtp, resetPasswordForEmail } }),
}));

import { OwnerLoginForm } from '../OwnerLoginForm';

beforeEach(() => { vi.clearAllMocks(); });

function fill(email: string, password?: string) {
    fireEvent.change(screen.getByLabelText('emailLabel'), { target: { value: email } });
    if (password !== undefined) {
        fireEvent.change(screen.getByLabelText('passwordLabel'), { target: { value: password } });
    }
}

it('signs in with password and redirects to /owner/dashboard', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<OwnerLoginForm />);
    fill('owner@example.com', 'secret123');
    fireEvent.click(screen.getByText('passwordSubmit'));
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret123' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/owner/dashboard'));
});

it('shows a generic error on bad credentials and does not redirect', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<OwnerLoginForm />);
    fill('owner@example.com', 'wrong');
    fireEvent.click(screen.getByText('passwordSubmit'));
    await waitFor(() => expect(screen.getByText('errors.invalidCredentials')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
});

it('requests a magic link via signInWithOtp', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(<OwnerLoginForm />);
    fill('owner@example.com');
    fireEvent.click(screen.getByText('useMagicLink'));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    expect(signInWithOtp.mock.calls[0][0].email).toBe('owner@example.com');
});

it('triggers a password reset email and shows a generic confirmation', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<OwnerLoginForm />);
    fill('owner@example.com');
    fireEvent.click(screen.getByText('setPassword'));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
    expect(resetPasswordForEmail.mock.calls[0][0]).toBe('owner@example.com');
    expect(await screen.findByText('resetSent')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/owner/login/__tests__/OwnerLoginForm.test.tsx`
Expected: FAIL — current form has no password field / `passwordSubmit` / `useMagicLink` / `setPassword` controls.

- [ ] **Step 3: Replace `OwnerLoginForm.tsx` with the dual-method form**

```tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';

// Only allow same-portal redirect targets to avoid open-redirect.
function safeOwnerRedirect(raw: string | null): string {
    return raw && raw.startsWith('/owner/') ? raw : '/owner/dashboard';
}

export function OwnerLoginForm() {
    const t = useTranslations('OwnerPortal.login');
    const router = useRouter();
    const params = useSearchParams();
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [pending, setPending] = React.useState<null | 'password' | 'link' | 'reset'>(null);
    const [sentTo, setSentTo] = React.useState<string | null>(null);
    const [resetSent, setResetSent] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const cleanEmail = () => email.trim().toLowerCase();

    async function signInPassword(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setPending('password');
        try {
            const supabase = createClient();
            const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail(), password });
            if (err) {
                setError(t('errors.invalidCredentials'));
                return;
            }
            router.push(safeOwnerRedirect(params.get('redirectTo')));
        } catch {
            setError(t('errors.generic'));
        } finally {
            setPending(null);
        }
    }

    async function sendMagicLink() {
        setError(null);
        setPending('link');
        try {
            const supabase = createClient();
            const appUrl = window.location.origin;
            const { error: err } = await supabase.auth.signInWithOtp({
                email: cleanEmail(),
                options: { emailRedirectTo: `${appUrl}/owner/auth/callback`, shouldCreateUser: false },
            });
            // Generic success (anti-enumeration): treat "Signups not allowed" as sent.
            if (err && !/Signups not allowed/i.test(err.message)) {
                setError(err.message);
                return;
            }
            setSentTo(email);
        } catch {
            setError(t('errors.generic'));
        } finally {
            setPending(null);
        }
    }

    async function sendReset() {
        setError(null);
        setPending('reset');
        try {
            const supabase = createClient();
            const appUrl = window.location.origin;
            await supabase.auth.resetPasswordForEmail(cleanEmail(), {
                redirectTo: `${appUrl}/owner/reset-password`,
            });
            setResetSent(true); // always generic — never reveal existence
        } catch {
            setResetSent(true);
        } finally {
            setPending(null);
        }
    }

    if (sentTo) {
        return (
            <div className="px-3 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)', color: '#86EFAC' }}>
                {t.rich('linkSent', { email: sentTo, strong: (chunks) => <strong>{chunks}</strong> })}
            </div>
        );
    }

    if (resetSent) {
        return (
            <div className="px-3 py-3 rounded-lg text-sm" style={{ backgroundColor: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.35)', color: '#86EFAC' }}>
                {t('resetSent')}
            </div>
        );
    }

    return (
        <form onSubmit={signInPassword} className="flex flex-col gap-4">
            <OsInput
                label={t('emailLabel')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@example.com"
                required
                autoFocus
            />
            <OsInput
                label={t('passwordLabel')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                error={error ?? undefined}
            />
            <p className="text-[11px] text-[var(--os-text-muted)]">{t('noPasswordHint')}</p>

            <OsButton type="submit" variant="primary" loading={pending === 'password'} disabled={pending !== null || !email || !password}>
                {pending === 'password' ? t('signingIn') : t('passwordSubmit')}
            </OsButton>

            <div className="flex flex-col gap-2 pt-1 border-t border-[var(--os-border)]">
                <button type="button" onClick={sendMagicLink} disabled={pending !== null || !email} className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50 text-left">
                    {pending === 'link' ? t('sending') : t('useMagicLink')}
                </button>
                <button type="button" onClick={sendReset} disabled={pending !== null || !email} className="text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] disabled:opacity-50 text-left">
                    {t('setPassword')}
                </button>
            </div>
        </form>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/app/owner/login/__tests__/OwnerLoginForm.test.tsx` → PASS (4 tests).
Run: `cd frontend && npx tsc --noEmit` → EXIT 0.

NOTE: the test uses `getByLabelText('passwordLabel')` / `getByLabelText('emailLabel')` — this relies on `OsInput` associating its `label` with the input (htmlFor/id or wrapping `<label>`). If `OsInput` does NOT create an accessible label association, the implementer should either (a) confirm it does and proceed, or (b) switch the test queries to `getByPlaceholderText('owner@example.com')` and `getByPlaceholderText('••••••••')`. Pick whichever matches the real `OsInput` and keep the assertions intact. Report which.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/owner/login/OwnerLoginForm.tsx frontend/src/app/owner/login/__tests__/OwnerLoginForm.test.tsx
git commit -m "feat(portal): dual-method /owner/login (password + magic-link + reset)"
```

---

### Task 4: Owner sign-in link on staff `/login`

**Files:**
- Modify: `frontend/src/components/auth/LoginPage.tsx`

- [ ] **Step 1: Add the owner-portal link**

In `LoginPage.tsx`, locate the existing "request access" link block (around L229, the `<a href="/signup">{t('request_access')}</a>` area). Immediately after that block's container, add a line linking to the owner portal:

```tsx
                        <p className="text-xs text-[var(--os-text-muted)] mt-2">
                            <a href="/owner/login" className="text-emerald-400 hover:underline font-semibold">
                                {t('owner_portal_link')}
                            </a>
                        </p>
```
Match the surrounding markup/styling — if the request-access line is inside a centered footer `<div>`, place this `<p>` inside the same container so it aligns. Read the actual JSX and place it sensibly; do not alter staff auth logic.

- [ ] **Step 2: Typecheck + build-sanity**

Run: `cd frontend && npx tsc --noEmit` → EXIT 0.
Run: `cd frontend && npx vitest run` → no regressions (full suite).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/auth/LoginPage.tsx
git commit -m "feat(portal): owner sign-in link on staff /login"
```

---

## Final verification (after all tasks)
- [ ] `cd frontend && npx tsc --noEmit` → EXIT 0
- [ ] `cd frontend && npx vitest run` → all pass, no regressions
- [ ] `cd frontend && npx next build` → green
- [ ] **Ops:** add `http://localhost:3300/owner/reset-password` (and the production equivalent) to the Supabase Auth redirect allowlist (dashboard → Authentication → URL Configuration) so the reset email lands on the owner page.
- [ ] **Manual:** at `/owner/login` — (a) password sign-in for an ACTIVE owner → lands on `/owner`; (b) "email me a link" still works; (c) "set/reset password" sends an email → the link opens `/owner/reset-password` → set password → redirected to `/owner`. From `/login`, the "Shipowner? Sign in" link goes to `/owner/login`.

## Notes for the implementer
- **No enumeration:** password errors are generic (`errors.invalidCredentials`); magic-link and reset always show generic "sent" confirmations regardless of whether the email exists.
- **Password only works for ACTIVE owners** — an INVITED owner who signs in with a password is bounced by `requireOwner` (existing behavior); magic-link remains the canonical first-entry that redeems the invite. This is intentional; do not try to "fix" it here.
- **Open-redirect guard:** `safeOwnerRedirect` only honors `redirectTo` values starting with `/owner/`.
- The staff `/reset-password` route is unchanged (defaults `redirectTo='/login'`).
- **Deferred:** Phase 3 nav superset (Map/Simulator/TCO/Disputes/My Fleet into `/owner`).
```
