# Security Remediation P3 + Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Defense-in-depth (P3) + the systemic secret-leak prevention, for AfricGreen, from the 2026-09-19 review. Four safe, verifiable tasks.

**Architecture:** Continues on branch `feat/security-remediation-2026-09` (do NOT create a new branch). Nothing pushed. Commits: `git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`, explicit staging, humanized messages, no AI attribution.

**Tech Stack:** Next.js 16.3.5, TypeScript, ESLint flat config, Vitest, Node `crypto`, GitHub Actions.

**Spec:** the verified findings of the 2026-09-19 review (source of truth).

**Explicitly OUT OF SCOPE (deferred, do NOT attempt here):** the CSP-nonce rollout (removing `'unsafe-inline'`/`'unsafe-eval'` from `next.config.ts`). The codebase authors deliberately deferred it (see the comment at `frontend/next.config.ts`): it needs middleware nonce wiring **plus a full running-app browser QA pass**, and removing `'unsafe-inline'` from `style-src` breaks recharts/Tailwind inline styles (nonces do not cover element-level `style=`). It cannot be verified without a browser and must not be done blind. It stays a tracked follow-up for a session with the app running.

## Global Constraints

- Continue on `feat/security-remediation-2026-09`. No migrations in this batch.
- TypeScript bans `any` (`no-explicit-any`).
- Tests: `npm --prefix frontend test -- <file>`. Lint may OOM full-project; fall back to scoped `cd frontend && npx eslint <files>`.
- Do NOT weaken any existing behavior; these are additive hardening changes.

---

### Task 1: Harden the service-role ESLint guard (close the bypasses)

**Why:** `frontend/eslint.config.mjs` bans raw `SUPABASE_SERVICE_ROLE_KEY` access, but its single AST selector only catches `process.env.SUPABASE_SERVICE_ROLE_KEY` (dotted member). A probe shows the computed form `process.env['SUPABASE_SERVICE_ROLE_KEY']` and the destructured form `const { SUPABASE_SERVICE_ROLE_KEY } = process.env` both slip through, and the rule's `files` doesn't cover `scripts/`. The tenant-isolation model depends on this rule being the enforcement floor.

**Files:**
- Modify: `frontend/eslint.config.mjs`

- [ ] **Step 1: Write a probe to see current gaps (RED)**

Create a temp file `frontend/src/__eslint_probe.ts` with all four spellings:

```ts
const a = process.env.SUPABASE_SERVICE_ROLE_KEY;
const b = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const { SUPABASE_SERVICE_ROLE_KEY } = process.env;
const env = process.env;
const c = env.SUPABASE_SERVICE_ROLE_KEY;
export { a, b, SUPABASE_SERVICE_ROLE_KEY, c };
```

Run: `cd frontend && npx eslint src/__eslint_probe.ts`
Expected NOW: only line 1 flagged (the current single selector). Record which lines are missed.

- [ ] **Step 2: Add selectors for the computed and destructured forms**

In `frontend/eslint.config.mjs`, replace the single-object `no-restricted-syntax` value with an array of three selectors (keep the existing dotted one, add computed + destructured):

```js
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "Do not read SUPABASE_SERVICE_ROLE_KEY directly. Use createTenantClient(jurisdictionId) or createPlatformClient() from @/lib/supabase/tenant — the sanctioned service-role factories (GreenGate v8 tenant isolation).",
        },
        {
          selector:
            "MemberExpression[computed=true][object.object.name='process'][object.property.name='env'] > Literal[value='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "Do not read SUPABASE_SERVICE_ROLE_KEY via computed access. Use createTenantClient / createPlatformClient from @/lib/supabase/tenant.",
        },
        {
          selector:
            "VariableDeclarator[init.object.name='process'][init.property.name='env'] > ObjectPattern > Property[key.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "Do not destructure SUPABASE_SERVICE_ROLE_KEY off process.env. Use createTenantClient / createPlatformClient from @/lib/supabase/tenant.",
        },
      ],
```

- [ ] **Step 3: Extend the rule to `scripts/`**

The current config object has `files: ["src/**/*.{ts,tsx}"]`. `scripts/` lives at the repo root (outside `frontend/`), so this ESLint config (rooted in `frontend/`) may not govern it. Determine the fact: check whether `scripts/` is reachable/linted from this config. If it is NOT (nested config can't match `../scripts`), document in the report that `scripts/` is outside this ESLint root and recommend a root-level lint or moving the rule up — do NOT invent an unresolvable `../scripts/**` glob. If a `frontend/scripts/` dir exists, add it to `files`. Do the variant that actually resolves; state which.

- [ ] **Step 4: Re-run the probe (GREEN)**

Run: `cd frontend && npx eslint src/__eslint_probe.ts`
Expected: lines 1, 2, and 3 (dotted, computed, destructured) all flagged. The alias form (lines 4-5, `const env = process.env; env.X`) is a known static-analysis gap — document it in the report as accepted (not statically catchable via no-restricted-syntax without false positives).

- [ ] **Step 5: Delete the probe and confirm the real tree still lints**

Run: `rm frontend/src/__eslint_probe.ts`. Then confirm no legitimate existing file trips the new selectors: `cd frontend && npx eslint src/lib/supabase/tenant.ts` (the sanctioned factory — it's in `ignores`, must stay clean) and a scoped lint of a couple of real service files does not newly error. If a real file trips it, that's a finding to surface, not to suppress.

- [ ] **Step 6: Commit**

Stage only `frontend/eslint.config.mjs`; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "chore(lint): ferme les contournements de la garde service-role (accès crochet + destructuring)"`.

---

### Task 2: Scheme-allowlist the dispute evidence URL (defense-in-depth)

**Why:** `createOwnerDispute` validates `evidenceUrl` with only Zod `.url()`, which accepts `javascript:`/`data:`/`vbscript:`. It's rendered as a raw `href` on the staff dashboard. React 19 currently blocks `javascript:` and browsers block top-level `data:` navigation, so there's no working exploit today — but the input gap is real and framework/browser behavior drifts. Add an `http(s)`-only allowlist at BOTH the input boundary (Zod) and the render site (a shared `safeHttpUrl` helper).

**Files:**
- Create: `frontend/src/lib/safeUrl.ts`
- Create: `frontend/src/lib/safeUrl.test.ts`
- Modify: `frontend/src/actions/createOwnerDispute.ts` (tighten the Zod field)
- Modify: `frontend/src/components/dashboard/disputes/DisputesPage.tsx` (guard the href)

**Interfaces:**
- Produces: `safeHttpUrl(url: string | null | undefined): string | undefined` — returns the url iff its protocol is `http:` or `https:`, else `undefined`.

- [ ] **Step 1: Write the helper test (RED)**

Create `frontend/src/lib/safeUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from './safeUrl';

describe('safeHttpUrl', () => {
    it('allows http and https', () => {
        expect(safeHttpUrl('https://ok.example/x')).toBe('https://ok.example/x');
        expect(safeHttpUrl('http://ok.example')).toBe('http://ok.example');
    });
    it('rejects javascript:, data:, vbscript:, and junk', () => {
        expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
        expect(safeHttpUrl('data:text/html,<script>x</script>')).toBeUndefined();
        expect(safeHttpUrl('vbscript:x')).toBeUndefined();
        expect(safeHttpUrl('not a url')).toBeUndefined();
        expect(safeHttpUrl('')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run it, verify it fails** (module doesn't exist).
Run: `npm --prefix frontend test -- src/lib/safeUrl.test.ts` → FAIL.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/lib/safeUrl.ts`:

```ts
/**
 * Returns `url` only when it is an http(s) URL; otherwise undefined.
 * Use at every render site that puts user-supplied text into an href/src —
 * javascript:, data:, and vbscript: schemes execute or navigate dangerously.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
    } catch {
        return undefined;
    }
}
```

- [ ] **Step 4: Run the test, verify it passes.**
Run: `npm --prefix frontend test -- src/lib/safeUrl.test.ts` → PASS.

- [ ] **Step 5: Tighten the Zod field**

In `frontend/src/actions/createOwnerDispute.ts`, replace the `evidenceUrl` line:

```ts
    evidenceUrl: z.string().url().refine(
        (u) => /^https?:\/\//i.test(u),
        { message: 'evidenceUrl must be an http(s) URL' },
    ).optional().or(z.literal('')),
```

- [ ] **Step 6: Guard the render site**

In `frontend/src/components/dashboard/disputes/DisputesPage.tsx`: import `safeHttpUrl` from `@/lib/safeUrl`, and in the `d.evidenceUrls.map(...)` block, compute `const href = safeHttpUrl(url);` and skip rendering the anchor when `href` is undefined (render the filename as plain text, or omit the row) — never emit `<a href={url}>` with an unvalidated `url`. Keep `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 7: Scoped lint + verify**

Run: `cd frontend && npx eslint src/lib/safeUrl.ts src/actions/createOwnerDispute.ts src/components/dashboard/disputes/DisputesPage.tsx` → clean, no `any`.
Run: `npm --prefix frontend test -- src/lib/safeUrl.test.ts` → PASS.

- [ ] **Step 8: Commit**

Stage the four files; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(disputes): n'autorise que les URL http(s) pour les pièces jointes"`.

---

### Task 3: Constant-time webhook signature comparisons

**Why:** `verifyPaystackSignature`, `verifyFlutterwaveSignature`, and `verifyPayoneerSignature` compare HMAC/secret values with `===`, which short-circuits on the first differing byte — a timing side-channel on the signature/secret. Replace with a length-checked `crypto.timingSafeEqual`.

**Files:**
- Modify: `frontend/src/services/paymentService.ts` (add a helper + use it in the three verifiers)
- Test: `frontend/src/services/paymentService.signatures.test.ts` (create — or add to an existing paymentService test if one exists; check first)

**Interfaces:**
- Produces: an internal `timingSafeStrEqual(a: string, b: string): boolean`.

- [ ] **Step 1: Add the helper** near the signature functions in `frontend/src/services/paymentService.ts`:

```ts
import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison. Length mismatch returns false (leaks only
 *  length, which is not secret for a fixed-format HMAC hex digest). */
function timingSafeStrEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}
```

(The file uses `await import('crypto')` for `createHmac`; a top-level `import { timingSafeEqual } from 'crypto'` is fine in this server-only module. Match the file's lint/style; do not introduce `any`. If a top-level crypto import conflicts with the existing dynamic-import style, obtain `timingSafeEqual` the same dynamic way inside each function instead — either is acceptable, pick the one that lints clean.)

- [ ] **Step 2: Use it in all three verifiers.** Replace:
  - `return hash === signature;` (Paystack) → `return timingSafeStrEqual(hash, signature);`
  - `return signature === process.env.FLUTTERWAVE_WEBHOOK_HASH;` (Flutterwave) → guard the env first and compare safely:
    ```ts
    const expected = process.env.FLUTTERWAVE_WEBHOOK_HASH || '';
    if (!expected || !signature) return false;
    return timingSafeStrEqual(signature, expected);
    ```
  - `return hash === signature;` (Payoneer) → `return timingSafeStrEqual(hash, signature);`

- [ ] **Step 3: Write the test**

First `ls frontend/src/services/paymentService*.test.ts` — if one exists, ADD these cases to it; otherwise create `frontend/src/services/paymentService.signatures.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_secret';
    process.env.FLUTTERWAVE_WEBHOOK_HASH = 'flw-hash-value';
});

describe('webhook signature verification (constant-time)', () => {
    it('Paystack: accepts a correct sha512 HMAC, rejects a wrong one', async () => {
        const { verifyPaystackSignature } = await import('./paymentService');
        const { createHmac } = await import('crypto');
        const body = '{"event":"charge.success"}';
        const good = createHmac('sha512', 'sk_test_secret').update(body).digest('hex');
        expect(await verifyPaystackSignature(body, good)).toBe(true);
        expect(await verifyPaystackSignature(body, 'deadbeef')).toBe(false);
    });

    it('Flutterwave: matches the configured hash, rejects mismatch and empty', async () => {
        const { verifyFlutterwaveSignature } = await import('./paymentService');
        expect(verifyFlutterwaveSignature('flw-hash-value')).toBe(true);
        expect(verifyFlutterwaveSignature('wrong')).toBe(false);
        expect(verifyFlutterwaveSignature('')).toBe(false);
    });
});
```

- [ ] **Step 4: Run the test**
Run: `npm --prefix frontend test -- <the test file>` → PASS (behavior preserved; the change is constant-time, same accept/reject outcomes).

- [ ] **Step 5: Scoped lint + commit**
Run: `cd frontend && npx eslint src/services/paymentService.ts <the test file>` → clean, no `any`.
Stage the two files; commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(payments): comparaison de signature webhook en temps constant"`.

---

### Task 4: Secret-leak prevention — gitleaks (pre-commit + CI) and untrack `.claude/settings.json`

**Why:** The P0 finding (service-role key + passwords committed in `.claude/settings.json`) had no systemic guard. Add secret scanning at two gates (pre-commit and CI) so the class of leak fails fast, and stop tracking `.claude/settings.json` (user-local config that should never be shared). NOTE: this does NOT remove the already-committed secrets from history — rotation stays the owner's P0 action; this prevents recurrence.

**Files:**
- Modify: `.github/workflows/ci.yml` (add a gitleaks job)
- Create: `.githooks/pre-commit` (opt-in local hook)
- Modify: `.gitignore` (add `.claude/settings.json`)
- Untrack: `.claude/settings.json` via `git rm --cached`

- [ ] **Step 1: Add a CI gitleaks job.** Read `.github/workflows/ci.yml` first to match its trigger/style, then add a sibling job (same indentation as existing `jobs:` entries, do not reorder/remove others):

```yaml
  gitleaks:
    name: Secret scan (gitleaks)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Add a repo-local pre-commit hook.** Create `.githooks/pre-commit` (mark executable, `chmod +x`):

```sh
#!/bin/sh
# Secret scan on staged changes. CI enforces this too (gitleaks job).
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --redact --verbose || {
    echo "gitleaks: potential secret in staged changes — commit blocked." >&2
    exit 1
  }
else
  echo "gitleaks not installed; skipping local scan (CI will enforce). Install: https://github.com/gitleaks/gitleaks" >&2
fi
```

Document in the report that contributors opt in with `git config core.hooksPath .githooks` (do NOT change the repo's git config from the task; just provide the hook + the one-line instruction).

- [ ] **Step 3: Untrack the leaked config and ignore it going forward.**

Run: `git rm --cached .claude/settings.json` (keeps the working file, removes from the index).
Add to the root `.gitignore`: a line `.claude/settings.json`.
(Leave `.claude/scheduled_tasks.lock` — already ignored.)

- [ ] **Step 4: Verify.**
- `git status` shows `.claude/settings.json` staged for deletion and now ignored.
- `git check-ignore .claude/settings.json` prints the path.
- `test -f .claude/settings.json` still true (untracking must not delete the working file).
- If gitleaks is installed locally, run `gitleaks detect --no-git --source . --redact -v` and note the result; else note CI will run it.

- [ ] **Step 5: Commit**

Stage `.github/workflows/ci.yml`, `.githooks/pre-commit`, `.gitignore`, and the `.claude/settings.json` removal. Commit `git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "chore(security): scan de secrets gitleaks (pre-commit + CI) et retrait de .claude/settings.json du suivi"`. Report clearly that secret ROTATION remains the owner's pending P0 action (this only prevents recurrence).

---

## Self-Review

**Spec coverage:** P3 — ESLint-guard hardening (Task 1), dispute URL allowlist (Task 2), timing-safe compares (Task 3); Prevention — gitleaks + untrack settings.json (Task 4). CSP-nonce is explicitly out of scope (documented reason at top). Cron/queue Bearer compares stay `!==` (high-entropy operator secrets, no user-controlled guess path — noted non-exploitable in the review; not worth 13 call-site edits this batch).

**Placeholder scan:** none — real code throughout. Task 1 step 3 and Task 3 steps 1/3 tell the implementer to check the actual layout (scripts/ location; crypto import style; existing paymentService test) and do the resolving variant — verification instructions, not placeholders.

**Consistency:** `safeHttpUrl` created and consumed within Task 2. `timingSafeStrEqual` created and consumed within Task 3's single file. No cross-task coupling; any order works.

## Notes for the executor

- Continue on `feat/security-remediation-2026-09`; do NOT push. Commit per task (author Loïc Leclerc, no AI attribution, explicit staging).
- Task 4 touches repo-root files (`.github/`, `.gitignore`, `.claude/`); Tasks 1–3 are under `frontend/`.
- Task 4 does NOT rotate secrets (owner's P0) and does NOT rewrite history.
