# GreenGate v8 — W1-E Air Operator Self-Service Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an air operator sign up and log in by themselves through the unified owner portal — the air mirror of the maritime self-service flow, claiming a GHOST operator by aircraft identifier + AOC number.

**Architecture:** A new isolated `registerAirOperator` server action mirrors `registerShipowner` branch-for-branch but matches the `aircraft` table (registration|icao24) and verifies identity via an admin-pre-seeded `aoc_number` on the operator. `/owner/register` gains a Maritime/Air mode selector. Admin pre-seeds the AOC via a new `setOperatorAocNumber` action. The existing mode-agnostic `approveShipownerRegistration` handles air PENDING_REVIEW rows unchanged.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript strict, Supabase (Postgres + service-role), Zod, Vitest, next-intl.

**Spec:** `docs/superpowers/specs/2026-06-02-greengate-wedge1e-air-onboarding-design.md`

**Branch:** `feat/greengate-wedge1e-air-onboarding` (already created, stacked on `feat/greengate-wedge1d-aviation-ui`).

---

## File Structure

**Created:**
- `supabase/migrations/079_greengate_air_operator_aoc.sql` — `aoc_number` column + `proof_doc_type` CHECK extension.
- `supabase/tests/migrations/079_greengate_air_operator_aoc.test.sql` — pg assertions.
- `frontend/src/actions/registerAirOperator.ts` — core self-service action (air mirror of registerShipowner).
- `frontend/src/actions/registerAirOperator.test.ts` — decision-tree tests.
- `frontend/src/app/api/auth/register-air-operator/route.ts` — POST wrapper.
- `frontend/src/actions/setOperatorAocNumber.ts` — admin AOC pre-seed action.
- `frontend/src/actions/setOperatorAocNumber.test.ts` — auth/jurisdiction tests.
- `frontend/src/app/owner/register/AirRegisterForm.tsx` — air signup form.
- `frontend/src/app/owner/register/RegisterModeSwitcher.tsx` — Maritime/Air tabs.
- `frontend/src/app/owner/register/RegisterModeSwitcher.test.tsx` — render test.

**Modified:**
- `frontend/src/lib/feature-flags.ts` — add `airSelfServiceEnabled`.
- `frontend/src/lib/feature-flags.test.ts` — assert the new flag.
- `frontend/src/actions/updateAppConfig.ts` — allowlist the new key.
- `frontend/src/app/owner/register/page.tsx` — read both flags, render switcher.
- `frontend/src/services/shipownerService.ts` — add `aoc_number` to list row + select.
- `frontend/src/app/(dashboard)/admin/owner-agent-mappings/ShipownersList.tsx` — AOC column + set dialog.
- i18n catalogs (EN + FR) — `AirRegister.*` + `AdminMappings.aoc.*` keys.

---

## Task 1: Migration 079 — `aoc_number` + `proof_doc_type` CHECK

**Files:**
- Create: `supabase/migrations/079_greengate_air_operator_aoc.sql`
- Test: `supabase/tests/migrations/079_greengate_air_operator_aoc.test.sql`

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/079_greengate_air_operator_aoc.test.sql`:

```sql
-- W1-E mig 079: aoc_number column + proof_doc_type CHECK accepts 'AOC'.
BEGIN;

-- 1. aoc_number column exists and is nullable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipowners' AND column_name='aoc_number'
  ) THEN RAISE EXCEPTION 'aoc_number column missing'; END IF;

  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='shipowners' AND column_name='aoc_number') <> 'YES'
  THEN RAISE EXCEPTION 'aoc_number must be nullable'; END IF;
END $$;

-- 2. proof_doc_type CHECK accepts 'AOC' (insert a minimal air operator row).
INSERT INTO public.shipowners (name, account_state, applicable_modes, proof_doc_type)
VALUES ('AOC test op', 'PENDING_REVIEW', ARRAY['AIR'], 'AOC');

-- 3. proof_doc_type CHECK still rejects a bogus value.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, account_state, proof_doc_type)
    VALUES ('bogus doc', 'GHOST', 'NOT_A_REAL_TYPE');
    RAISE EXCEPTION 'CHECK should have rejected NOT_A_REAL_TYPE';
  EXCEPTION WHEN check_violation THEN
    NULL; -- expected
  END;
END $$;

-- 4. Maritime value still accepted (non-regression).
INSERT INTO public.shipowners (name, account_state, proof_doc_type)
VALUES ('maritime doc', 'GHOST', 'TRADE_REGISTER');

SELECT '079 GreenGate air operator AOC: PASS' AS result;
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/migrations/079_greengate_air_operator_aoc.test.sql
```
Expected: FAIL — `aoc_number column missing` (the migration does not exist yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/079_greengate_air_operator_aoc.sql`:

```sql
-- GreenGate v8 — W1-E: Air operator self-service onboarding.
-- Adds the air-mode operator identity field (mirror of imo_company_no) and
-- extends the proof_doc_type CHECK (mig 047) to accept the AOC certificate.

ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS aoc_number TEXT;

COMMENT ON COLUMN public.shipowners.aoc_number IS
  'GreenGate v8 W1-E: Air Operator Certificate number. Air-mode identity proof; admin pre-seeds the expected value on the GHOST operator so self-service auto-claim can match it. Air equivalent of imo_company_no.';

-- mig 047 created the constraint inline via ADD COLUMN, so PostgreSQL named it
-- shipowners_proof_doc_type_check. Drop + recreate with 'AOC' added.
ALTER TABLE public.shipowners DROP CONSTRAINT IF EXISTS shipowners_proof_doc_type_check;
ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_proof_doc_type_check
  CHECK (proof_doc_type IN ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER','AOC'));
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/migrations/079_greengate_air_operator_aoc.test.sql
```
Expected: PASS — prints `079 GreenGate air operator AOC: PASS`. If Step 3 fails with a different constraint name, run `psql … -c "\d public.shipowners"`, find the real CHECK name on `proof_doc_type`, and substitute it in the DROP line.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/079_greengate_air_operator_aoc.sql supabase/tests/migrations/079_greengate_air_operator_aoc.test.sql
git commit -m "feat(wedge1): mig 079 — aoc_number + proof_doc_type AOC (air operator identity)"
```

---

## Task 2: Feature flag `air_self_service_enabled`

**Files:**
- Modify: `frontend/src/lib/feature-flags.ts`
- Modify: `frontend/src/lib/feature-flags.test.ts`
- Modify: `frontend/src/actions/updateAppConfig.ts:12-36`

- [ ] **Step 1: Add the failing test**

In `frontend/src/lib/feature-flags.test.ts`, add this test inside the existing top-level `describe` block:

```typescript
it('reads air_self_service_enabled (defaults false when absent)', async () => {
    // Reuse the file's existing app_config mock helper. When the key is absent
    // the flag must default to false; when present and === true it is true.
    const flags = await _readPortalFeatureFlagsImpl();
    expect(flags).toHaveProperty('airSelfServiceEnabled');
    expect(typeof flags.airSelfServiceEnabled).toBe('boolean');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/lib/feature-flags.test.ts`
Expected: FAIL — `airSelfServiceEnabled` is missing from the returned object.

- [ ] **Step 3: Implement — extend the flags struct**

In `frontend/src/lib/feature-flags.ts`:

Add the field to the interface (after `notificationSmsEnabled: boolean;`):
```typescript
    notificationSmsEnabled: boolean;
    airSelfServiceEnabled: boolean;
```

Add to `FLAG_KEYS` (after the `notificationSmsEnabled` entry):
```typescript
    notificationSmsEnabled: 'feature.notification_sms_enabled',
    airSelfServiceEnabled: 'feature.air_self_service_enabled',
```

Add to `defaultFlags()` return (after `notificationSmsEnabled: false,`):
```typescript
        notificationSmsEnabled: false,
        airSelfServiceEnabled: false,
```

- [ ] **Step 4: Allowlist the key for admin toggling**

In `frontend/src/actions/updateAppConfig.ts`, add to the `ALLOWED_KEYS` Set (after `'feature.notification_sms_enabled',`):
```typescript
    'feature.notification_sms_enabled',
    'feature.air_self_service_enabled',
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd frontend && npx vitest run src/lib/feature-flags.test.ts src/actions/updateAppConfig.test.ts`
Expected: PASS. Also run `npx tsc --noEmit` — any other reader of `PortalFeatureFlags` still compiles (the field is additive).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/feature-flags.ts frontend/src/lib/feature-flags.test.ts frontend/src/actions/updateAppConfig.ts
git commit -m "feat(wedge1): air_self_service_enabled feature flag"
```

---

## Task 3: `setOperatorAocNumber` admin action

**Files:**
- Create: `frontend/src/actions/setOperatorAocNumber.ts`
- Test: `frontend/src/actions/setOperatorAocNumber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/setOperatorAocNumber.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockServer = { auth: { getUser: vi.fn() }, from: vi.fn() };
const mockPlatform = { from: vi.fn() };
const mockTenant = { from: vi.fn() };

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => mockServer) }));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockPlatform),
    createTenantClient: vi.fn(() => mockTenant),
}));
vi.mock('@/lib/auth/tenantContext', () => ({
    getServerJurisdictionId: vi.fn(async () => 'jur-1'),
}));

function selectSingle(value: unknown) {
    return { select: () => ({ eq: () => ({ single: async () => ({ data: value, error: null }) }) }) };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockServer.auth.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
});

describe('setOperatorAocNumber', () => {
    it('rejects a non-admin role', async () => {
        mockServer.from.mockReturnValue(selectSingle({ role: 'SHIPOWNER' }));
        const { setOperatorAocNumber } = await import('./setOperatorAocNumber');
        const r = await setOperatorAocNumber({ operatorId: '00000000-0000-4000-8000-000000000001', aocNumber: 'AOC123' });
        expect(r.ok).toBe(false);
    });

    it('SUPERADMIN sets aoc_number (uppercased)', async () => {
        mockServer.from.mockReturnValue(selectSingle({ role: 'SUPERADMIN' }));
        mockPlatform.from.mockReturnValue(selectSingle({ id: 'op-1', jurisdiction_id: 'jur-1' }));
        let written: string | undefined;
        mockTenant.from.mockReturnValue({
            update: (patch: { aoc_number: string }) => ({ eq: async () => { written = patch.aoc_number; return { error: null }; } }),
        });
        const { setOperatorAocNumber } = await import('./setOperatorAocNumber');
        const r = await setOperatorAocNumber({ operatorId: '00000000-0000-4000-8000-000000000001', aocNumber: 'aoc-9z' });
        expect(r.ok).toBe(true);
        expect(written).toBe('AOC-9Z');
    });

    it('blocks a non-SUPERADMIN from another jurisdiction', async () => {
        mockServer.from.mockReturnValue(selectSingle({ role: 'MANAGER' }));
        mockPlatform.from.mockReturnValue(selectSingle({ id: 'op-1', jurisdiction_id: 'jur-OTHER' }));
        const { setOperatorAocNumber } = await import('./setOperatorAocNumber');
        const r = await setOperatorAocNumber({ operatorId: '00000000-0000-4000-8000-000000000001', aocNumber: 'AOC1' });
        expect(r.ok).toBe(false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/actions/setOperatorAocNumber.test.ts`
Expected: FAIL — `Cannot find module './setOperatorAocNumber'`.

- [ ] **Step 3: Implement the action**

Create `frontend/src/actions/setOperatorAocNumber.ts`:

```typescript
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const schema = z.object({
    operatorId: z.string().uuid(),
    aocNumber: z.string().trim().min(2).max(64),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'MANAGER'] as const;

export type SetOperatorAocResult = { ok: true } | { ok: false; reason: string };

/**
 * Pre-seed (or update) the expected AOC number on an operator. Admin-only
 * (SUPERADMIN / MANAGER). Non-SUPERADMIN admins are confined to their own
 * jurisdiction. This is the value the air self-service auto-claim matches against.
 */
export async function setOperatorAocNumber(raw: unknown): Promise<SetOperatorAocResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const platform = createPlatformClient();
    const { data: owner, error: ownerErr } = await platform
        .from('shipowners')
        .select('id, jurisdiction_id')
        .eq('id', parsed.data.operatorId)
        .single();
    if (ownerErr || !owner) return { ok: false, reason: 'operator not found' };

    const jurisdictionId = (owner as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, reason: 'forbidden: operator belongs to another jurisdiction' };
        }
    }

    const admin = createTenantClient(jurisdictionId);
    const { error } = await admin
        .from('shipowners')
        .update({ aoc_number: parsed.data.aocNumber.toUpperCase() })
        .eq('id', parsed.data.operatorId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/actions/setOperatorAocNumber.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/setOperatorAocNumber.ts frontend/src/actions/setOperatorAocNumber.test.ts
git commit -m "feat(wedge1): setOperatorAocNumber admin action (AOC pre-seed)"
```

---

## Task 4: `registerAirOperator` action (core)

**Files:**
- Create: `frontend/src/actions/registerAirOperator.ts`
- Test: `frontend/src/actions/registerAirOperator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/actions/registerAirOperator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabase = {
    from: vi.fn(),
    auth: { admin: { inviteUserByEmail: vi.fn() } },
};

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: vi.fn(() => mockSupabase),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('@/lib/feature-flags', () => ({
    readPortalFeatureFlags: vi.fn(async () => ({
        portalV1Enabled: true,
        selfServiceEnabled: true,
        onlinePaymentStripeEnabled: true,
        walletTopupEnabled: true,
        notificationSmsEnabled: false,
        airSelfServiceEnabled: true,
    })),
    _readPortalFeatureFlagsImpl: vi.fn(),
    isFeatureEnabled: vi.fn(),
}));

// aircraft uses .select().or().limit(); shipowners uses .select().eq().single() + writes.
function aircraftStub(rows: unknown[]) {
    return { select: () => ({ or: () => ({ limit: async () => ({ data: rows }) }) }) };
}
function operatorReadStub(value: unknown) {
    return { select: () => ({ eq: () => ({ single: async () => ({ data: value }) }) }) };
}

const validInput = {
    email: 'pilot@example.com',
    name: 'Air Test Co',
    aoc_number: 'SO-AOC-001',
    aircraft_ident: '6O-ABC',
    country_code: 'SO',
    address: '1 Runway Rd',
    proof_doc_storage_path: 'pending/aoc.pdf',
    preferred_language: 'en' as const,
    recaptcha_token: 'tok',
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env.RECAPTCHA_SECRET_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_BASE_URL = 'http://test';
    vi.stubEnv('NODE_ENV', 'test');
});

describe('registerAirOperator decision tree', () => {
    it('AUTO-CLAIM when aircraft→GHOST→AOC matches (case-insensitive)', async () => {
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }]);
            if (table === 'shipowners') return {
                ...operatorReadStub({ id: 'op1', account_state: 'GHOST', aoc_number: 'so-aoc-001' }),
                update: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'op1' }], error: null }) }) }) }),
            };
            if (table === 'profiles' || table === 'wallets' || table === 'audit_logs') {
                return { insert: async () => ({ error: null }), upsert: async () => ({ error: null }) };
            }
            return operatorReadStub(null);
        });
        mockSupabase.auth.admin.inviteUserByEmail.mockResolvedValue({
            data: { user: { id: 'uid', email: 'pilot@example.com' } }, error: null,
        });

        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBe('op1');
        expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalled();
    });

    it('PENDING_REVIEW when GHOST but AOC mismatch', async () => {
        let pendingInserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }]);
            if (table === 'shipowners') return {
                ...operatorReadStub({ id: 'op1', account_state: 'GHOST', aoc_number: 'DIFFERENT' }),
                insert: async () => { pendingInserted = true; return { error: null }; },
            };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(pendingInserted).toBe(true);
        expect(mockSupabase.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('PENDING_REVIEW when aircraft not found (cold signup)', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([]);
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('HARD REJECT (no insert) when operator already ACTIVE', async () => {
        const inserts: string[] = [];
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }]);
            if (table === 'shipowners') return {
                ...operatorReadStub({ id: 'op1', account_state: 'ACTIVE', aoc_number: 'SO-AOC-001' }),
                insert: async () => { inserts.push('shipowners'); return { error: null }; },
            };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(r.autoClaimedId).toBeUndefined();
        expect(inserts).not.toContain('shipowners');
    });

    it('PENDING_REVIEW when aircraft_ident is ambiguous (2 rows)', async () => {
        let inserted = false;
        mockSupabase.from.mockImplementation((table: string) => {
            if (table === 'aircraft') return aircraftStub([{ id: 'ac1', operator_id: 'op1' }, { id: 'ac2', operator_id: 'op2' }]);
            if (table === 'shipowners') return { insert: async () => { inserted = true; return { error: null }; } };
            return operatorReadStub(null);
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(true);
        expect(inserted).toBe(true);
    });

    it('rejects when air flag OFF (defense-in-depth, no DB writes)', async () => {
        const { readPortalFeatureFlags } = await import('@/lib/feature-flags');
        (readPortalFeatureFlags as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            portalV1Enabled: true, selfServiceEnabled: true, onlinePaymentStripeEnabled: true,
            walletTopupEnabled: true, notificationSmsEnabled: false, airSelfServiceEnabled: false,
        });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
        expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('rejects when rate limit hit', async () => {
        const { enforceRateLimit } = await import('@/lib/rateLimit');
        (enforceRateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false });
        const { registerAirOperator } = await import('./registerAirOperator');
        const r = await registerAirOperator(validInput, '127.0.0.1');
        expect(r.ok).toBe(false);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/actions/registerAirOperator.test.ts`
Expected: FAIL — `Cannot find module './registerAirOperator'`.

- [ ] **Step 3: Implement the action**

Create `frontend/src/actions/registerAirOperator.ts`:

```typescript
'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { createPlatformClient } from '@/lib/supabase/tenant';

const ALLOWED_LANGS = ['en', 'fr', 'ar', 'pt', 'sw'] as const;

const registerAirOperatorSchema = z.object({
    email: z.string().email().max(254),
    name: z.string().min(2).max(200),
    aoc_number: z.string().min(2).max(64),
    // registration (tail) or icao24 (Mode S hex). Alphanumerics + hyphen only —
    // also prevents PostgREST .or() filter injection.
    aircraft_ident: z.string().regex(/^[A-Za-z0-9-]{2,32}$/),
    country_code: z.string().length(2),
    address: z.string().min(5).max(500),
    proof_doc_storage_path: z.string().min(1),
    phone_e164: z.string().regex(/^\+\d{8,15}$/).optional(),
    preferred_language: z.enum(ALLOWED_LANGS),
    recaptcha_token: z.string().min(1),
});

type RegisterAirOperatorInput = z.infer<typeof registerAirOperatorSchema>;

interface RegisterAirOperatorResult {
    ok: boolean;
    /** Generic message for ALL non-auto-claim paths (anti-enumeration). */
    message: string;
    /** Only set on a successful AUTO-CLAIM. */
    autoClaimedId?: string;
}

const GENERIC_MESSAGE = 'Demande reçue. Vous recevrez un email sous 48h après validation.';

function normalizeAoc(v: string): string {
    return v.trim().toUpperCase();
}

async function verifyRecaptcha(token: string): Promise<boolean> {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
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

export async function registerAirOperator(
    input: RegisterAirOperatorInput,
    clientIp: string,
): Promise<RegisterAirOperatorResult> {
    const flags = await readPortalFeatureFlags();
    if (!flags.airSelfServiceEnabled) {
        return { ok: false, message: 'Self-service signup is not currently enabled.' };
    }

    const rl = await enforceRateLimit('signup-air-operator', clientIp);
    if (!rl.allowed) return { ok: false, message: 'Too many attempts. Try again later.' };

    const parsed = registerAirOperatorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Invalid input.' };
    const data = parsed.data;

    const captchaOk = await verifyRecaptcha(data.recaptcha_token);
    if (!captchaOk) return { ok: false, message: GENERIC_MESSAGE };

    // Anonymous signup — no tenant context. Sanctioned unscoped client; new
    // operator rows inherit Somaliland via the column DEFAULT (single-country).
    const supabase = createPlatformClient();

    // Match the aircraft by registration (as entered) or icao24 (lowercased hex).
    const v = data.aircraft_ident.trim();
    const { data: aircraftRows } = await supabase
        .from('aircraft')
        .select('id, operator_id')
        .or(`registration.eq.${v},icao24.eq.${v.toLowerCase()}`)
        .limit(2);

    const aircraft = aircraftRows && aircraftRows.length === 1
        ? (aircraftRows[0] as { id: string; operator_id: string | null })
        : null;

    if (aircraft?.operator_id) {
        const { data: operator } = await supabase
            .from('shipowners')
            .select('id, account_state, aoc_number')
            .eq('id', aircraft.operator_id)
            .single();

        if (operator?.account_state === 'GHOST'
            && operator.aoc_number
            && normalizeAoc(operator.aoc_number) === normalizeAoc(data.aoc_number)) {
            return await autoClaimAir(supabase, operator.id, data);
        }
        if (operator?.account_state === 'GHOST') {
            // GHOST but AOC mismatch — admin must verify.
            await insertPendingReviewAir(supabase, data);
            return { ok: true, message: GENERIC_MESSAGE };
        }
        // Non-GHOST (ACTIVE/INVITED/...) → no write (anti-takeover).
        return { ok: true, message: GENERIC_MESSAGE };
    }

    // No (or ambiguous) aircraft match → cold signup, admin review.
    await insertPendingReviewAir(supabase, data);
    return { ok: true, message: GENERIC_MESSAGE };
}

async function autoClaimAir(
    supabase: SupabaseClient,
    operatorId: string,
    data: RegisterAirOperatorInput,
): Promise<RegisterAirOperatorResult> {
    const { data: claimed, error: upErr } = await supabase
        .from('shipowners')
        .update({
            name: data.name,
            address: data.address,
            country_code: data.country_code,
            phone_e164: data.phone_e164 ?? null,
            preferred_language: data.preferred_language,
            proof_doc_url: data.proof_doc_storage_path,
            proof_doc_type: 'AOC',
            kyc_level_b_completed_at: new Date().toISOString(),
            account_state: 'ACTIVE',
        })
        .eq('id', operatorId)
        .eq('account_state', 'GHOST')           // race-safe: only flip if still GHOST
        .select('id');
    if (upErr) return { ok: false, message: GENERIC_MESSAGE };

    // Lost the race — another caller already claimed.
    if (!claimed || claimed.length === 0) {
        return { ok: true, message: GENERIC_MESSAGE };
    }

    const inviteResp = await supabase.auth.admin.inviteUserByEmail(
        data.email,
        { redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/owner/auth/callback` },
    );
    if (inviteResp.error) {
        await supabase.from('shipowners')
            .update({ account_state: 'GHOST' })
            .eq('id', operatorId)
            .eq('account_state', 'ACTIVE');
        return { ok: false, message: 'Email delivery failed. Try again later.' };
    }

    const newUser = inviteResp.data?.user;
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
            .eq('id', operatorId);
        await supabase.from('wallets').insert({ shipowner_id: operatorId });
        await supabase.from('audit_logs').insert({
            user_id: newUser.id,
            user_full_name: data.name,
            action: 'USER_CREATED',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: operatorId,
            details_json: { event: 'AIR_OPERATOR_AUTO_CLAIM', aoc_number: data.aoc_number },
        });
    }

    return { ok: true, message: GENERIC_MESSAGE, autoClaimedId: operatorId };
}

async function insertPendingReviewAir(
    supabase: SupabaseClient,
    data: RegisterAirOperatorInput,
): Promise<void> {
    await supabase.from('shipowners').insert({
        name: data.name,
        aoc_number: data.aoc_number,
        country_code: data.country_code,
        address: data.address,
        official_email: data.email,
        official_email_source: 'AGENT_CLAIM',
        phone_e164: data.phone_e164 ?? null,
        preferred_language: data.preferred_language,
        proof_doc_url: data.proof_doc_storage_path,
        proof_doc_type: 'AOC',
        kyc_level_b_completed_at: new Date().toISOString(),
        account_state: 'PENDING_REVIEW',
        applicable_modes: ['AIR'],
    });
    // No audit_log — anonymous user violates audit_logs.user_id NOT NULL (same as maritime).
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/actions/registerAirOperator.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/registerAirOperator.ts frontend/src/actions/registerAirOperator.test.ts
git commit -m "feat(wedge1): registerAirOperator action (AOC auto-claim, air self-service)"
```

---

## Task 5: API route `/api/auth/register-air-operator`

**Files:**
- Create: `frontend/src/app/api/auth/register-air-operator/route.ts`

- [ ] **Step 1: Implement the route (mirror register-shipowner)**

Create `frontend/src/app/api/auth/register-air-operator/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { registerAirOperator } from '@/actions/registerAirOperator';

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
    const result = await registerAirOperator(body as never, ip);
    const status = result.ok
        ? 200
        : (result.message.startsWith('Too many') ? 429 : 400);
    return NextResponse.json(result, { status });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/auth/register-air-operator/route.ts
git commit -m "feat(wedge1): POST /api/auth/register-air-operator route"
```

---

## Task 6: UI — mode selector + air form + page gate + i18n

**Files:**
- Create: `frontend/src/app/owner/register/AirRegisterForm.tsx`
- Create: `frontend/src/app/owner/register/RegisterModeSwitcher.tsx`
- Test: `frontend/src/app/owner/register/RegisterModeSwitcher.test.tsx`
- Modify: `frontend/src/app/owner/register/page.tsx`
- Modify: EN + FR message catalogs (locate with `grep -rl '"OwnerRegister"' frontend/`).

- [ ] **Step 1: Add i18n keys**

Find the catalogs: `grep -rl '"OwnerRegister"' frontend/`. In each (EN and FR), add an `AirRegister` namespace sibling to `OwnerRegister`. EN values:

```json
"AirRegister": {
  "title": "Air operator sign-up",
  "subtitle": "Claim your operator account with your AOC number and one of your aircraft.",
  "tab_maritime": "Maritime",
  "tab_air": "Air",
  "email": "Official email",
  "company_name": "Operating company name",
  "aoc_number": "AOC number",
  "aircraft_ident": "Aircraft registration or icao24",
  "country": "Country (ISO-2)",
  "address": "Registered address",
  "proof_document": "AOC certificate (PDF/image)",
  "phone_optional": "Phone (optional)",
  "preferred_language": "Preferred language",
  "submit": "Submit request",
  "submitting": "Submitting…",
  "thanks_title": "Request received",
  "errors": { "no_file": "Please attach your AOC certificate.", "upload_failed": "Upload failed, please retry." },
  "langs": { "en": "English", "fr": "Français", "ar": "العربية", "pt": "Português", "sw": "Kiswahili" }
}
```

FR values (same keys): title "Inscription opérateur aérien", subtitle "Réclamez votre compte opérateur avec votre numéro AOC et l'un de vos aéronefs.", tab_maritime "Maritime", tab_air "Aérien", email "Email officiel", company_name "Raison sociale de l'exploitant", aoc_number "Numéro AOC", aircraft_ident "Immatriculation ou code icao24", country "Pays (ISO-2)", address "Adresse du siège", proof_document "Certificat AOC (PDF/image)", phone_optional "Téléphone (optionnel)", preferred_language "Langue préférée", submit "Envoyer la demande", submitting "Envoi…", thanks_title "Demande reçue", errors.no_file "Veuillez joindre votre certificat AOC.", errors.upload_failed "Échec de l'envoi, réessayez.", langs (same labels).

- [ ] **Step 2: Write the failing render test**

Create `frontend/src/app/owner/register/RegisterModeSwitcher.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegisterModeSwitcher } from './RegisterModeSwitcher';

vi.mock('next-intl', () => ({
    useTranslations: () => (k: string) => k,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

describe('RegisterModeSwitcher', () => {
    it('shows both tabs when both modes enabled', () => {
        render(<RegisterModeSwitcher recaptchaSiteKey="" maritimeEnabled airEnabled />);
        expect(screen.getByRole('tab', { name: /tab_maritime/i })).toBeDefined();
        expect(screen.getByRole('tab', { name: /tab_air/i })).toBeDefined();
    });

    it('shows only the air form when only air enabled', () => {
        render(<RegisterModeSwitcher recaptchaSiteKey="" maritimeEnabled={false} airEnabled />);
        expect(screen.queryByRole('tab', { name: /tab_maritime/i })).toBeNull();
        // AOC field is unique to the air form
        expect(screen.getByText(/aoc_number/i)).toBeDefined();
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/app/owner/register/RegisterModeSwitcher.test.tsx`
Expected: FAIL — `Cannot find module './RegisterModeSwitcher'`.

- [ ] **Step 4: Implement `AirRegisterForm`**

Create `frontend/src/app/owner/register/AirRegisterForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OsInput } from '@/components/ui/OsInput';
import { createClient } from '@/lib/supabase/client';

interface Props {
    recaptchaSiteKey: string;
}

const LANGS = ['en', 'fr', 'ar', 'pt', 'sw'] as const;

export function AirRegisterForm({ recaptchaSiteKey }: Props) {
    const t = useTranslations('AirRegister');
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

        const token =
            recaptchaSiteKey && window.grecaptcha
                ? await window.grecaptcha.execute(recaptchaSiteKey, { action: 'register_air_operator' })
                : 'dev-skip';

        const body = {
            email: formData.get('email'),
            name: formData.get('name'),
            aoc_number: formData.get('aoc_number'),
            aircraft_ident: formData.get('aircraft_ident'),
            country_code: formData.get('country_code'),
            address: formData.get('address'),
            proof_doc_storage_path: path,
            phone_e164: formData.get('phone_e164') || undefined,
            preferred_language: formData.get('preferred_language'),
            recaptcha_token: token,
        };
        const res = await fetch('/api/auth/register-air-operator', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        setSubmitting(false);
        setResult({ ok: data.ok, message: data.message });
    }

    if (result?.ok) {
        return (
            <div className="os-card p-6 text-center">
                <h2 className="text-xl mb-2">{t('thanks_title')}</h2>
                <p>{result.message}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <OsInput name="email" label={t('email')} type="email" required />
            <OsInput name="name" label={t('company_name')} required />
            <OsInput name="aoc_number" label={t('aoc_number')} required />
            <OsInput name="aircraft_ident" label={t('aircraft_ident')} pattern="[A-Za-z0-9-]{2,32}" required />
            <OsInput name="country_code" label={t('country')} maxLength={2} required />
            <OsInput name="address" label={t('address')} required />
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {t('proof_document')}
                </label>
                <input
                    name="proof_doc"
                    type="file"
                    accept="application/pdf,image/*"
                    required
                    className="block w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors"
                />
            </div>
            <OsInput name="phone_e164" label={t('phone_optional')} placeholder="+2526..." />
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {t('preferred_language')}
                </label>
                <select
                    name="preferred_language"
                    required
                    defaultValue="en"
                    className="w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors appearance-none cursor-pointer"
                >
                    {LANGS.map((l) => (<option key={l} value={l}>{t(`langs.${l}`)}</option>))}
                </select>
            </div>
            {result && !result.ok && <div className="text-red-400 text-sm">{result.message}</div>}
            <button type="submit" disabled={submitting} className="os-button w-full disabled:opacity-50">
                {submitting ? t('submitting') : t('submit')}
            </button>
        </form>
    );
}
```

- [ ] **Step 5: Implement `RegisterModeSwitcher`**

Create `frontend/src/app/owner/register/RegisterModeSwitcher.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RegisterForm } from './RegisterForm';
import { AirRegisterForm } from './AirRegisterForm';

interface Props {
    recaptchaSiteKey: string;
    maritimeEnabled: boolean;
    airEnabled: boolean;
}

type Mode = 'MARITIME' | 'AIR';

export function RegisterModeSwitcher({ recaptchaSiteKey, maritimeEnabled, airEnabled }: Props) {
    const t = useTranslations('AirRegister');
    const [mode, setMode] = useState<Mode>(maritimeEnabled ? 'MARITIME' : 'AIR');
    const bothEnabled = maritimeEnabled && airEnabled;

    return (
        <div>
            {bothEnabled && (
                <div role="tablist" className="flex gap-2 mb-6">
                    <button
                        role="tab"
                        aria-selected={mode === 'MARITIME'}
                        onClick={() => setMode('MARITIME')}
                        className={`px-4 h-9 rounded-lg text-sm ${mode === 'MARITIME' ? 'os-button' : 'bg-[var(--os-surface-2)] border border-[var(--os-border)]'}`}
                    >
                        {t('tab_maritime')}
                    </button>
                    <button
                        role="tab"
                        aria-selected={mode === 'AIR'}
                        onClick={() => setMode('AIR')}
                        className={`px-4 h-9 rounded-lg text-sm ${mode === 'AIR' ? 'os-button' : 'bg-[var(--os-surface-2)] border border-[var(--os-border)]'}`}
                    >
                        {t('tab_air')}
                    </button>
                </div>
            )}
            {mode === 'MARITIME' && maritimeEnabled
                ? <RegisterForm recaptchaSiteKey={recaptchaSiteKey} />
                : <AirRegisterForm recaptchaSiteKey={recaptchaSiteKey} />}
        </div>
    );
}
```

- [ ] **Step 6: Wire the page to both flags**

Replace `frontend/src/app/owner/register/page.tsx` contents with:

```tsx
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { RegisterModeSwitcher } from './RegisterModeSwitcher';

export default async function OwnerRegisterPage() {
    const flags = await readPortalFeatureFlags();
    // Self-service is available if EITHER mode is enabled. When both are off,
    // bounce back to login (same behaviour as before).
    if (!flags.selfServiceEnabled && !flags.airSelfServiceEnabled) {
        redirect('/login?signup_disabled=1');
    }
    const t = await getTranslations('OwnerRegister');
    return (
        <div className="min-h-screen os-bg flex items-center justify-center p-6">
            <div className="os-card max-w-2xl w-full p-8">
                <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
                <p className="text-sm opacity-80 mb-6">{t('subtitle')}</p>
                <RegisterModeSwitcher
                    recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''}
                    maritimeEnabled={flags.selfServiceEnabled}
                    airEnabled={flags.airSelfServiceEnabled}
                />
            </div>
        </div>
    );
}
```

- [ ] **Step 7: Run the render test + typecheck**

Run: `cd frontend && npx vitest run src/app/owner/register/RegisterModeSwitcher.test.tsx && npx tsc --noEmit`
Expected: PASS (2 tests) + no type errors. If `@testing-library/jest-dom` matchers are needed, the repo already configures them in the vitest setup (used by existing component tests like ModeBadge.test.tsx) — follow that import style.

- [ ] **Step 8: Commit**

```bash
# Stage the register dir + the EN/FR catalog files you edited in Step 1
# (paths from `grep -rl '"OwnerRegister"' frontend/`).
git add frontend/src/app/owner/register/
git add <en-catalog> <fr-catalog>
git commit -m "feat(wedge1): air signup form + Maritime/Air mode selector on /owner/register"
```

---

## Task 7: Admin AOC pre-seed UI

**Files:**
- Modify: `frontend/src/services/shipownerService.ts:17-31`
- Modify: `frontend/src/app/(dashboard)/admin/owner-agent-mappings/ShipownersList.tsx`
- Modify: EN + FR catalogs — add `AdminMappings.aoc.*` keys.

- [ ] **Step 1: Add `aoc_number` to the list row + query**

In `frontend/src/services/shipownerService.ts`, extend the `ShipownerListRow` interface:
```typescript
export interface ShipownerListRow extends Shipowner {
  imo_company_no: string | null;
  invited_at: string | null;
  kyc_level_c_completed_at: string | null;
  aoc_number: string | null;
}
```
And add `aoc_number` to the `listShipowners` select string:
```typescript
    .select('id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at, aoc_number')
```

- [ ] **Step 2: Add i18n keys**

In each catalog, under the existing `AdminMappings` namespace add:
```json
"aoc": { "col": "AOC #", "set": "Set AOC", "dialogTitle": "Set AOC number", "dialogSubtitle": "Pre-seed the expected AOC for {name}. Self-service air sign-up matches this.", "placeholder": "SO-AOC-001", "save": "Save", "saving": "Saving…" }
```
FR: col "N° AOC", set "Définir AOC", dialogTitle "Définir le numéro AOC", dialogSubtitle "Pré-renseigner l'AOC attendu pour {name}. L'inscription aérienne self-service le compare.", placeholder "SO-AOC-001", save "Enregistrer", saving "Enregistrement…".

- [ ] **Step 3: Add the AOC column + dialog to `ShipownersList`**

In `frontend/src/app/(dashboard)/admin/owner-agent-mappings/ShipownersList.tsx`:

Add the import:
```typescript
import { setOperatorAocNumber } from '@/actions/setOperatorAocNumber';
```

Add AOC dialog state (next to the invite state):
```typescript
    const [aocTarget, setAocTarget] = React.useState<ShipownerListRow | null>(null);
    const [aoc, setAoc] = React.useState('');
    const [aocError, setAocError] = React.useState<string | null>(null);
    const [aocPending, startAocTransition] = React.useTransition();

    function openAoc(row: ShipownerListRow) {
        setAocTarget(row);
        setAoc(row.aoc_number ?? '');
        setAocError(null);
    }
    function closeAoc() { setAocTarget(null); setAoc(''); setAocError(null); }
    function submitAoc() {
        if (!aocTarget) return;
        setAocError(null);
        startAocTransition(async () => {
            const result = await setOperatorAocNumber({ operatorId: aocTarget.id, aocNumber: aoc });
            if (!result.ok) { setAocError(result.reason); return; }
            closeAoc();
            router.refresh();
        });
    }
```

Add an AOC column to the `columns` array (after the `imo` column):
```tsx
        {
            key: 'aoc',
            header: t('aoc.col'),
            render: (r) => <span className="font-mono text-xs">{r.aoc_number ?? '—'}</span>,
        },
```

In the `actions` column render, add a Set-AOC button alongside invite (replace the existing `actions` render body):
```tsx
            render: (r) =>
                canInvite ? (
                    <div className="flex justify-end gap-2">
                        <OsButton size="sm" variant="ghost" onClick={() => openAoc(r)}>
                            {t('aoc.set')}
                        </OsButton>
                        {r.account_state !== 'ACTIVE' && (
                            <OsButton size="sm" variant="primary" onClick={() => openInvite(r)}>
                                {r.account_state === 'INVITED' ? t('reinvite') : t('invite')}
                            </OsButton>
                        )}
                    </div>
                ) : null,
```

Add the AOC dialog after the invite `Dialog.Root` (before the closing `</>`):
```tsx
            <Dialog.Root open={aocTarget !== null} onOpenChange={(o) => !o && closeAoc()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('aoc.dialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('aoc.dialogSubtitle', { name: aocTarget?.name ?? '' })}
                        </Dialog.Description>
                        <OsInput
                            label={t('aoc.col')}
                            value={aoc}
                            onChange={(e) => setAoc(e.target.value)}
                            placeholder={t('aoc.placeholder')}
                            autoFocus
                            error={aocError ?? undefined}
                        />
                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeAoc} disabled={aocPending}>{t('cancel')}</OsButton>
                            <OsButton variant="primary" onClick={submitAoc} loading={aocPending} disabled={aocPending || aoc.length < 2}>
                                {aocPending ? t('aoc.saving') : t('aoc.save')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/\(dashboard\)/admin/owner-agent-mappings/ShipownersList.tsx src/services/shipownerService.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/shipownerService.ts "frontend/src/app/(dashboard)/admin/owner-agent-mappings/ShipownersList.tsx" frontend/messages/
git commit -m "feat(wedge1): admin AOC pre-seed (column + dialog) on operators list"
```

---

## Task 8: Final integration verification

**Files:** none (verification only).

- [ ] **Step 1: Full DB reset (migrations 001→079 + all pg tests)**

Run:
```bash
supabase db reset
for f in supabase/tests/migrations/*.test.sql; do echo "== $(basename "$f") =="; psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f "$f" || break; done
```
Expected: reset clean through 079; every test prints `… PASS`.

- [ ] **Step 2: Full frontend gates**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npx eslint`
Expected: all tests pass (prior 587 + the new air-onboarding tests), no type errors, eslint clean on the new/modified files.

- [ ] **Step 3: Production build**

Run: `cd frontend && npm run build`
Expected: build succeeds; route list includes `/api/auth/register-air-operator`.

- [ ] **Step 4: Commit any incidental fixes, then summarize**

```bash
git add -A && git commit -m "test(wedge1): W1-E air onboarding integration green" || echo "nothing to commit"
```

---

## Self-Review notes (for the executor)
- **Anti-takeover** depends on the AOC secret: never auto-claim on an aircraft match alone. The `autoClaimAir` path is reachable only when `account_state==='GHOST'` AND the normalized AOC matches.
- **Migration ordering:** 079 follows 078 (which lives on the `wedge1d` base). Do not renumber.
- **`approveShipownerRegistration` is reused unchanged** for air PENDING_REVIEW rows — do not fork it.
- **Secrets/data:** all DB work is local (`supabase db reset` touches only the local DB). Aviation tables do not yet exist on hosted (mig 068) — that is a separate deploy step, out of scope here.
- **Commits:** author is the repo git identity (`Loic Leclerc <leclerc@drwintech.com>`); never add an AI co-author or "Generated with" line (per CLAUDE.md).
