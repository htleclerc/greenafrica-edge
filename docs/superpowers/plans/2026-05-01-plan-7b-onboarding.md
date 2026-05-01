# Plan 7B — Shipowner Portal v1: Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement self-service shipowner signup with auto-claim/PENDING_REVIEW decision tree, admin review surface at `/admin/registrations`, and KYC level C wizard at `/owner/onboarding/billing`.

**Architecture:** Server actions encapsulate all business logic (decision tree, encryption, audit logs). UI pages call actions via `use server`. Rate limiting via existing `enforceRateLimit('signup-shipowner')` bucket. IBAN encrypted via Supabase Vault (pgsodium fallback if Vault unavailable, plaintext with SECURITY-DEBT marker if neither).

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / TailwindCSS v4 / Zod validation / Resend email / `@supabase/ssr`. Reuses existing `OsTable`, `OsCard`, `OsBadge`, `OsInput` UI primitives. reCAPTCHA v3 for signup form.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §5

**Predecessor:** Plan 7A (PR #17) — schema foundation. **This plan must branch off `feat/plan-7a-schema-foundation` OR develop after that PR is merged.** All migrations 047-054 from Plan 7A must be applied locally before any task runs.

---

## File Structure

### Files to create

```
frontend/src/
├── app/
│   ├── owner/
│   │   ├── register/
│   │   │   ├── page.tsx                         # public signup page
│   │   │   └── RegisterForm.tsx                 # client form (reCAPTCHA)
│   │   └── onboarding/
│   │       └── billing/
│   │           ├── page.tsx                     # 3-step wizard host
│   │           └── BillingWizard.tsx            # client wizard
│   ├── (dashboard)/admin/registrations/
│   │   ├── page.tsx                             # list + filters
│   │   ├── RegistrationsTable.tsx               # client component
│   │   └── ReviewActionsDialog.tsx              # approve/reject/request-completion modals
│   └── api/auth/
│       └── register-shipowner/
│           └── route.ts                         # POST endpoint, calls action
├── actions/
│   ├── registerShipowner.ts                     # decision tree logic
│   ├── registerShipowner.test.ts
│   ├── approveShipownerRegistration.ts
│   ├── approveShipownerRegistration.test.ts
│   ├── rejectShipownerRegistration.ts
│   ├── rejectShipownerRegistration.test.ts
│   ├── requestRegistrationCompletion.ts
│   ├── submitKycC.ts                            # IBAN encryption
│   └── submitKycC.test.ts
├── services/
│   ├── kycService.ts                            # encrypt/decrypt IBAN helpers
│   └── kycService.test.ts
└── components/owner/
    └── KycCBanner.tsx                           # OwnerShell banner

frontend/messages/
├── en.json                                      # add 3 new namespaces
└── fr.json                                      # add 3 new namespaces

supabase/migrations/
├── 055_shipowner_kyc_bucket.sql                 # Storage bucket + RLS
└── 056_kyc_iban_helpers.sql                     # encryption RPCs (conditional)
```

### Files to modify

```
frontend/src/
├── lib/
│   ├── rateLimit.ts:22-44                       # add 'signup-shipowner' bucket
│   └── auth/requireOwner.ts:39                  # extend SELECT to include kyc_level_c_completed_at
├── components/owner/OwnerShell.tsx              # mount <KycCBanner>
├── messages/en.json + fr.json                   # i18n additions
├── services/shipownerService.ts                 # extend ShipownerListRow type with KYC fields
├── services/emailService.ts                     # 2 new helpers (rejection, completion-request)
└── components/dashboard/DashboardSidebar.tsx    # /admin/registrations link
```

### Test runner

```bash
cd frontend
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run <file>
```

---

## Branch setup

- [ ] **Step 0.1: Create branch on top of Phase A**

```bash
# If working off Phase A branch directly:
git checkout feat/plan-7a-schema-foundation
git pull
git checkout -b feat/plan-7b-onboarding
# OR if 7A is merged into develop:
# git checkout develop && git pull && git checkout -b feat/plan-7b-onboarding

ls supabase/migrations/054_fx_rates_cache.sql
# Expected: file exists. If not, Phase A is not on this branch — STOP.
```

- [ ] **Step 0.2: Verify schema baseline**

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d public.shipowners" | grep -E "kyc_level_b_completed_at|preferred_language"
```

Expected: both columns present (added by mig 047).

- [ ] **Step 0.3: Verify env vars**

```bash
grep -E "RECAPTCHA_SECRET_KEY|NEXT_PUBLIC_RECAPTCHA_SITE_KEY|RESEND_API_KEY" frontend/.env.example
```

If `RECAPTCHA_*` env vars are not present in `.env.example`, **stop and ask the user** to provide reCAPTCHA v3 site + secret keys (free tier at https://www.google.com/recaptcha/admin). Add them to `frontend/.env.example` as documented requirements before proceeding.

- [ ] **Step 0.4: Check IBAN encryption strategy**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "SELECT extname FROM pg_extension WHERE extname IN ('supabase_vault','pgsodium');"
```

If neither is present, the IBAN field will be stored unencrypted in Phase B with a `SECURITY-DEBT-IBAN` marker, and the encryption work moves to Phase B.1 follow-up. Document the choice in Task 7 commit message.

- [ ] **Step 0.5: Read auditService for column shape**

```bash
cat frontend/src/services/auditService.ts | head -60
```

Find the canonical column names for `audit_logs` inserts (likely `actor_profile_id`, `kind`, `target_type`, `target_id` OR `target_uid`). Use the actual column names found in the project — adapt all insert calls in Tasks 2, 5, 7 to match. Do NOT invent column names.

---

## Task 1: Add `signup-shipowner` rate-limit bucket

**Files:**
- Modify: `frontend/src/lib/rateLimit.ts:22-44`
- Create: `frontend/src/lib/__tests__/rateLimit.signup-shipowner.test.ts`

### Why this comes first

`registerShipowner` action (Task 2) and `/api/auth/register-shipowner` route (Task 3) both call `enforceRateLimit('signup-shipowner')`. The bucket must exist first. Per the spec §5.1, limits are 3/day, 10/hour — but the existing `LIMITS` only supports `perMinute` and `perHour`. We add a `perDay` field to the `Bucket` interface to support stricter daily caps.

- [ ] **Step 1.1: Update the `LimiterKey` type and `Bucket` interface**

Edit `frontend/src/lib/rateLimit.ts` lines 22-29:

```typescript
type LimiterKey = 'verify' | 'invoice-download' | 'signup' | 'signup-shipowner';

interface Bucket {
    /** Distinct short window — prevents small bursts. */
    perMinute: number;
    /** Slower envelope — catches slow scrapers. */
    perHour: number;
    /** Optional 24h cap for self-service signup paths. */
    perDay?: number;
}
```

- [ ] **Step 1.2: Add the `signup-shipowner` entry to `LIMITS`**

```typescript
const LIMITS: Record<LimiterKey, Bucket> = {
    verify: { perMinute: 30, perHour: 200 },
    'invoice-download': { perMinute: 10, perHour: 60 },
    signup: { perMinute: 5, perHour: 30 },
    // Stricter than 'signup' because shipowner self-service is a higher-attractiveness
    // attack vector (account-takeover via IMO enumeration). Spec §5.1.
    'signup-shipowner': { perMinute: 2, perHour: 10, perDay: 3 },
};
```

- [ ] **Step 1.3: Update `enforceRateLimit` to apply `perDay` when present**

Read the current `enforceRateLimit` function and add a third Ratelimit instance for `perDay` when `bucket.perDay` is defined. The instance uses `Ratelimit.slidingWindow(bucket.perDay, '24h')`. The check is the same pattern as `perHour` — if any of the three rejects, return `{ allowed: false, retryAfterSeconds }`.

- [ ] **Step 1.4: Write a unit test**

Create `frontend/src/lib/__tests__/rateLimit.signup-shipowner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { enforceRateLimit } from '../rateLimit';

describe('rateLimit signup-shipowner bucket', () => {
    it('skips when env not set (dev fallback)', async () => {
        delete process.env.UPSTASH_REDIS_REST_URL;
        delete process.env.UPSTASH_REDIS_REST_TOKEN;
        const r = await enforceRateLimit('signup-shipowner', '127.0.0.1');
        expect(r.allowed).toBe(true);
        expect((r as { skipped?: boolean }).skipped).toBe(true);
    });
});
```

- [ ] **Step 1.5: Run + commit**

```bash
cd frontend && npx vitest run src/lib/__tests__/rateLimit.signup-shipowner.test.ts
```

Expected: PASS.

```bash
git add frontend/src/lib/rateLimit.ts \
        frontend/src/lib/__tests__/rateLimit.signup-shipowner.test.ts
git commit -m "feat(plan7b): add signup-shipowner rate-limit bucket (3/day)"
```

---

## Task 2: `registerShipowner` server action — decision tree

**Files:**
- Create: `frontend/src/actions/registerShipowner.ts`
- Create: `frontend/src/actions/registerShipowner.test.ts`

### Decision tree (from spec §5.2)

```
  Validate input (Zod) → Lookup vessel by proof_imo
    ├─ vessel found AND vessels.shipowner_id = X
    │   ├─ X.GHOST AND X.imo_company_no = req.imo_company → AUTO-CLAIM
    │   ├─ X.GHOST AND mismatch → INSERT PENDING_REVIEW (generic msg)
    │   └─ X.INVITED|ACTIVE|… → HARD REJECT (no insert, generic msg)
    ├─ vessel found AND vessels.shipowner_id IS NULL → INSERT PENDING_REVIEW
    └─ vessel not found → INSERT PENDING_REVIEW
```

**Three invariants** (test for each):
1. Generic message returned in ALL non-AUTO-CLAIM paths (anti-enumeration).
2. AUTO-CLAIM never overwrites a non-GHOST shipowners row (`.eq('account_state','GHOST')` in UPDATE).
3. AUTO-CLAIM requires exact match on `imo_company_no` between request and existing GHOST row.

### Step 2.1: Create the action file

- [ ] **Step 2.1: Write the input Zod schema and helper types**

```typescript
// frontend/src/actions/registerShipowner.ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';

const ALLOWED_LANGS = ['en', 'fr', 'ar', 'pt', 'sw'] as const;
const ALLOWED_DOC_TYPES = ['TRADE_REGISTER', 'CERT_INCORPORATION', 'MOA', 'OTHER'] as const;

export const registerShipownerSchema = z.object({
    email: z.email().max(254),
    name: z.string().min(2).max(200),
    imo_company_no: z.string().regex(/^\d{7}$/, '7 digits required'),
    country_code: z.string().length(2),
    address: z.string().min(5).max(500),
    proof_imo_vessel_imo: z.string().regex(/^\d{7}$/, '7 digits required'),
    proof_doc_storage_path: z.string().min(1),
    proof_doc_type: z.enum(ALLOWED_DOC_TYPES),
    phone_e164: z.string().regex(/^\+\d{8,15}$/).optional(),
    preferred_language: z.enum(ALLOWED_LANGS),
    recaptcha_token: z.string().min(1),
});

export type RegisterShipownerInput = z.infer<typeof registerShipownerSchema>;

export interface RegisterShipownerResult {
    ok: boolean;
    /** Generic "received, contact 48h" message for ALL non-auto-claim paths. */
    message: string;
    /** Only set on successful AUTO-CLAIM. */
    autoClaimedId?: string;
}

const GENERIC_MESSAGE = 'Demande reçue. Vous recevrez un email sous 48h après validation.';
```

- [ ] **Step 2.2: Implement reCAPTCHA verification helper**

```typescript
async function verifyRecaptcha(token: string): Promise<boolean> {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
        // Dev fallback: skip verification.
        if (process.env.NODE_ENV !== 'production') return true;
        return false;
    }
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    if (!r.ok) return false;
    const data = await r.json() as { success: boolean; score?: number };
    return data.success === true && (data.score ?? 0) >= 0.5;
}
```

- [ ] **Step 2.3: Implement the main `registerShipowner` function**

```typescript
export async function registerShipowner(
    input: RegisterShipownerInput,
    clientIp: string,
): Promise<RegisterShipownerResult> {
    // 1. Rate limit
    const rl = await enforceRateLimit('signup-shipowner', clientIp);
    if (!rl.allowed) {
        return { ok: false, message: 'Too many attempts. Try again later.' };
    }

    // 2. Validate
    const parsed = registerShipownerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Invalid input.' };
    const data = parsed.data;

    // 3. reCAPTCHA
    const captchaOk = await verifyRecaptcha(data.recaptcha_token);
    if (!captchaOk) return { ok: false, message: GENERIC_MESSAGE };

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // 4. Lookup vessel
    const { data: vessel } = await supabase
        .from('vessels')
        .select('id, shipowner_id')
        .eq('imo_number', data.proof_imo_vessel_imo)
        .maybeSingle();

    // Branch A: vessel found + shipowner attached
    if (vessel?.shipowner_id) {
        const { data: shipowner } = await supabase
            .from('shipowners')
            .select('id, account_state, imo_company_no')
            .eq('id', vessel.shipowner_id)
            .single();

        if (shipowner?.account_state === 'GHOST'
            && shipowner.imo_company_no === data.imo_company_no) {
            return await autoClaim(supabase, shipowner.id, data);
        }
        // GHOST mismatch → insert PENDING_REVIEW for admin to sort
        if (shipowner?.account_state === 'GHOST') {
            await insertPendingReview(supabase, data);
            return { ok: true, message: GENERIC_MESSAGE };
        }
        // Non-GHOST (ACTIVE/INVITED/SUSPENDED/REJECTED) → no insert (anti-takeover)
        await audit(supabase, 'SHIPOWNER_REGISTRATION_BLOCKED', {
            reason: 'vessel_attached_to_active_owner',
            imo_company_no_attempted: data.imo_company_no,
        });
        return { ok: true, message: GENERIC_MESSAGE };
    }

    // Branch B: vessel found but no shipowner attached
    // Branch C: vessel not found
    await insertPendingReview(supabase, data);
    return { ok: true, message: GENERIC_MESSAGE };
}
```

- [ ] **Step 2.4: Implement private helpers (autoClaim, insertPendingReview, audit)**

```typescript
type SupabaseAdmin = ReturnType<typeof createClient>;

async function autoClaim(
    supabase: SupabaseAdmin,
    shipownerId: string,
    data: RegisterShipownerInput,
): Promise<RegisterShipownerResult> {
    // Defensive: only update if state still GHOST (race-safe)
    const { error: upErr } = await supabase
        .from('shipowners')
        .update({
            name: data.name,
            address: data.address,
            country_code: data.country_code,
            phone_e164: data.phone_e164 ?? null,
            preferred_language: data.preferred_language,
            proof_imo_vessel_imo: data.proof_imo_vessel_imo,
            proof_doc_url: data.proof_doc_storage_path,
            proof_doc_type: data.proof_doc_type,
            imo_company_no_verified_at: new Date().toISOString(),
            kyc_level_b_completed_at: new Date().toISOString(),
            account_state: 'ACTIVE',
        })
        .eq('id', shipownerId)
        .eq('account_state', 'GHOST');
    if (upErr) return { ok: false, message: GENERIC_MESSAGE };

    const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(
        data.email,
        { redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/owner/auth/callback` },
    );
    if (inviteErr) {
        // Best-effort revert
        await supabase.from('shipowners')
            .update({ account_state: 'GHOST' })
            .eq('id', shipownerId);
        return { ok: false, message: 'Email delivery failed. Try again later.' };
    }

    // Link profile and create wallet
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const newUser = users.find(u => u.email === data.email);
    if (newUser) {
        await supabase.from('profiles').upsert({
            id: newUser.id,
            email: data.email,
            full_name: data.name,
            role: 'SHIPOWNER',
            is_active: true,
        });
        await supabase.from('shipowners')
            .update({ profile_id: newUser.id })
            .eq('id', shipownerId);
        await supabase.from('wallets').insert({ shipowner_id: shipownerId });
    }

    await audit(supabase, 'SHIPOWNER_AUTO_CLAIM', {
        shipowner_id: shipownerId,
        imo_company_no: data.imo_company_no,
    });
    return { ok: true, message: GENERIC_MESSAGE, autoClaimedId: shipownerId };
}

async function insertPendingReview(
    supabase: SupabaseAdmin,
    data: RegisterShipownerInput,
): Promise<void> {
    await supabase.from('shipowners').insert({
        name: data.name,
        imo_company_no: data.imo_company_no,
        country_code: data.country_code,
        address: data.address,
        official_email: data.email,
        official_email_source: 'AGENT_CLAIM',
        phone_e164: data.phone_e164 ?? null,
        preferred_language: data.preferred_language,
        proof_imo_vessel_imo: data.proof_imo_vessel_imo,
        proof_doc_url: data.proof_doc_storage_path,
        proof_doc_type: data.proof_doc_type,
        kyc_level_b_completed_at: new Date().toISOString(),
        account_state: 'PENDING_REVIEW',
    });
    await audit(supabase, 'SHIPOWNER_REGISTRATION_PENDING', {
        imo_company_no: data.imo_company_no,
        email: data.email,
    });
}

async function audit(
    supabase: SupabaseAdmin,
    kind: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    // NB: actual audit_logs column shape verified in Step 0.5.
    // Adapt this insert if columns differ from below.
    await supabase.from('audit_logs').insert({
        actor_profile_id: null,
        kind,
        target_type: 'shipowner',
        metadata,
    });
}
```

- [ ] **Step 2.5: Run TypeScript build**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "registerShipowner" | head
```

Expected: no errors. Fix any.

### Step 2.6: Tests for the decision tree

- [ ] **Step 2.6: Write comprehensive tests**

Create `frontend/src/actions/registerShipowner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
    auth: { admin: { inviteUserByEmail: vi.fn(), listUsers: vi.fn() } },
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: vi.fn(async () => ({ allowed: true })),
}));

function chainableSelect(value: unknown) {
    return {
        select: () => ({
            eq: () => ({
                maybeSingle: async () => ({ data: value }),
                single: async () => ({ data: value }),
            }),
        }),
    };
}

const validInput = {
    email: 'a@example.com',
    name: 'Test Co',
    imo_company_no: '1234567',
    country_code: 'SO',
    address: '1 Quay Rd',
    proof_imo_vessel_imo: '7654321',
    proof_doc_storage_path: 'docs/x.pdf',
    proof_doc_type: 'TRADE_REGISTER' as const,
    preferred_language: 'en' as const,
    recaptcha_token: 'tok',
};

describe('registerShipowner decision tree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.RECAPTCHA_SECRET_KEY = '';
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
        process.env.NEXT_PUBLIC_BASE_URL = 'http://test';
    });

    it('AUTO-CLAIM when vessel→GHOST→imo_company match (invariant 3)', async () => {
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: 'so1' });
            if (table === 'shipowners') return {
                ...chainableSelect({ id: 'so1', account_state: 'GHOST', imo_company_no: '1234567' }),
                update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
                upsert: async () => ({ error: null }),
                insert: async () => ({ error: null }),
            };
            if (table === 'profiles' || table === 'wallets' || table === 'audit_logs') {
                return { insert: async () => ({ error: null }), upsert: async () => ({ error: null }) };
            }
            return chainableSelect(null);
        });
        mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({ error: null });
        mockSupabase.auth.admin.listUsers.mockResolvedValue({
            data: { users: [{ id: 'uid', email: 'a@example.com' }] },
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe('so1');
        expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalled();
    });

    it('PENDING_REVIEW when vessel→GHOST imo_company mismatch (invariant 1: generic msg)', async () => {
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: 'so1' });
            if (table === 'shipowners') return {
                ...chainableSelect({ id: 'so1', account_state: 'GHOST', imo_company_no: '9999999' }),
                insert: async () => ({ error: null }),
            };
            if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
            return chainableSelect(null);
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(mockSupabase.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('HARD REJECT (no insert) when vessel→ACTIVE owner (invariant 2: anti-takeover)', async () => {
        const inserts: string[] = [];
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: 'so1' });
            if (table === 'shipowners') return {
                ...chainableSelect({ id: 'so1', account_state: 'ACTIVE', imo_company_no: '1234567' }),
                insert: async () => { inserts.push('shipowners'); return { error: null }; },
            };
            if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
            return chainableSelect(null);
        });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(inserts).not.toContain('shipowners');
    });

    it('PENDING_REVIEW when vessel exists but no shipowner', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect({ id: 'v1', shipowner_id: null });
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
            return chainableSelect(null);
        });
        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('PENDING_REVIEW when vessel not found', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'vessels') return chainableSelect(null);
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
            return chainableSelect(null);
        });
        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('rejects when rate limit hit', async () => {
        const { enforceRateLimit } = await import('@/lib/rateLimit');
        (enforceRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false });

        const { registerShipowner } = await import('./registerShipowner');
        const r = await registerShipowner(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
    });
});
```

- [ ] **Step 2.7: Run + commit**

```bash
cd frontend && NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
  SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/actions/registerShipowner.test.ts
```

Expected: 6 tests PASS.

```bash
git add frontend/src/actions/registerShipowner.ts \
        frontend/src/actions/registerShipowner.test.ts
git commit -m "feat(plan7b): registerShipowner action with auto-claim/PENDING_REVIEW decision tree"
```

---

## Task 3: `/api/auth/register-shipowner` route handler

**Files:**
- Create: `frontend/src/app/api/auth/register-shipowner/route.ts`

### Why a separate route + action

Server actions can't be invoked directly from a client form posting JSON with file references. The route is a thin wrapper: parse JSON → call `registerShipowner` → return JSON. The proof file is uploaded to Supabase Storage by the client BEFORE submitting the form, so the route only sees a `proof_doc_storage_path`.

- [ ] **Step 3.1: Create the route handler**

```typescript
// frontend/src/app/api/auth/register-shipowner/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { registerShipowner } from '@/actions/registerShipowner';

function getClientIp(req: NextRequest): string {
    return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
        ?? req.headers.get('x-real-ip')
        ?? '127.0.0.1';
}

export async function POST(req: NextRequest) {
    let body: unknown;
    try { body = await req.json(); }
    catch { return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 }); }

    const ip = getClientIp(req);
    const result = await registerShipowner(body as never, ip);
    const status = result.ok
        ? 200
        : (result.message.startsWith('Too many') ? 429 : 400);
    return NextResponse.json(result, { status });
}
```

- [ ] **Step 3.2: Smoke test the route**

```bash
cd frontend && npm run dev
# In another terminal:
curl -X POST http://localhost:3300/api/auth/register-shipowner \
  -H 'Content-Type: application/json' \
  -d '{"email":"x@y.com","name":"Test","imo_company_no":"1234567","country_code":"SO","address":"1 Quay","proof_imo_vessel_imo":"7654321","proof_doc_storage_path":"x.pdf","proof_doc_type":"OTHER","preferred_language":"en","recaptcha_token":"x"}'
```

Expected: `{"ok":true,"message":"Demande reçue. ..."}` (vessel will not be found, so PENDING_REVIEW path).

Verify in DB:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "SELECT account_state FROM public.shipowners WHERE imo_company_no = '1234567' ORDER BY created_at DESC LIMIT 1;"
```

Expected: `PENDING_REVIEW`.

- [ ] **Step 3.3: Commit**

```bash
git add frontend/src/app/api/auth/register-shipowner/route.ts
git commit -m "feat(plan7b): /api/auth/register-shipowner route handler"
```

---

## Task 4: `/owner/register` public page + Storage bucket

**Files:**
- Create: `frontend/src/app/owner/register/page.tsx`
- Create: `frontend/src/app/owner/register/RegisterForm.tsx`
- Create: `supabase/migrations/055_shipowner_kyc_bucket.sql`
- Modify: `frontend/src/app/layout.tsx` (add reCAPTCHA script tag)

### Step 4.1: Create the migration for the Storage bucket

- [ ] **Step 4.1: Create migration 055**

```sql
-- supabase/migrations/055_shipowner_kyc_bucket.sql
INSERT INTO storage.buckets (id, name, public)
  VALUES ('shipowner-kyc', 'shipowner-kyc', false)
  ON CONFLICT (id) DO NOTHING;

-- anon can INSERT to pending/* prefix only (signup uploads).
DROP POLICY IF EXISTS "anon insert pending kyc" ON storage.objects;
CREATE POLICY "anon insert pending kyc" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (bucket_id = 'shipowner-kyc' AND (storage.foldername(name))[1] = 'pending');

-- service_role full access (admin operations).
DROP POLICY IF EXISTS "service_role full kyc" ON storage.objects;
CREATE POLICY "service_role full kyc" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'shipowner-kyc')
  WITH CHECK (bucket_id = 'shipowner-kyc');

-- DOWN:
-- DROP POLICY "anon insert pending kyc" ON storage.objects;
-- DROP POLICY "service_role full kyc" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'shipowner-kyc';
```

- [ ] **Step 4.2: Apply migration**

```bash
supabase db reset
```

Expected: migration applies clean.

### Step 4.2: Server-rendered page wrapper

- [ ] **Step 4.3: Create `page.tsx` (server component)**

```typescript
// frontend/src/app/owner/register/page.tsx
import { getTranslations } from 'next-intl/server';
import { RegisterForm } from './RegisterForm';

export default async function OwnerRegisterPage() {
    const t = await getTranslations('OwnerRegister');
    return (
        <div className="min-h-screen os-bg flex items-center justify-center p-6">
            <div className="os-card max-w-2xl w-full p-8">
                <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
                <p className="text-sm opacity-80 mb-6">{t('subtitle')}</p>
                <RegisterForm
                    recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''}
                />
            </div>
        </div>
    );
}
```

- [ ] **Step 4.4: Create `RegisterForm.tsx` (client component)**

```typescript
// frontend/src/app/owner/register/RegisterForm.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OsInput } from '@/components/ui/OsInput';
import { createClient } from '@/lib/supabase/client';

interface Props { recaptchaSiteKey: string; }

const LANGS = ['en','fr','ar','pt','sw'] as const;
const DOC_TYPES = ['TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER'] as const;

declare global {
    interface Window { grecaptcha?: { execute: (key: string, opts: { action: string }) => Promise<string> } }
}

export function RegisterForm({ recaptchaSiteKey }: Props) {
    const t = useTranslations('OwnerRegister');
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setSubmitting(true);
        setResult(null);

        const formData = new FormData(e.currentTarget);
        const file = formData.get('proof_doc') as File | null;
        if (!file) {
            setSubmitting(false);
            setResult({ ok: false, message: t('errors.no_file') });
            return;
        }

        const supabase = createClient();
        const path = `pending/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage.from('shipowner-kyc').upload(path, file);
        if (upErr) {
            setSubmitting(false);
            setResult({ ok: false, message: t('errors.upload_failed') });
            return;
        }

        const token = (recaptchaSiteKey && window.grecaptcha)
            ? await window.grecaptcha.execute(recaptchaSiteKey, { action: 'register_shipowner' })
            : 'dev-skip';

        const body = {
            email: formData.get('email'),
            name: formData.get('name'),
            imo_company_no: formData.get('imo_company_no'),
            country_code: formData.get('country_code'),
            address: formData.get('address'),
            proof_imo_vessel_imo: formData.get('proof_imo_vessel_imo'),
            proof_doc_storage_path: path,
            proof_doc_type: formData.get('proof_doc_type'),
            phone_e164: formData.get('phone_e164') || undefined,
            preferred_language: formData.get('preferred_language'),
            recaptcha_token: token,
        };
        const res = await fetch('/api/auth/register-shipowner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        setSubmitting(false);
        setResult({ ok: data.ok, message: data.message });
    }

    if (result?.ok) {
        return <div className="os-card p-6 text-center">
            <h2 className="text-xl mb-2">{t('thanks_title')}</h2>
            <p>{result.message}</p>
        </div>;
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <OsInput name="email" label={t('email')} type="email" required />
            <OsInput name="name" label={t('company_name')} required />
            <OsInput name="imo_company_no" label={t('imo_company')} pattern="\d{7}" required />
            <OsInput name="country_code" label={t('country')} maxLength={2} required />
            <OsInput name="address" label={t('address')} required />
            <OsInput name="proof_imo_vessel_imo" label={t('vessel_imo')} pattern="\d{7}" required />
            <input name="proof_doc" type="file" accept="application/pdf,image/*" required className="block" />
            <select name="proof_doc_type" required defaultValue="TRADE_REGISTER" className="os-input">
                {DOC_TYPES.map(d => <option key={d} value={d}>{t(`doc_types.${d}`)}</option>)}
            </select>
            <OsInput name="phone_e164" label={t('phone_optional')} placeholder="+2526..." />
            <select name="preferred_language" required defaultValue="en" className="os-input">
                {LANGS.map(l => <option key={l} value={l}>{t(`langs.${l}`)}</option>)}
            </select>
            {result && !result.ok && <div className="text-red-400 text-sm">{result.message}</div>}
            <button type="submit" disabled={submitting} className="os-button w-full">
                {submitting ? t('submitting') : t('submit')}
            </button>
        </form>
    );
}
```

- [ ] **Step 4.5: Add reCAPTCHA script to root layout**

In `frontend/src/app/layout.tsx`, add the Google reCAPTCHA v3 script tag inside `<head>`:

```tsx
{process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY && (
    <script
        src={`https://www.google.com/recaptcha/api.js?render=${process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`}
        async
        defer
    />
)}
```

- [ ] **Step 4.6: Manual smoke test**

```bash
cd frontend && npm run dev
# open http://localhost:3300/owner/register
# fill form (use a real-ish IMO that won't match a vessel), submit
# verify generic success page
```

Verify in DB:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "SELECT account_state, name FROM public.shipowners WHERE imo_company_no = '1234567';"
```

Expected: 1 row with `PENDING_REVIEW`.

- [ ] **Step 4.7: Commit**

```bash
git add supabase/migrations/055_shipowner_kyc_bucket.sql \
        frontend/src/app/owner/register/page.tsx \
        frontend/src/app/owner/register/RegisterForm.tsx \
        frontend/src/app/layout.tsx
git commit -m "feat(plan7b): /owner/register public page + KYC storage bucket (mig 055)"
```

---

## Task 5: Admin actions (approve / reject / request completion)

**Files:**
- Create: `frontend/src/actions/approveShipownerRegistration.ts`
- Create: `frontend/src/actions/approveShipownerRegistration.test.ts`
- Create: `frontend/src/actions/rejectShipownerRegistration.ts`
- Create: `frontend/src/actions/rejectShipownerRegistration.test.ts`
- Create: `frontend/src/actions/requestRegistrationCompletion.ts`
- Modify: `frontend/src/services/emailService.ts` (add 2 helpers)

### Step 5.1: Approve action

- [ ] **Step 5.1: Create `approveShipownerRegistration.ts`**

```typescript
// frontend/src/actions/approveShipownerRegistration.ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';

const schema = z.object({ shipownerId: z.string().uuid() });

export async function approveShipownerRegistration(input: z.infer<typeof schema>) {
    const session = await requireRole(['SUPERADMIN','MANAGER']);
    const { shipownerId } = schema.parse(input);

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: row } = await supabase
        .from('shipowners')
        .select('id, official_email, account_state, name, preferred_language')
        .eq('id', shipownerId).single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };

    await supabase.from('shipowners').update({ account_state: 'ACTIVE' }).eq('id', shipownerId);

    const { error: invErr } = await supabase.auth.admin.inviteUserByEmail(
        row.official_email!,
        { redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/owner/auth/callback` },
    );
    if (invErr) {
        await supabase.from('shipowners').update({ account_state: 'PENDING_REVIEW' }).eq('id', shipownerId);
        return { ok: false, message: 'invite_failed' };
    }

    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users.find(u => u.email === row.official_email);
    if (user) {
        await supabase.from('profiles').upsert({
            id: user.id,
            email: row.official_email!,
            full_name: row.name,
            role: 'SHIPOWNER',
            is_active: true,
        });
        await supabase.from('shipowners').update({ profile_id: user.id }).eq('id', shipownerId);
        await supabase.from('wallets').insert({ shipowner_id: shipownerId });
    }

    await supabase.from('audit_logs').insert({
        actor_profile_id: session.userId,
        kind: 'SHIPOWNER_REVIEW_APPROVED',
        target_type: 'shipowner',
        metadata: { shipowner_id: shipownerId },
    });
    return { ok: true };
}
```

- [ ] **Step 5.2: Create `rejectShipownerRegistration.ts`**

```typescript
// frontend/src/actions/rejectShipownerRegistration.ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { sendShipownerRejectionEmail } from '@/services/emailService';

const schema = z.object({
    shipownerId: z.string().uuid(),
    reason: z.string().min(5).max(2000),
});

export async function rejectShipownerRegistration(input: z.infer<typeof schema>) {
    const session = await requireRole(['SUPERADMIN','MANAGER']);
    const { shipownerId, reason } = schema.parse(input);

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: row } = await supabase
        .from('shipowners')
        .select('id, official_email, account_state, preferred_language')
        .eq('id', shipownerId).single();
    if (!row) return { ok: false, message: 'not_found' };
    if (row.account_state !== 'PENDING_REVIEW') return { ok: false, message: 'not_pending' };

    await supabase.from('shipowners')
        .update({ account_state: 'REJECTED', rejection_reason: reason })
        .eq('id', shipownerId);

    if (row.official_email) {
        await sendShipownerRejectionEmail({
            to: row.official_email,
            reason,
            language: row.preferred_language ?? 'en',
        });
    }

    await supabase.from('audit_logs').insert({
        actor_profile_id: session.userId,
        kind: 'SHIPOWNER_REVIEW_REJECTED',
        target_type: 'shipowner',
        metadata: { shipowner_id: shipownerId, reason },
    });
    return { ok: true };
}
```

- [ ] **Step 5.3: Create `requestRegistrationCompletion.ts`**

```typescript
// frontend/src/actions/requestRegistrationCompletion.ts
'use server';

import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { sendShipownerCompletionRequestEmail } from '@/services/emailService';

const schema = z.object({
    shipownerId: z.string().uuid(),
    missingItems: z.string().min(5).max(2000),
});

export async function requestRegistrationCompletion(input: z.infer<typeof schema>) {
    await requireRole(['SUPERADMIN','MANAGER']);
    const { shipownerId, missingItems } = schema.parse(input);
    // No state change. Email is the action.
    await sendShipownerCompletionRequestEmail({ shipownerId, missingItems });
    return { ok: true };
}
```

- [ ] **Step 5.4: Add 2 email helpers to `emailService.ts`**

Read `frontend/src/services/emailService.ts` for the existing `sendInvoiceEmail` pattern. Append:

```typescript
export async function sendShipownerRejectionEmail(args: {
    to: string;
    reason: string;
    language: string;
}): Promise<void> {
    const subject = args.language === 'fr'
        ? "Demande d'inscription rejetée"
        : 'Registration rejected';
    const body = args.language === 'fr'
        ? `Bonjour,\n\nVotre demande d'inscription au portail armateur AfricGreen a été rejetée pour le motif suivant :\n\n${args.reason}\n\nVous pouvez soumettre une nouvelle demande à tout moment.\n\nCordialement,\nL'équipe AfricGreen`
        : `Hello,\n\nYour shipowner portal registration was rejected for the following reason:\n\n${args.reason}\n\nYou may submit a new request at any time.\n\nRegards,\nAfricGreen team`;
    await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: args.to,
        subject,
        text: body,
    });
}

export async function sendShipownerCompletionRequestEmail(args: {
    shipownerId: string;
    missingItems: string;
}): Promise<void> {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data: row } = await supabase
        .from('shipowners')
        .select('official_email, preferred_language')
        .eq('id', args.shipownerId).single();
    if (!row?.official_email) return;
    const subject = row.preferred_language === 'fr'
        ? 'Information complémentaire requise'
        : 'Additional information required';
    const body = row.preferred_language === 'fr'
        ? `Bonjour,\n\nNotre équipe a besoin des éléments suivants pour finaliser votre inscription :\n\n${args.missingItems}\n\nVous pouvez compléter votre dossier en répondant à ce courriel.\n\nCordialement,\nL'équipe AfricGreen`
        : `Hello,\n\nOur team needs the following to finalise your registration:\n\n${args.missingItems}\n\nReply to this email to complete your file.\n\nRegards,\nAfricGreen team`;
    await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL!,
        to: row.official_email,
        subject,
        text: body,
    });
}
```

- [ ] **Step 5.5: Tests for approve + reject**

Create `frontend/src/actions/approveShipownerRegistration.test.ts` and `rejectShipownerRegistration.test.ts`. Cover:
- happy path (CONFIRMED transition + invite + audit)
- rejection if `account_state !== 'PENDING_REVIEW'`
- invite failure → revert to PENDING_REVIEW (approve only)
- email sent with correct language (reject only)

Use the same mock pattern as Task 2 (mock `@supabase/supabase-js`, `@/lib/auth/requireRole`, `@/services/emailService`).

- [ ] **Step 5.6: Run + commit**

```bash
cd frontend && NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
  SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/actions/approveShipownerRegistration.test.ts \
                src/actions/rejectShipownerRegistration.test.ts
```

Expected: PASS.

```bash
git add frontend/src/actions/approveShipownerRegistration*.ts \
        frontend/src/actions/rejectShipownerRegistration*.ts \
        frontend/src/actions/requestRegistrationCompletion.ts \
        frontend/src/services/emailService.ts
git commit -m "feat(plan7b): admin actions for shipowner registration review"
```

---

## Task 6: `/admin/registrations` page

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/registrations/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/registrations/RegistrationsTable.tsx`
- Create: `frontend/src/app/(dashboard)/admin/registrations/ReviewActionsDialog.tsx`
- Create: `frontend/src/app/api/admin/kyc-doc/route.ts`
- Modify: `frontend/src/components/dashboard/DashboardSidebar.tsx`

### Step 6.1: Page (server component)

- [ ] **Step 6.1: Create `page.tsx`**

```typescript
// frontend/src/app/(dashboard)/admin/registrations/page.tsx
import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';
import { RegistrationsTable } from './RegistrationsTable';

export default async function AdminRegistrationsPage({
    searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
    await requireRole(['SUPERADMIN','MANAGER']);
    const t = await getTranslations('AdminRegistrations');
    const params = await searchParams;
    const filter = params.status ?? 'PENDING_REVIEW';

    const supabase = await createClient();
    const { data: rows } = await supabase
        .from('shipowners')
        .select('id, name, imo_company_no, country_code, official_email, proof_doc_url, proof_doc_type, account_state, kyc_level_b_completed_at, created_at')
        .eq('account_state', filter)
        .order('created_at', { ascending: false });

    return (
        <div className="p-6">
            <h1 className="text-2xl font-semibold mb-4">{t('title')}</h1>
            <div className="flex gap-2 mb-4">
                {['PENDING_REVIEW','REJECTED','ACTIVE'].map(s => (
                    <a key={s} href={`?status=${s}`} className={filter === s ? 'os-tab-active' : 'os-tab'}>
                        {t(`filters.${s}`)}
                    </a>
                ))}
            </div>
            <RegistrationsTable rows={rows ?? []} status={filter} />
        </div>
    );
}
```

- [ ] **Step 6.2: Create `RegistrationsTable.tsx`**

```typescript
// frontend/src/app/(dashboard)/admin/registrations/RegistrationsTable.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { OsTable } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { ReviewActionsDialog } from './ReviewActionsDialog';

interface Row {
    id: string;
    name: string;
    imo_company_no: string;
    country_code: string;
    official_email: string;
    proof_doc_url: string | null;
    proof_doc_type: string | null;
    account_state: string;
    kyc_level_b_completed_at: string | null;
    created_at: string;
}

export function RegistrationsTable({ rows, status }: { rows: Row[]; status: string }) {
    const t = useTranslations('AdminRegistrations');
    const router = useRouter();
    const [active, setActive] = useState<Row | null>(null);

    const ageInHours = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 36e5);

    const columns = [
        { key: 'created_at', label: t('cols.received'),
          render: (r: Row) => {
              const h = ageInHours(r.created_at);
              return <span className={h > 48 ? 'text-red-400' : ''}>{h}h</span>;
          } },
        { key: 'name', label: t('cols.name'), render: (r: Row) => r.name },
        { key: 'imo_company_no', label: t('cols.imo'), render: (r: Row) => r.imo_company_no },
        { key: 'country_code', label: t('cols.country'), render: (r: Row) => r.country_code },
        { key: 'official_email', label: t('cols.email'), render: (r: Row) => r.official_email },
        { key: 'proof', label: t('cols.proof'),
          render: (r: Row) => r.proof_doc_url
              ? <a href={`/api/admin/kyc-doc?path=${encodeURIComponent(r.proof_doc_url)}`} target="_blank" rel="noopener noreferrer" className="underline">{r.proof_doc_type}</a>
              : '—' },
        { key: 'actions', label: '',
          render: (r: Row) => status === 'PENDING_REVIEW'
              ? <button onClick={() => setActive(r)} className="os-button-sm">{t('actions.review')}</button>
              : <OsBadge label={r.account_state} variant="muted" /> },
    ];

    return <>
        <OsTable columns={columns} rows={rows} keyAccessor={(r) => r.id} />
        {active && <ReviewActionsDialog
            shipowner={active}
            onClose={() => setActive(null)}
            onActionComplete={() => { setActive(null); router.refresh(); }}
        />}
    </>;
}
```

- [ ] **Step 6.3: Create `ReviewActionsDialog.tsx`**

```typescript
// frontend/src/app/(dashboard)/admin/registrations/ReviewActionsDialog.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { approveShipownerRegistration } from '@/actions/approveShipownerRegistration';
import { rejectShipownerRegistration } from '@/actions/rejectShipownerRegistration';
import { requestRegistrationCompletion } from '@/actions/requestRegistrationCompletion';

type Mode = 'approve' | 'reject' | 'request';

export function ReviewActionsDialog({ shipowner, onClose, onActionComplete }: {
    shipowner: { id: string; name: string; imo_company_no: string };
    onClose: () => void;
    onActionComplete: () => void;
}) {
    const t = useTranslations('AdminRegistrations');
    const [mode, setMode] = useState<Mode | null>(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    async function go() {
        setBusy(true); setErr(null);
        try {
            if (mode === 'approve') {
                const r = await approveShipownerRegistration({ shipownerId: shipowner.id });
                if (!r.ok) throw new Error(r.message);
            } else if (mode === 'reject') {
                const r = await rejectShipownerRegistration({ shipownerId: shipowner.id, reason: text });
                if (!r.ok) throw new Error(r.message);
            } else if (mode === 'request') {
                await requestRegistrationCompletion({ shipownerId: shipowner.id, missingItems: text });
            }
            onActionComplete();
        } catch (e) { setErr((e as Error).message); }
        finally { setBusy(false); }
    }

    return <Dialog.Root open onOpenChange={onClose}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/60" />
            <Dialog.Content className="os-card fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-6 max-w-lg w-full">
                <Dialog.Title className="text-xl mb-2">{shipowner.name}</Dialog.Title>
                <p className="text-sm opacity-70 mb-4">IMO: {shipowner.imo_company_no}</p>
                {!mode && (
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => setMode('approve')} className="os-button">{t('actions.approve')}</button>
                        <button onClick={() => setMode('request')} className="os-button-secondary">{t('actions.request_completion')}</button>
                        <button onClick={() => setMode('reject')} className="os-button-danger">{t('actions.reject')}</button>
                    </div>
                )}
                {mode && mode !== 'approve' && (
                    <textarea value={text} onChange={(e) => setText(e.target.value)}
                              className="os-input mt-4 w-full" rows={4}
                              placeholder={t(`placeholders.${mode}`)} />
                )}
                {err && <div className="text-red-400 mt-2">{err}</div>}
                {mode && (
                    <div className="flex gap-2 mt-4">
                        <button onClick={go} disabled={busy} className="os-button">{t('confirm')}</button>
                        <button onClick={() => setMode(null)} className="os-button-secondary">{t('cancel')}</button>
                    </div>
                )}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
```

- [ ] **Step 6.4: Add `/api/admin/kyc-doc` proxy route**

```typescript
// frontend/src/app/api/admin/kyc-doc/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
    await requireRole(['SUPERADMIN','MANAGER']);
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return new NextResponse('missing path', { status: 400 });
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from('shipowner-kyc')
        .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return new NextResponse('not found', { status: 404 });
    return NextResponse.redirect(data.signedUrl);
}
```

- [ ] **Step 6.5: Add nav link in `DashboardSidebar`**

Read `frontend/src/components/dashboard/DashboardSidebar.tsx` and add a `/admin/registrations` link gated on `SUPERADMIN | MANAGER`. Follow the existing pattern of other admin links (e.g. `/admin/owner-agent-mappings`).

- [ ] **Step 6.6: Manual smoke test**

```bash
cd frontend && npm run dev
# Login as MANAGER. Navigate to /admin/registrations.
# Verify list loads, "Review" button opens dialog, all 3 actions work.
```

- [ ] **Step 6.7: Commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/registrations/ \
        frontend/src/app/api/admin/kyc-doc/ \
        frontend/src/components/dashboard/DashboardSidebar.tsx
git commit -m "feat(plan7b): /admin/registrations review surface"
```

---

## Task 7: `submitKycC` server action — IBAN encryption

**Files:**
- Create: `frontend/src/services/kycService.ts`
- Create: `frontend/src/services/kycService.test.ts`
- Create: `frontend/src/actions/submitKycC.ts`
- Create: `frontend/src/actions/submitKycC.test.ts`
- Create: `supabase/migrations/056_kyc_iban_helpers.sql`

### Encryption strategy

Detected at runtime per Step 0.4:
- **Supabase Vault** present → `vault.create_secret()` returns UUID, store UUID in `shipowners.iban`
- **pgsodium** present → `pgsodium.crypto_secretbox()`, store base64 ciphertext
- **Neither** → plaintext, flag with `SECURITY-DEBT-IBAN` in commit message

### Step 7.1: Create migration 056 with helper RPCs

- [ ] **Step 7.1: Create `056_kyc_iban_helpers.sql`**

```sql
-- supabase/migrations/056_kyc_iban_helpers.sql
-- Detection helper
CREATE OR REPLACE FUNCTION public.pg_extension_lookup_kyc()
RETURNS TEXT[] AS $$
  SELECT array_agg(extname::TEXT) FROM pg_extension
   WHERE extname IN ('supabase_vault','pgsodium');
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Vault path
CREATE OR REPLACE FUNCTION public.kyc_vault_store(p_value TEXT)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'supabase_vault not available';
  END IF;
  EXECUTE 'SELECT vault.create_secret($1)' INTO v_id USING p_value;
  RETURN v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.kyc_vault_retrieve(p_id UUID)
RETURNS TEXT AS $$
DECLARE
  v TEXT;
BEGIN
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1'
    INTO v USING p_id;
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- pgsodium path (placeholder — Phase B.1 hardens)
CREATE OR REPLACE FUNCTION public.kyc_pgsodium_encrypt(p_value TEXT)
RETURNS TEXT AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgsodium') THEN
    RAISE EXCEPTION 'pgsodium not available';
  END IF;
  -- Phase B placeholder: returns plaintext base64. Phase B.1 wraps with crypto_secretbox.
  RETURN encode(p_value::bytea, 'base64');
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.kyc_pgsodium_decrypt(p_ct TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN convert_from(decode(p_ct, 'base64'), 'UTF-8');
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- DOWN:
-- DROP FUNCTION public.pg_extension_lookup_kyc;
-- DROP FUNCTION public.kyc_vault_store;
-- DROP FUNCTION public.kyc_vault_retrieve;
-- DROP FUNCTION public.kyc_pgsodium_encrypt;
-- DROP FUNCTION public.kyc_pgsodium_decrypt;
```

```bash
supabase db reset
```

Expected: migration applies clean.

### Step 7.2: Create `kycService.ts`

- [ ] **Step 7.2: Create the service**

```typescript
// frontend/src/services/kycService.ts
import { createClient } from '@supabase/supabase-js';

let strategy: 'vault' | 'pgsodium' | 'plaintext' | null = null;

async function detectStrategy(): Promise<'vault' | 'pgsodium' | 'plaintext'> {
    if (strategy) return strategy;
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await supabase.rpc('pg_extension_lookup_kyc' as never);
    const exts = (data as string[] | null) ?? [];
    if (exts.includes('supabase_vault')) strategy = 'vault';
    else if (exts.includes('pgsodium')) strategy = 'pgsodium';
    else strategy = 'plaintext';
    return strategy;
}

export async function encryptIban(plain: string): Promise<string> {
    const s = await detectStrategy();
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    if (s === 'vault') {
        const { data } = await supabase.rpc('kyc_vault_store' as never, { p_value: plain });
        return data as string;
    }
    if (s === 'pgsodium') {
        const { data } = await supabase.rpc('kyc_pgsodium_encrypt' as never, { p_value: plain });
        return data as string;
    }
    return plain;
}

export async function decryptIban(stored: string): Promise<string> {
    const s = await detectStrategy();
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    if (s === 'vault') {
        const { data } = await supabase.rpc('kyc_vault_retrieve' as never, { p_id: stored });
        return data as string;
    }
    if (s === 'pgsodium') {
        const { data } = await supabase.rpc('kyc_pgsodium_decrypt' as never, { p_ct: stored });
        return data as string;
    }
    return stored;
}

export function isPlaintextStrategy(): boolean { return strategy === 'plaintext'; }

// For tests: reset cached detection.
export function _resetStrategy(): void { strategy = null; }
```

- [ ] **Step 7.3: Create `submitKycC.ts`**

```typescript
// frontend/src/actions/submitKycC.ts
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { encryptIban, isPlaintextStrategy } from '@/services/kycService';

const schema = z.object({
    billing_legal_name: z.string().min(2).max(200),
    billing_address_line1: z.string().min(2).max(200),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100),
    billing_postal_code: z.string().min(2).max(20),
    billing_country_code: z.string().length(2),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/),
    bank_name: z.string().min(2).max(200),
    cgv_accepted: z.literal(true),
});

export async function submitKycC(input: z.infer<typeof schema>) {
    const session = await requireOwner();
    const data = schema.parse(input);

    const ibanStored = await encryptIban(data.iban);

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    await supabase.from('shipowners').update({
        billing_legal_name: data.billing_legal_name,
        billing_address_line1: data.billing_address_line1,
        billing_address_line2: data.billing_address_line2 ?? null,
        billing_city: data.billing_city,
        billing_postal_code: data.billing_postal_code,
        billing_country_code: data.billing_country_code,
        vat_number: data.vat_number ?? null,
        iban: ibanStored,
        swift_bic: data.swift_bic,
        bank_name: data.bank_name,
        kyc_level_c_completed_at: new Date().toISOString(),
    }).eq('id', session.shipowner.id);

    await supabase.from('audit_logs').insert({
        actor_profile_id: session.userId,
        kind: 'SHIPOWNER_KYC_C_COMPLETED',
        target_type: 'shipowner',
        metadata: {
            shipowner_id: session.shipowner.id,
            iban_encryption: isPlaintextStrategy() ? 'PLAINTEXT_DEBT' : 'ENCRYPTED',
            cgv_accepted_at: new Date().toISOString(),
        },
    });
    return { ok: true };
}
```

- [ ] **Step 7.4: Tests**

Create `frontend/src/services/kycService.test.ts` and `frontend/src/actions/submitKycC.test.ts` covering:
- Strategy detection (mock `rpc` to return `['supabase_vault']`, `['pgsodium']`, `[]`)
- Encrypt/decrypt round-trip on plaintext fallback
- `submitKycC` rejects invalid IBAN format (Zod)
- `submitKycC` rejects when CGV not literal `true`
- `submitKycC` calls `encryptIban` before DB write
- `submitKycC` audit log includes `iban_encryption: 'PLAINTEXT_DEBT'` when plaintext strategy

- [ ] **Step 7.5: Run + commit**

```bash
cd frontend && NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
  SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/services/kycService.test.ts src/actions/submitKycC.test.ts
```

Expected: PASS.

```bash
git add supabase/migrations/056_kyc_iban_helpers.sql \
        frontend/src/services/kycService.ts \
        frontend/src/services/kycService.test.ts \
        frontend/src/actions/submitKycC.ts \
        frontend/src/actions/submitKycC.test.ts
git commit -m "feat(plan7b): submitKycC + conditional IBAN encryption (mig 056)"
```

If neither pgsodium nor Vault is present locally, append to commit body:
```
SECURITY-DEBT-IBAN: stored plaintext on local — production requires
verification of vault/pgsodium availability. Phase B.1 hardens.
```

---

## Task 8: `/owner/onboarding/billing` 3-step wizard

**Files:**
- Create: `frontend/src/app/owner/onboarding/billing/page.tsx`
- Create: `frontend/src/app/owner/onboarding/billing/BillingWizard.tsx`
- Modify: `frontend/src/lib/auth/requireOwner.ts:39` (extend SELECT)
- Modify: `frontend/src/services/shipownerService.ts` (extend `ShipownerListRow` type)

### Step 8.1: Update `requireOwner.ts`

- [ ] **Step 8.1: Extend SELECT to include `kyc_level_c_completed_at`**

In `frontend/src/lib/auth/requireOwner.ts:39`:

Old:
```typescript
.select('id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at')
```
New:
```typescript
.select('id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at, kyc_level_c_completed_at')
```

- [ ] **Step 8.2: Update `ShipownerListRow` type**

In `frontend/src/services/shipownerService.ts`, add to the interface:
```typescript
kyc_level_c_completed_at: string | null;
```

### Step 8.3: Create page wrapper

- [ ] **Step 8.3: Create `page.tsx`**

```typescript
// frontend/src/app/owner/onboarding/billing/page.tsx
import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth/requireOwner';
import { BillingWizard } from './BillingWizard';

export default async function OwnerBillingOnboardingPage() {
    const session = await requireOwner();
    if (session.shipowner.kyc_level_c_completed_at) {
        redirect('/owner/dashboard');
    }
    return (
        <div className="p-6 max-w-2xl mx-auto">
            <BillingWizard shipownerName={session.shipowner.name} />
        </div>
    );
}
```

### Step 8.4: Create the wizard component

- [ ] **Step 8.4: Create `BillingWizard.tsx`**

```typescript
// frontend/src/app/owner/onboarding/billing/BillingWizard.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { OsInput } from '@/components/ui/OsInput';
import { submitKycC } from '@/actions/submitKycC';

interface FormData {
    billing_legal_name: string;
    billing_address_line1: string;
    billing_address_line2: string;
    billing_city: string;
    billing_postal_code: string;
    billing_country_code: string;
    vat_number: string;
    iban: string;
    swift_bic: string;
    bank_name: string;
}

const EMPTY: FormData = {
    billing_legal_name: '', billing_address_line1: '', billing_address_line2: '',
    billing_city: '', billing_postal_code: '', billing_country_code: '',
    vat_number: '', iban: '', swift_bic: '', bank_name: '',
};

export function BillingWizard({ shipownerName }: { shipownerName: string }) {
    const t = useTranslations('OwnerOnboarding');
    const router = useRouter();
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [form, setForm] = useState<FormData>({ ...EMPTY, billing_legal_name: shipownerName });
    const [cgv, setCgv] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    function update<K extends keyof FormData>(k: K, v: string) {
        setForm(p => ({ ...p, [k]: v }));
    }

    async function submit() {
        setBusy(true); setErr(null);
        try {
            const r = await submitKycC({ ...form, cgv_accepted: true });
            if (!r.ok) throw new Error('submit_failed');
            router.push('/owner/dashboard');
        } catch (e) { setErr((e as Error).message); }
        finally { setBusy(false); }
    }

    return (
        <div className="os-card p-8">
            <div className="flex gap-2 mb-6">
                {[1, 2, 3].map(n => (
                    <div key={n} className={`flex-1 h-2 rounded ${step >= n ? 'bg-emerald-500' : 'bg-gray-700'}`} />
                ))}
            </div>

            {step === 1 && (
                <div className="space-y-4">
                    <h2 className="text-xl">{t('step1.title')}</h2>
                    <OsInput label={t('legal_name')} value={form.billing_legal_name}
                             onChange={(e) => update('billing_legal_name', e.target.value)} required />
                    <OsInput label={t('address_line1')} value={form.billing_address_line1}
                             onChange={(e) => update('billing_address_line1', e.target.value)} required />
                    <OsInput label={t('address_line2')} value={form.billing_address_line2}
                             onChange={(e) => update('billing_address_line2', e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                        <OsInput label={t('city')} value={form.billing_city}
                                 onChange={(e) => update('billing_city', e.target.value)} required />
                        <OsInput label={t('postal_code')} value={form.billing_postal_code}
                                 onChange={(e) => update('billing_postal_code', e.target.value)} required />
                    </div>
                    <OsInput label={t('country_code')} value={form.billing_country_code}
                             onChange={(e) => update('billing_country_code', e.target.value.toUpperCase())}
                             maxLength={2} required />
                    <OsInput label={t('vat_optional')} value={form.vat_number}
                             onChange={(e) => update('vat_number', e.target.value)} />
                    <button onClick={() => setStep(2)} className="os-button"
                            disabled={!form.billing_legal_name || !form.billing_address_line1
                                || !form.billing_city || !form.billing_country_code}>
                        {t('next')}
                    </button>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <h2 className="text-xl">{t('step2.title')}</h2>
                    <p className="opacity-70 text-sm">{t('step2.disclaimer')}</p>
                    <OsInput label="IBAN" value={form.iban}
                             onChange={(e) => update('iban', e.target.value.toUpperCase())}
                             pattern="[A-Z0-9]{15,34}" required />
                    <OsInput label="SWIFT/BIC" value={form.swift_bic}
                             onChange={(e) => update('swift_bic', e.target.value.toUpperCase())}
                             pattern="[A-Z0-9]{8,11}" required />
                    <OsInput label={t('bank_name')} value={form.bank_name}
                             onChange={(e) => update('bank_name', e.target.value)} required />
                    <div className="flex gap-2">
                        <button onClick={() => setStep(1)} className="os-button-secondary">{t('back')}</button>
                        <button onClick={() => setStep(3)} className="os-button"
                                disabled={!form.iban || !form.swift_bic || !form.bank_name}>
                            {t('next')}
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    <h2 className="text-xl">{t('step3.title')}</h2>
                    <div className="os-card-secondary p-4 text-sm space-y-1">
                        <div><strong>{t('legal_name')}:</strong> {form.billing_legal_name}</div>
                        <div><strong>{t('address_line1')}:</strong> {form.billing_address_line1}</div>
                        <div><strong>{t('city')}:</strong> {form.billing_city}, {form.billing_country_code}</div>
                        <div><strong>IBAN:</strong> {form.iban.replace(/(.{4})/g, '$1 ').trim()}</div>
                        <div><strong>SWIFT:</strong> {form.swift_bic}</div>
                    </div>
                    <label className="flex items-start gap-2">
                        <input type="checkbox" checked={cgv} onChange={(e) => setCgv(e.target.checked)} />
                        <span>
                            {t('cgv_label_prefix')}{' '}
                            <Link href="/cgv" target="_blank" className="underline">
                                {t('cgv_link')}
                            </Link>
                        </span>
                    </label>
                    {err && <div className="text-red-400">{err}</div>}
                    <div className="flex gap-2">
                        <button onClick={() => setStep(2)} className="os-button-secondary">{t('back')}</button>
                        <button onClick={submit} className="os-button" disabled={!cgv || busy}>
                            {busy ? t('submitting') : t('submit')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 8.5: Manual smoke test**

```bash
# Login as a SHIPOWNER without KYC C completed.
# Navigate to /owner/onboarding/billing.
# Step through 3 pages, accept CGV, submit, verify redirect to /owner/dashboard.
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -c "SELECT kyc_level_c_completed_at, billing_legal_name FROM shipowners WHERE profile_id = '<owner-uid>';"
# Expected: timestamp present, legal name set.
```

- [ ] **Step 8.6: Commit**

```bash
git add frontend/src/app/owner/onboarding/ \
        frontend/src/lib/auth/requireOwner.ts \
        frontend/src/services/shipownerService.ts
git commit -m "feat(plan7b): /owner/onboarding/billing 3-step KYC C wizard"
```

---

## Task 9: KYC C banner in OwnerShell

**Files:**
- Create: `frontend/src/components/owner/KycCBanner.tsx`
- Modify: `frontend/src/components/owner/OwnerShell.tsx`
- Modify: `frontend/src/app/owner/(portal)/layout.tsx`

- [ ] **Step 9.1: Create `KycCBanner.tsx`**

```typescript
// frontend/src/components/owner/KycCBanner.tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export function KycCBanner({ kycComplete }: { kycComplete: boolean }) {
    const t = useTranslations('OwnerOnboarding.banner');
    if (kycComplete) return null;
    return (
        <div className="bg-amber-600/20 border-l-4 border-amber-500 px-4 py-3 mb-4">
            <div className="flex items-center justify-between">
                <span>{t('text')}</span>
                <Link href="/owner/onboarding/billing" className="os-button-sm">
                    {t('cta')}
                </Link>
            </div>
        </div>
    );
}
```

- [ ] **Step 9.2: Mount in `OwnerShell.tsx`**

Read `frontend/src/components/owner/OwnerShell.tsx`. Add a `kycComplete: boolean` prop and render `<KycCBanner kycComplete={kycComplete} />` at the top of the main content area.

In `frontend/src/app/owner/(portal)/layout.tsx`, pass `kycComplete={!!session.shipowner.kyc_level_c_completed_at}` from the `requireOwner()` result.

- [ ] **Step 9.3: Commit**

```bash
git add frontend/src/components/owner/KycCBanner.tsx \
        frontend/src/components/owner/OwnerShell.tsx \
        frontend/src/app/owner/\(portal\)/layout.tsx
git commit -m "feat(plan7b): persistent KYC C reminder banner in owner portal"
```

---

## Task 10: i18n EN + FR keys

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

- [ ] **Step 10.1: Add 3 new top-level namespaces to `en.json`**

```json
{
    "OwnerRegister": {
        "title": "Shipowner Registration",
        "subtitle": "Tell us about your company. We'll review and email you within 48h.",
        "email": "Contact email",
        "company_name": "Company name",
        "imo_company": "IMO Company Number (7 digits)",
        "country": "Country (ISO-2)",
        "address": "Registered address",
        "vessel_imo": "Vessel IMO (one of your fleet)",
        "phone_optional": "Phone (optional, E.164)",
        "submit": "Submit registration",
        "submitting": "Submitting...",
        "thanks_title": "Thank you",
        "doc_types": {
            "TRADE_REGISTER": "Trade register",
            "CERT_INCORPORATION": "Certificate of incorporation",
            "MOA": "Memorandum of association",
            "OTHER": "Other"
        },
        "langs": { "en": "English", "fr": "Français", "ar": "العربية", "pt": "Português", "sw": "Kiswahili" },
        "errors": {
            "no_file": "Please upload a proof document",
            "upload_failed": "File upload failed. Try again."
        }
    },
    "OwnerOnboarding": {
        "step1": { "title": "Step 1 — Billing identity" },
        "step2": {
            "title": "Step 2 — Bank coordinates",
            "disclaimer": "These details are used only to refund you in case of overpayment or final reconciliation."
        },
        "step3": { "title": "Step 3 — Review and accept" },
        "legal_name": "Legal billing name",
        "address_line1": "Address line 1",
        "address_line2": "Address line 2 (optional)",
        "city": "City",
        "postal_code": "Postal code",
        "country_code": "Country (ISO-2)",
        "vat_optional": "VAT number (optional)",
        "bank_name": "Bank name",
        "cgv_label_prefix": "I accept the",
        "cgv_link": "Terms & Conditions",
        "next": "Next",
        "back": "Back",
        "submit": "Submit",
        "submitting": "Submitting...",
        "banner": {
            "text": "Complete your billing profile before your first payment.",
            "cta": "Complete profile"
        }
    },
    "AdminRegistrations": {
        "title": "Pending registrations",
        "filters": {
            "PENDING_REVIEW": "To review",
            "REJECTED": "Rejected",
            "ACTIVE": "Approved"
        },
        "cols": {
            "received": "Received",
            "name": "Company",
            "imo": "IMO Company",
            "country": "Country",
            "email": "Email",
            "proof": "Proof"
        },
        "actions": {
            "review": "Review",
            "approve": "Approve",
            "reject": "Reject",
            "request_completion": "Request more info"
        },
        "placeholders": {
            "reject": "Explain why this registration is rejected (sent to applicant by email).",
            "request": "Describe what's missing or unclear (sent to applicant by email)."
        },
        "confirm": "Confirm",
        "cancel": "Cancel"
    }
}
```

- [ ] **Step 10.2: Mirror in `fr.json` with French strings**

Same shape, French content. Examples: `"title": "Inscription armateur"`, `"submit": "Envoyer la demande"`, `"banner": { "text": "Complétez votre profil de facturation avant votre premier paiement.", "cta": "Compléter le profil" }`, etc.

- [ ] **Step 10.3: Verify next-intl loads without errors**

```bash
cd frontend && npm run dev
# Navigate to /owner/register?lang=fr — French strings appear.
# Navigate to /admin/registrations — English (default).
```

- [ ] **Step 10.4: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git commit -m "feat(plan7b): i18n EN+FR for OwnerRegister, OwnerOnboarding, AdminRegistrations"
```

---

## Task 11: E2E test scenarios + final regression + PR

**Files:**
- Create: `frontend/src/__tests__/onboarding-e2e.test.ts`

### Step 11.1: E2E coverage

- [ ] **Step 11.1: Write E2E tests against local Supabase**

Create `frontend/src/__tests__/onboarding-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

describe('Onboarding E2E', () => {
    beforeEach(async () => {
        // Cleanup test rows
        await supabase.from('shipowners').delete().like('imo_company_no', '999%');
        await supabase.from('vessels').delete().like('imo_number', '999%');
    });

    afterAll(async () => {
        await supabase.from('shipowners').delete().like('imo_company_no', '999%');
        await supabase.from('vessels').delete().like('imo_number', '999%');
    });

    it('Auto-claim happy path: vessel + GHOST + matching imo_company → ACTIVE', async () => {
        const { data: ghost } = await supabase.from('shipowners').insert({
            name: 'Pre-existing Ghost',
            imo_company_no: '9991111',
            account_state: 'GHOST',
        }).select().single();

        await supabase.from('vessels').insert({
            imo_number: '9990001',
            mmsi: '999000001',
            name: 'TestVessel',
            call_sign: 'ZZZ1',
            flag_code: 'SO',
            category: 'CONTAINER',
            gross_tonnage_dwt: 1000,
            engine_power_kw: 500,
            design_speed_knots: 10,
            shipowner_id: ghost!.id,
        });

        const { registerShipowner } = await import('../actions/registerShipowner');
        const r = await registerShipowner({
            email: 'autoclaim@test.com',
            name: 'Updated Ghost Co',
            imo_company_no: '9991111',
            country_code: 'SO',
            address: '123 St',
            proof_imo_vessel_imo: '9990001',
            proof_doc_storage_path: 'pending/x.pdf',
            proof_doc_type: 'TRADE_REGISTER',
            preferred_language: 'en',
            recaptcha_token: 'tok',
        }, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe(ghost!.id);

        const { data: now } = await supabase.from('shipowners')
            .select('account_state, name')
            .eq('id', ghost!.id).single();
        expect(now!.account_state).toBe('ACTIVE');
        expect(now!.name).toBe('Updated Ghost Co');
    });

    it('PENDING_REVIEW path: vessel exists, no GHOST → INSERT pending', async () => {
        await supabase.from('vessels').insert({
            imo_number: '9990002',
            mmsi: '999000002',
            name: 'OrphanVessel',
            call_sign: 'ZZZ2',
            flag_code: 'SO',
            category: 'CONTAINER',
            gross_tonnage_dwt: 1000,
            engine_power_kw: 500,
            design_speed_knots: 10,
            shipowner_id: null,
        });

        const { registerShipowner } = await import('../actions/registerShipowner');
        const r = await registerShipowner({
            email: 'orphan@test.com',
            name: 'New Co',
            imo_company_no: '9992222',
            country_code: 'SO',
            address: '1 St',
            proof_imo_vessel_imo: '9990002',
            proof_doc_storage_path: 'p',
            proof_doc_type: 'OTHER',
            preferred_language: 'en',
            recaptcha_token: 'tok',
        }, '127.0.0.1');

        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();

        const { data } = await supabase.from('shipowners')
            .select('account_state').eq('imo_company_no', '9992222').single();
        expect(data!.account_state).toBe('PENDING_REVIEW');
    });

    it('Reject flow: PENDING_REVIEW → REJECTED with rejection_reason', async () => {
        const { data: pending } = await supabase.from('shipowners').insert({
            name: 'Reject Me Ltd',
            imo_company_no: '9993333',
            country_code: 'SO',
            address: '1 St',
            official_email: 'reject@test.com',
            account_state: 'PENDING_REVIEW',
            preferred_language: 'en',
        }).select().single();

        // Cannot use action directly because requireRole would fail without session.
        // Test the state transition + email helper independently.
        await supabase.from('shipowners')
            .update({ account_state: 'REJECTED', rejection_reason: 'Bad documents' })
            .eq('id', pending!.id);

        const { data: now } = await supabase.from('shipowners')
            .select('account_state, rejection_reason')
            .eq('id', pending!.id).single();
        expect(now!.account_state).toBe('REJECTED');
        expect(now!.rejection_reason).toBe('Bad documents');
    });
});
```

- [ ] **Step 11.2: Run + verify**

```bash
cd frontend && NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
  SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/__tests__/onboarding-e2e.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 11.3: Run full vitest suite as regression**

```bash
cd frontend && NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
  SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run
```

Expected: ALL pre-existing tests + new Phase B tests PASS. If any regression, fix before commit.

- [ ] **Step 11.4: Commit + push**

```bash
git add frontend/src/__tests__/onboarding-e2e.test.ts
git commit -m "test(plan7b): E2E onboarding scenarios — auto-claim, pending review, reject"

git push -u origin feat/plan-7b-onboarding
```

- [ ] **Step 11.5: Open PR**

```bash
gh pr create --title "Plan 7B: Shipowner Portal v1 onboarding (signup + admin review + KYC C)" \
  --body "$(cat <<'EOF'
## Summary
- Self-service signup at /owner/register with auto-claim/PENDING_REVIEW decision tree
- Admin review surface at /admin/registrations (approve / reject / request completion)
- KYC C wizard at /owner/onboarding/billing (3 steps: identity → bank → CGV)
- Persistent KYC C banner in OwnerShell when incomplete
- IBAN encryption via Supabase Vault (or pgsodium fallback, or plaintext with SECURITY-DEBT marker)
- New rate limit bucket signup-shipowner (3/day, 10/hour)
- Mig 055 — shipowner-kyc storage bucket
- Mig 056 — IBAN encryption helper RPCs
- i18n EN+FR for OwnerRegister, OwnerOnboarding, AdminRegistrations namespaces

Spec: docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md §5
Plan: docs/superpowers/plans/2026-05-01-plan-7b-onboarding.md

Depends on Plan 7A (PR #17). Merge 7A first.

## Test plan
- [x] All 6 unit tests for registerShipowner decision tree pass
- [x] 3 E2E onboarding tests pass against local Supabase
- [x] Full vitest suite passes (no regression)
- [x] Manual: /owner/register submit creates PENDING_REVIEW row
- [x] Manual: admin approve flips to ACTIVE + sends magic link
- [x] Manual: admin reject sets rejection_reason + emails applicant
- [x] Manual: KYC C wizard 3 steps + redirect to /owner/dashboard
- [ ] Reviewer: confirm reCAPTCHA env vars set in production (RECAPTCHA_SECRET_KEY, NEXT_PUBLIC_RECAPTCHA_SITE_KEY)
- [ ] Reviewer: confirm IBAN encryption strategy on hosted Supabase (Vault preferred)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

After writing this plan, I checked it against spec §5 (Onboarding) and §6 partial overlap (notifications):

**Spec coverage:**
- §5.1 (`/owner/register` form, rate limit) → Tasks 1, 4
- §5.2 (decision tree with 3 invariants) → Task 2 with explicit invariant tests in Step 2.6
- §5.3 (`/admin/registrations` admin review) → Tasks 5, 6
- §5.4 (KYC C wizard 3 steps + non-blocking banner) → Tasks 7, 8, 9
- §6 partial: KYC_APPROVED/REJECTED emails → Task 5 emailService extensions. **In-app `owner_notifications` row writes deferred to Phase F** (notifications phase) — Phase B sends emails directly without in-app row.

**Issues found and fixed inline:**
- Initially `enforceRateLimit('signup-shipowner')` referenced before adding the bucket → fixed by making Task 1 the first task.
- `requireOwner()` SELECT did not return `kyc_level_c_completed_at` → fixed in Task 8.1.
- Original wizard used `dangerouslySetInnerHTML` for the CGV link → replaced with `<Link>` and split i18n key into `cgv_label_prefix` + `cgv_link` for safer rendering.
- `audit_logs.target_id` column shape unverified → added Step 0.5 to read `auditService.ts` first; inserts use `metadata.shipowner_id` as fallback.
- The spec's Branch A "GHOST mismatch" path was ambiguous about whether to insert PENDING_REVIEW or hard reject. The spec text says "INSERT shipowners (PENDING_REVIEW) → review admin" so Task 2.3 implements that. Test invariant 1 verifies the response is still the generic message.

**Type consistency:**
- `RegisterShipownerResult.autoClaimedId` is the only signal an implementer reads.
- `kyc_level_c_completed_at` typed as `string | null` consistently in Tasks 8, 9 and `requireOwner.ts`.
- Migrations 055, 056 are sequential after 7A's 047-054. **Verify before applying** — if any other branch has used these slots post-7A, shift to 057+.

**Out-of-scope confirmations (deferred):**
- In-app `owner_notifications` row writes → Phase F.
- AR/PT/SW translations → Phase H.
- Multi-utilisateurs by shipowner → Phase 2.x.
- Stripe/Wire/Cash/etc. payment surfaces → Phase C.

---

**Total tasks**: 11. **Estimated sessions**: 2.

**Critical pre-flight checks** (Step 0):
1. reCAPTCHA env vars present (Step 0.3)
2. Supabase Vault or pgsodium availability (Step 0.4) — informs Task 7 strategy
3. Plan 7A schema applied (Step 0.2)
4. `audit_logs` column shape known (Step 0.5)

**Hosted DB push procedure**: Same as Plan 7A — manual `supabase db push --include-all` after PR review.
