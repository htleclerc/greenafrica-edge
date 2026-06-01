# Plan 7C-2 — Owner-Facing PayDialog + Multi-Active Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the legacy single-active-provider lock so multiple payment providers can be active simultaneously, and ship the owner-facing `<PayDialog>` 3-step wizard that consumes Plan 7C-1's `initiatePayment` action — producing the first user-visible touchpoint of the v7 payments system.

**Architecture:** One Postgres migration (060) drops the partial unique index `payment_config_single_active` and adds `routes_rail TEXT[]` so each provider declares which v7 rails it can serve. The TS service layer gains `getActiveProviders()` (array) + `selectProvidersForRail(rail, currency)` (routing helper). The admin page swaps its radio for independent toggles. A new `<PayDialog>` (Radix Dialog, 3 steps) replaces the legacy `PayProformaDialog` at `/owner/(portal)/invoices` and calls `initiatePayment` with rail-specific `railDetails`. Existing `paymentIntentService` is **untouched** — it gets dropped in Plan 7C-5.

**Tech Stack:** PostgreSQL 17 / Supabase / Next.js 16 server components + actions / Zod / TypeScript strict / Vitest / Radix UI Dialog / next-intl (PascalCase namespaces). Reuses Plan 7C-1's `initiatePayment`, `applyWallet`, `paymentService` v7 typed reads.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §7.1.

**Predecessor:** Plan 7C-1 (PR #20). MUST be merged + migrations 057-059 pushed to hosted before this plan starts. `OWNER_RAILS` constant in `initiatePayment.ts` and the `payments` table RLS policies are direct dependencies.

**Successor:** Plan 7C-3 will give admins the symmetric `<RecordManualPaymentDialog>` for the 6 admin-initiable rails (CASH/CHEQUE/LC/NETTING/THIRD_PARTY/BANK_GUARANTEE). Plan 7C-5 drops `paymentIntentService.ts` + the legacy `PayProformaDialog` left in place during this plan as a fallback flag.

**Out of scope:**
- The provider sub-picker UI when multiple providers serve the same rail (v1 auto-picks the first by `display_order`; sub-picker deferred to a v1.1 if needed).
- Card-rail (`STRIPE`) flow — owner can't self-initiate STRIPE in `OWNER_RAILS`. The "pay by card now" button stays out of PayDialog and lands in Plan 7D.
- Dropping legacy `paymentIntentService` / `PayProformaDialog` files (Plan 7C-5).

---

## File Structure

### Files to create

```
supabase/migrations/
└── 060_payment_config_multi_active.sql        # drop unique idx + add routes_rail + seed

supabase/tests/migrations/
└── 060_payment_config_multi_active.test.sql

frontend/src/components/owner/PayDialog/
├── PayDialog.tsx                              # Root: Dialog shell + step state machine
├── StepRailPicker.tsx                         # Step 1: filtered rail cards
├── StepRailParams.tsx                         # Step 2: branched rail forms
├── StepConfirm.tsx                            # Step 3: summary + submit
├── usePayDialogContext.tsx                    # shared wizard context
├── PayDialog.test.tsx                         # vitest + RTL
└── index.ts                                   # re-exports
```

### Files to modify

```
frontend/src/services/paymentService.ts                                  # add getActiveProviders, selectProvidersForRail, setProviderActive
frontend/src/services/__tests__/paymentService.test.ts                   # extend coverage
frontend/src/app/api/admin/payment-config/route.ts                       # toggle 1-by-1 + bulk
frontend/src/components/dashboard/admin/PaymentProvidersPanel.tsx        # radio → independent toggles
frontend/src/app/owner/\(portal\)/invoices/page.tsx                       # PayProformaDialog → PayDialog
frontend/messages/en.json                                                # OwnerPortal.payDialog.*
frontend/messages/fr.json                                                # OwnerPortal.payDialog.*
```

### Test runners

```bash
# Postgres migration test
./supabase/tests/run.sh migrations/060_payment_config_multi_active.test.sql

# Frontend Vitest (single file)
NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321' \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o json | jq -r '.SERVICE_ROLE_KEY')" \
  npx vitest run src/components/owner/PayDialog/PayDialog.test.tsx

# Full gates
npx tsc --noEmit
npx vitest run
npx next build
```

---

## Task 1: Migration 060 — multi-active providers + rail routing

**Files:**
- Create: `supabase/migrations/060_payment_config_multi_active.sql`
- Create: `supabase/tests/migrations/060_payment_config_multi_active.test.sql`

This migration removes the DB-level single-active lock from mig 013 and gives each provider a typed declaration of which v7 rails it can serve. The `routes_rail` array uses TEXT (not the `payment_method` enum from mig 048) because providers may serve subsets of rails and the array is read in code, not joined to the enum.

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/060_payment_config_multi_active.test.sql`:

```sql
BEGIN;

-- 1. After mig 060, two providers MUST be allowed active simultaneously
UPDATE public.payment_config SET is_active = true WHERE provider = 'flutterwave';
UPDATE public.payment_config SET is_active = true WHERE provider = 'wire_transfer';

DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.payment_config WHERE is_active = true;
  ASSERT n = 2, format('expected 2 active providers, got %s', n);
END $$;

-- 2. routes_rail column exists and is seeded for every row
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM public.payment_config WHERE routes_rail IS NULL;
  ASSERT n = 0, format('expected all rows seeded with routes_rail, got %s nulls', n);
END $$;

-- 3. wire_transfer serves WIRE_TRANSFER rail
DO $$
DECLARE rails TEXT[];
BEGIN
  SELECT routes_rail INTO rails FROM public.payment_config WHERE provider = 'wire_transfer';
  ASSERT 'WIRE_TRANSFER' = ANY(rails), 'wire_transfer must route WIRE_TRANSFER';
END $$;

-- 4. wave serves MOBILE_MONEY only
DO $$
DECLARE rails TEXT[];
BEGIN
  SELECT routes_rail INTO rails FROM public.payment_config WHERE provider = 'wave';
  ASSERT rails = ARRAY['MOBILE_MONEY']::TEXT[], format('wave routes wrong: %s', rails);
END $$;

-- 5. The old unique index is gone
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'payment_config_single_active';
  ASSERT n = 0, 'payment_config_single_active must be dropped';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
./supabase/tests/run.sh migrations/060_payment_config_multi_active.test.sql
```

Expected: FAIL on assertion 1 (unique index still rejects 2nd active row) or assertion 2 (column missing).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/060_payment_config_multi_active.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 060: Multi-active providers + rail routing
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mig 013 added a partial unique index `payment_config_single_active` that
-- forbade more than one provider being is_active=true at the same time. Plan
-- 7C-2 lifts that lock: with v7 rails (mig 048), each provider serves a SUBSET
-- of rails, so multiple providers can coexist (e.g. Flutterwave for
-- MOBILE_MONEY in NGN/KES, Wave for MOBILE_MONEY in XOF, Wire for everything
-- else). Routing happens in TS via selectProvidersForRail(rail, currency).

-- 1. Drop the single-active invariant
DROP INDEX IF EXISTS public.payment_config_single_active;

-- 2. Declare which v7 rails each provider can serve
ALTER TABLE public.payment_config
    ADD COLUMN IF NOT EXISTS routes_rail TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.payment_config.routes_rail IS
    'Subset of payment_method enum values this provider can process. Read by paymentService.selectProvidersForRail().';

-- 3. Seed the rails per provider (idempotent — only sets if currently empty)
UPDATE public.payment_config SET routes_rail = ARRAY['STRIPE']::TEXT[]
    WHERE provider = 'stripe' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['STRIPE','MOBILE_MONEY']::TEXT[]
    WHERE provider = 'paystack' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['STRIPE','MOBILE_MONEY']::TEXT[]
    WHERE provider = 'flutterwave' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['MOBILE_MONEY']::TEXT[]
    WHERE provider = 'wave' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['THIRD_PARTY']::TEXT[]
    WHERE provider = 'payoneer' AND cardinality(routes_rail) = 0;

UPDATE public.payment_config SET routes_rail = ARRAY['WIRE_TRANSFER']::TEXT[]
    WHERE provider = 'wire_transfer' AND cardinality(routes_rail) = 0;
```

- [ ] **Step 4: Re-run the test to verify it passes**

```bash
./supabase/tests/run.sh migrations/060_payment_config_multi_active.test.sql
```

Expected: PASS — all 5 assertions green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/060_payment_config_multi_active.sql \
        supabase/tests/migrations/060_payment_config_multi_active.test.sql
git commit -m "feat(7c-2): mig 060 — multi-active providers + rail routing

- Drop payment_config_single_active partial unique index from mig 013
- Add routes_rail TEXT[] column declaring which v7 rails each provider serves
- Seed routes_rail for the 6 existing providers (stripe/paystack/flutterwave/
  wave/payoneer/wire_transfer)
- Migration test asserts (a) two providers can be active simultaneously,
  (b) routes_rail is non-null for all rows, (c) seed values match expected,
  (d) the old unique index is gone."
```

---

## Task 2: Service layer — multi-active reads + rail routing

**Files:**
- Modify: `frontend/src/services/paymentService.ts:355-419`
- Modify: `frontend/src/services/__tests__/paymentService.test.ts`

Replace the singular `getActiveProvider` and `setActiveProvider` with array-aware helpers. Keep the legacy functions for one release as deprecated re-exports so `createPaymentRequest` (still used by legacy `paymentIntentService`) doesn't break before Plan 7C-5 cutover.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/services/__tests__/paymentService.test.ts` (append after the existing `getActiveProvider` describe block):

```typescript
import {
    getActiveProviders,
    selectProvidersForRail,
    setProviderActive,
} from '../paymentService';

function makeMultiClient(rows: Array<{ provider: string; is_active: boolean; routes_rail: string[]; display_order: number }>) {
    return {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
            })),
            update: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
        })),
    } as unknown as SupabaseClient;
}

describe('getActiveProviders', () => {
    it('returns all active rows ordered by display_order', async () => {
        const client = makeMultiClient([
            { provider: 'wire_transfer', is_active: true, routes_rail: ['WIRE_TRANSFER'], display_order: 5 },
            { provider: 'flutterwave',   is_active: true, routes_rail: ['STRIPE','MOBILE_MONEY'], display_order: 3 },
        ]);
        const list = await getActiveProviders(client);
        expect(list.map((p) => p.provider)).toEqual(['wire_transfer', 'flutterwave']);
    });

    it('returns empty array when no provider active', async () => {
        const client = makeMultiClient([]);
        expect(await getActiveProviders(client)).toEqual([]);
    });
});

describe('selectProvidersForRail', () => {
    it('returns providers whose routes_rail contains the rail', async () => {
        const client = makeMultiClient([
            { provider: 'wave',          is_active: true, routes_rail: ['MOBILE_MONEY'],            display_order: 4 },
            { provider: 'flutterwave',   is_active: true, routes_rail: ['STRIPE','MOBILE_MONEY'],   display_order: 3 },
            { provider: 'wire_transfer', is_active: true, routes_rail: ['WIRE_TRANSFER'],           display_order: 5 },
        ]);
        const result = await selectProvidersForRail(client, 'MOBILE_MONEY');
        expect(result.map((p) => p.provider)).toEqual(['flutterwave', 'wave']); // ordered by display_order asc
    });

    it('returns empty when no active provider serves the rail', async () => {
        const client = makeMultiClient([
            { provider: 'wire_transfer', is_active: true, routes_rail: ['WIRE_TRANSFER'], display_order: 5 },
        ]);
        expect(await selectProvidersForRail(client, 'NETTING')).toEqual([]);
    });
});

describe('setProviderActive', () => {
    it('sends update with is_active=true to the matching provider only', async () => {
        const update = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
        const client = { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient;
        await setProviderActive(client, 'flutterwave', true);
        expect(update).toHaveBeenCalledWith({ is_active: true });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/services/__tests__/paymentService.test.ts
```

Expected: FAIL — `getActiveProviders`, `selectProvidersForRail`, `setProviderActive` are not exported.

- [ ] **Step 3: Implement the new helpers**

Edit `frontend/src/services/paymentService.ts`. After the existing `setActiveProvider` function (line 419), append:

```typescript
// ── Plan 7C-2: Multi-active provider routing ───────────────────────────────

/**
 * Active provider row enriched with rail routing metadata.
 */
export interface ActiveProviderRow {
    provider: PaymentProvider;
    routes_rail: string[];
    display_order: number;
}

/**
 * Get ALL currently-active providers, ordered by display_order.
 * Plan 7C-2: replaces the single-active getActiveProvider() for new callers.
 * Legacy getActiveProvider() kept for the v0 paymentIntentService path until
 * Plan 7C-5 cutover.
 */
export async function getActiveProviders(client: SupabaseClient): Promise<ActiveProviderRow[]> {
    const { data, error } = await client
        .from('payment_config')
        .select('provider, routes_rail, display_order, is_active')
        .order('display_order');
    if (error) return [];
    return (data ?? [])
        .filter((r: { is_active: boolean }) => r.is_active)
        .map((r) => ({
            provider: r.provider as PaymentProvider,
            routes_rail: r.routes_rail ?? [],
            display_order: r.display_order ?? 0,
        }));
}

/**
 * Filter active providers to those declaring support for a given v7 rail.
 * Result is ordered by display_order ascending — the first element is the
 * default routing pick. Caller may surface alternatives in a sub-picker.
 *
 * @param rail - v7 payment_method enum value (STRIPE, WIRE_TRANSFER, …)
 */
export async function selectProvidersForRail(
    client: SupabaseClient,
    rail: string,
): Promise<ActiveProviderRow[]> {
    const all = await getActiveProviders(client);
    return all.filter((p) => p.routes_rail.includes(rail));
}

/**
 * Toggle a single provider's is_active flag. Replaces the old
 * setActiveProvider() semantics where activating one deactivated all others.
 */
export async function setProviderActive(
    client: SupabaseClient,
    provider: PaymentProvider,
    isActive: boolean,
): Promise<boolean> {
    const { error } = await client
        .from('payment_config')
        .update({ is_active: isActive })
        .eq('provider', provider);
    return !error;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/services/__tests__/paymentService.test.ts
```

Expected: PASS — all new tests green; existing `getActiveProvider`/`setActiveProvider` tests still pass (we did NOT remove them).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/paymentService.ts \
        frontend/src/services/__tests__/paymentService.test.ts
git commit -m "feat(7c-2): paymentService — getActiveProviders + selectProvidersForRail

- Add ActiveProviderRow type + getActiveProviders() returning all is_active rows
- Add selectProvidersForRail(rail) for rail→provider routing
- Add setProviderActive(provider, isActive) for independent toggles
- Legacy getActiveProvider/setActiveProvider preserved for paymentIntentService
  until Plan 7C-5 cutover.
- 6 new unit tests covering ordering, empty results, rail filtering."
```

---

## Task 3: API — toggle endpoint accepts `{ provider, isActive }`

**Files:**
- Modify: `frontend/src/app/api/admin/payment-config/route.ts`

Backwards-compatible: keep the legacy `{ activeProvider }` body shape working (it now means "activate this one, deactivate all others — emulate the old behavior") and add the new `{ provider, isActive }` shape for independent toggles.

- [ ] **Step 1: Replace the file with the dual-shape handler**

Overwrite `frontend/src/app/api/admin/payment-config/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
    getAllProviderConfigs,
    setActiveProvider,
    setProviderActive,
} from '@/services/paymentService';
import type { PaymentProvider } from '@/services/paymentService';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];
const PROVIDER_ENUM = ['stripe', 'paystack', 'flutterwave', 'wave', 'payoneer', 'wire_transfer'] as const;

/**
 * GET /api/admin/payment-config
 * Returns all payment provider configurations for the settings page.
 */
export async function GET() {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    try {
        const configs = await getAllProviderConfigs(auth.supabase);
        return NextResponse.json({ providers: configs });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// Two accepted body shapes:
//   1. Legacy: { activeProvider: <enum> }            → exclusive activation
//   2. Plan 7C-2: { provider: <enum>, isActive: bool } → independent toggle
const legacyBody = z.object({ activeProvider: z.enum(PROVIDER_ENUM) });
const toggleBody = z.object({ provider: z.enum(PROVIDER_ENUM), isActive: z.boolean() });

/**
 * PUT /api/admin/payment-config
 */
export async function PUT(request: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const toggle = toggleBody.safeParse(body);
    if (toggle.success) {
        const ok = await setProviderActive(
            auth.supabase,
            toggle.data.provider as PaymentProvider,
            toggle.data.isActive,
        );
        if (!ok) return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
        return NextResponse.json({ success: true, provider: toggle.data.provider, isActive: toggle.data.isActive });
    }

    const legacy = legacyBody.safeParse(body);
    if (legacy.success) {
        const ok = await setActiveProvider(auth.supabase, legacy.data.activeProvider as PaymentProvider);
        if (!ok) return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
        return NextResponse.json({ success: true, activeProvider: legacy.data.activeProvider });
    }

    return NextResponse.json({ error: 'Invalid body — expected { activeProvider } or { provider, isActive }' }, { status: 400 });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors in `route.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/admin/payment-config/route.ts
git commit -m "feat(7c-2): payment-config API accepts {provider,isActive} toggle

Dual-shape body: legacy {activeProvider} kept for backward compat (used by
e2e and any in-flight UI on a different branch); new {provider, isActive}
toggles a single row independently."
```

---

## Task 4: Admin UI — radio → independent toggles

**Files:**
- Modify: `frontend/src/components/dashboard/admin/PaymentProvidersPanel.tsx`

Replace the radio (`selectedActive: ProviderKey | null`) with per-provider toggle state. Show `routes_rail` as a small badge row so admins see which rails each provider serves.

- [ ] **Step 1: Rewrite the component state + handlers**

Overwrite `frontend/src/components/dashboard/admin/PaymentProvidersPanel.tsx`:

```tsx
'use client';

import * as React from 'react';
import {
    CheckCircle2, AlertTriangle, RefreshCw, Lock, Eye,
    CreditCard, Building2, Globe, Smartphone, Banknote, Shield, Briefcase,
} from 'lucide-react';
import { useRole } from '@/lib/RoleContext';
import { canEdit } from '@/lib/rbac';

type ProviderKey = 'stripe' | 'paystack' | 'flutterwave' | 'wave' | 'payoneer' | 'wire_transfer';

interface ProviderConfig {
    provider: ProviderKey;
    displayName: string;
    enabled: boolean;
    isDefault: boolean;
    supportedCurrencies: string[];
    testMode: boolean;
    routesRail?: string[];
}

interface ProviderMetaUI {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    description: string;
    coverage: string;
}

const PROVIDER_META: Record<ProviderKey, ProviderMetaUI> = {
    stripe:        { icon: CreditCard, color: '#635BFF', description: 'International cards + SEPA bank transfers', coverage: 'Worldwide · USD/EUR/GBP' },
    paystack:      { icon: Building2, color: '#0BA4DB', description: 'African cards + bank + mobile money', coverage: 'Africa · NGN/GHS/KES/USD' },
    flutterwave:   { icon: Globe, color: '#F5A623', description: 'Pan-African payment gateway', coverage: 'Africa + EU + US · multi-currency' },
    wave:          { icon: Smartphone, color: '#1DC9B7', description: 'Mobile money for West/East Africa', coverage: 'XOF / SOS · mobile money' },
    payoneer:      { icon: Briefcase, color: '#FF4800', description: 'B2B cross-border payments — global enterprise', coverage: 'Worldwide · USD / EUR / GBP' },
    wire_transfer: { icon: Banknote, color: '#10B981', description: 'SWIFT bank wire — manual confirmation', coverage: 'Worldwide · all currencies · always available' },
};

export function PaymentProvidersPanel() {
    const { role } = useRole();
    const isReadOnly = !canEdit('tax-settings', role);

    const [providers, setProviders] = React.useState<ProviderConfig[]>([]);
    const [loading, setLoading]     = React.useState(true);
    const [error, setError]         = React.useState<string | null>(null);
    const [busyProvider, setBusyProvider] = React.useState<ProviderKey | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await fetch('/api/admin/payment-config');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setProviders(data.providers ?? []);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    async function toggleProvider(provider: ProviderKey, isActive: boolean) {
        if (isReadOnly) return;
        setBusyProvider(provider); setError(null);
        try {
            const res = await fetch('/api/admin/payment-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, isActive }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            // Optimistic update
            setProviders((list) => list.map((p) => p.provider === provider ? { ...p, isDefault: isActive } : p));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Toggle failed');
        } finally {
            setBusyProvider(null);
        }
    }

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h1 className="text-xl font-bold text-[var(--os-text-primary)]">Payment Providers</h1>
                        {isReadOnly && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[rgba(56,189,248,0.1)] text-[#38BDF8] border border-[#38BDF8]/20">
                                <Eye className="w-3 h-3" /> READ-ONLY
                            </span>
                        )}
                    </div>
                    <p className="text-xs text-[var(--os-text-muted)]">
                        Activate one or more providers. New payments are routed by rail; the first active provider serving the chosen rail (by display order) handles the request.
                    </p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                    <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
            )}

            {loading && (
                <div className="os-card p-8 flex items-center justify-center">
                    <div className="flex items-center gap-2 text-[var(--os-text-muted)]">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Loading providers…</span>
                    </div>
                </div>
            )}

            {!loading && providers.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {providers.map((p) => {
                        const meta = PROVIDER_META[p.provider];
                        const Icon = meta.icon;
                        const isActive = p.isDefault;
                        const isBusy = busyProvider === p.provider;

                        return (
                            <div
                                key={p.provider}
                                className="os-card p-5 transition-all"
                                style={{
                                    borderColor: isActive ? `${meta.color}50` : 'var(--os-border)',
                                    backgroundColor: isActive ? `${meta.color}08` : undefined,
                                }}
                            >
                                <div className="flex items-start gap-3 mb-3">
                                    <div
                                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                                    >
                                        <Icon className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="text-sm font-bold text-[var(--os-text-primary)]">{p.displayName}</h3>
                                            {isActive && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-widest bg-[rgba(16,185,129,0.12)] text-[#10B981] border border-[#10B981]/20">ACTIVE</span>
                                            )}
                                            {p.testMode && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-widest bg-[rgba(234,179,8,0.12)] text-[#EAB308] border border-[#EAB308]/20">TEST MODE</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5">{meta.description}</p>
                                    </div>
                                </div>

                                <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)]">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-0.5">Coverage</p>
                                    <p className="text-xs text-[var(--os-text-primary)]">{meta.coverage}</p>
                                </div>

                                {p.routesRail && p.routesRail.length > 0 && (
                                    <div className="mb-3">
                                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">Rails Served</p>
                                        <div className="flex flex-wrap gap-1">
                                            {p.routesRail.map((r) => (
                                                <span key={r} className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[rgba(16,185,129,0.08)] border border-[#10B981]/20 text-[#10B981]">{r}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="mb-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">Supported Currencies</p>
                                    <div className="flex flex-wrap gap-1">
                                        {p.supportedCurrencies.map((c) => (
                                            <span key={c} className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-secondary)]">{c}</span>
                                        ))}
                                    </div>
                                </div>

                                <div className="mb-4 flex items-center gap-2 text-[11px]">
                                    {p.enabled ? (
                                        <>
                                            <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981]" />
                                            <span className="text-[#10B981] font-semibold">API keys configured</span>
                                        </>
                                    ) : (
                                        <>
                                            <Lock className="w-3.5 h-3.5 text-[#94A3B8]" />
                                            <span className="text-[var(--os-text-muted)]">
                                                {p.provider === 'wire_transfer' ? 'No API key required' : 'Add API key to .env to enable'}
                                            </span>
                                        </>
                                    )}
                                </div>

                                <button
                                    onClick={() => toggleProvider(p.provider, !isActive)}
                                    disabled={isReadOnly || !p.enabled || isBusy}
                                    className="w-full flex items-center justify-between p-3 rounded-xl border transition-all disabled:cursor-not-allowed disabled:opacity-50"
                                    style={{
                                        borderColor: isActive ? meta.color : 'var(--os-border)',
                                        backgroundColor: isActive ? `${meta.color}10` : 'var(--os-surface-2)',
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-9 h-5 rounded-full relative transition-colors"
                                            style={{ backgroundColor: isActive ? meta.color : 'var(--os-border-strong)' }}
                                        >
                                            <div
                                                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
                                                style={{ left: isActive ? 'calc(100% - 18px)' : '2px' }}
                                            />
                                        </div>
                                        <span
                                            className="text-xs font-semibold"
                                            style={{ color: isActive ? meta.color : 'var(--os-text-primary)' }}
                                        >
                                            {isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    {isBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin text-[var(--os-text-muted)]" />}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="os-card p-4 flex items-start gap-3">
                <Shield className="w-4 h-4 text-[#10B981] flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">
                    <p className="mb-1">
                        <strong className="text-[var(--os-text-primary)]">How this works:</strong> Multiple providers can be active at once. The system routes new payments by <em>rail</em> — for example, a MOBILE_MONEY payment in NGN goes to the first active provider whose <code className="text-[#10B981]">routes_rail</code> includes <code>MOBILE_MONEY</code> and supports NGN.
                    </p>
                    <p className="mb-1">
                        <strong className="text-[var(--os-text-primary)]">API keys:</strong> Provider keys live in <code className="text-[#10B981]">.env.local</code> and Vercel environment variables. They are never exposed to the browser.
                    </p>
                    <p>
                        <strong className="text-[var(--os-text-primary)]">Webhooks:</strong> Each provider must POST events to <code className="text-[#10B981]">/api/webhooks/payment</code> with the appropriate signature header.
                    </p>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Update `getAllProviderConfigs` to surface `routes_rail`**

Edit `frontend/src/services/paymentService.ts:375-395`. Replace the existing function body:

```typescript
export async function getAllProviderConfigs(client: SupabaseClient): Promise<PaymentProviderConfig[]> {
    const { data: dbConfigs } = await client
        .from('payment_config')
        .select('*')
        .order('display_order');

    return Object.entries(PROVIDERS).map(([key, meta]) => {
        const dbRow = dbConfigs?.find((c: { provider: string }) => c.provider === key);
        return {
            provider: key as PaymentProvider,
            displayName: meta.displayName,
            enabled: dbRow?.is_enabled ?? (key === 'wire_transfer'),
            isDefault: dbRow?.is_active ?? (key === 'wire_transfer'),
            supportedCurrencies: meta.currencies,
            testMode: dbRow?.test_mode ?? false,
            routesRail: (dbRow?.routes_rail as string[] | undefined) ?? [],
        };
    });
}
```

Then update the `PaymentProviderConfig` type declaration earlier in the file (search for `export interface PaymentProviderConfig`) to add:

```typescript
    routesRail?: string[];
```

- [ ] **Step 3: Type-check + visual verify**

```bash
npx tsc --noEmit
npm run dev
```

Open http://localhost:3300/admin/tax-settings (Payment Providers tab), confirm:
- Each card shows a "Rails Served" badge row
- Toggle switches operate independently
- Activating two providers sticks (no error toast)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/admin/PaymentProvidersPanel.tsx \
        frontend/src/services/paymentService.ts
git commit -m "feat(7c-2): admin UI — independent provider toggles + rails served

PaymentProvidersPanel switches from a radio (single-active) to per-card
toggle. Each card shows the routes_rail array as green badges. Toggling
posts {provider, isActive} to the new API shape; UI updates optimistically.
getAllProviderConfigs now surfaces routes_rail to the client."
```

---

## Task 5: PayDialog scaffold + wizard context

**Files:**
- Create: `frontend/src/components/owner/PayDialog/usePayDialogContext.tsx`
- Create: `frontend/src/components/owner/PayDialog/PayDialog.tsx`
- Create: `frontend/src/components/owner/PayDialog/index.ts`

The wizard has three steps. Shared state lives in a React context so each step can read/write without prop drilling.

- [ ] **Step 1: Create the context**

Create `frontend/src/components/owner/PayDialog/usePayDialogContext.tsx`:

```tsx
'use client';

import * as React from 'react';

export type Step = 'rail' | 'params' | 'confirm';
export type Rail = 'WIRE_TRANSFER' | 'MOBILE_MONEY' | 'THIRD_PARTY' | 'WALLET';

export interface PayDialogState {
    step: Step;
    rail: Rail | null;
    railDetails: Record<string, unknown>;
    chosenProvider: string | null;
    submitting: boolean;
    error: string | null;
}

export interface PayDialogContextValue extends PayDialogState {
    transactionId: string;
    invoiceRef: string;
    amountUsd: number;
    currency: string;
    walletBalanceUsdMinor: number;
    setStep: (step: Step) => void;
    setRail: (rail: Rail | null) => void;
    setRailDetails: (d: Record<string, unknown>) => void;
    setChosenProvider: (p: string | null) => void;
    setSubmitting: (b: boolean) => void;
    setError: (e: string | null) => void;
    reset: () => void;
}

const Ctx = React.createContext<PayDialogContextValue | null>(null);

export function PayDialogProvider(
    props: React.PropsWithChildren<{
        transactionId: string;
        invoiceRef: string;
        amountUsd: number;
        currency: string;
        walletBalanceUsdMinor: number;
    }>,
) {
    const [step, setStep] = React.useState<Step>('rail');
    const [rail, setRail] = React.useState<Rail | null>(null);
    const [railDetails, setRailDetails] = React.useState<Record<string, unknown>>({});
    const [chosenProvider, setChosenProvider] = React.useState<string | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const reset = React.useCallback(() => {
        setStep('rail');
        setRail(null);
        setRailDetails({});
        setChosenProvider(null);
        setSubmitting(false);
        setError(null);
    }, []);

    const value: PayDialogContextValue = {
        step, rail, railDetails, chosenProvider, submitting, error,
        transactionId: props.transactionId,
        invoiceRef: props.invoiceRef,
        amountUsd: props.amountUsd,
        currency: props.currency,
        walletBalanceUsdMinor: props.walletBalanceUsdMinor,
        setStep, setRail, setRailDetails, setChosenProvider, setSubmitting, setError, reset,
    };

    return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function usePayDialog(): PayDialogContextValue {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('usePayDialog must be used inside PayDialogProvider');
    return v;
}
```

- [ ] **Step 2: Create the dialog shell**

Create `frontend/src/components/owner/PayDialog/PayDialog.tsx`:

```tsx
'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { PayDialogProvider, usePayDialog } from './usePayDialogContext';
import { StepRailPicker } from './StepRailPicker';
import { StepRailParams } from './StepRailParams';
import { StepConfirm } from './StepConfirm';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    transactionId: string;
    invoiceRef: string;
    amountUsd: number;
    currency: string;
    walletBalanceUsdMinor: number;
}

function StepIndicator() {
    const { step } = usePayDialog();
    const steps: Array<{ key: typeof step; label: string }> = [
        { key: 'rail', label: '1' },
        { key: 'params', label: '2' },
        { key: 'confirm', label: '3' },
    ];
    return (
        <div className="flex items-center gap-1.5 mb-3">
            {steps.map((s, i) => {
                const active = s.key === step;
                const done = steps.findIndex((x) => x.key === step) > i;
                return (
                    <React.Fragment key={s.key}>
                        <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                            style={{
                                backgroundColor: active ? '#10B981' : done ? '#10B98155' : 'var(--os-surface-2)',
                                color: active || done ? 'white' : 'var(--os-text-muted)',
                                border: '1px solid var(--os-border)',
                            }}
                        >
                            {s.label}
                        </div>
                        {i < steps.length - 1 && <div className="flex-1 h-px bg-[var(--os-border)]" />}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function PayDialogBody({ onClose }: { onClose: () => void }) {
    const { step } = usePayDialog();
    const t = useTranslations('OwnerPortal.payDialog');
    return (
        <>
            <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                {t('title')}
            </Dialog.Title>
            <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-4">
                {t('subtitle')}
            </Dialog.Description>
            <StepIndicator />
            {step === 'rail'    && <StepRailPicker />}
            {step === 'params'  && <StepRailParams />}
            {step === 'confirm' && <StepConfirm onClose={onClose} />}
        </>
    );
}

export function PayDialog(props: Props) {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
                />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                    }}
                >
                    <PayDialogProvider
                        transactionId={props.transactionId}
                        invoiceRef={props.invoiceRef}
                        amountUsd={props.amountUsd}
                        currency={props.currency}
                        walletBalanceUsdMinor={props.walletBalanceUsdMinor}
                    >
                        <PayDialogBody onClose={() => props.onOpenChange(false)} />
                    </PayDialogProvider>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
```

- [ ] **Step 3: Create the index**

Create `frontend/src/components/owner/PayDialog/index.ts`:

```typescript
export { PayDialog } from './PayDialog';
```

- [ ] **Step 4: Type-check (Steps 6-8 will fill the missing imports)**

```bash
npx tsc --noEmit
```

Expected: errors only for the 3 not-yet-created step files (`StepRailPicker`, `StepRailParams`, `StepConfirm`). That's fine — Tasks 6-8 fix them.

- [ ] **Step 5: Commit (allow tsc to fail temporarily — staged commit)**

```bash
git add frontend/src/components/owner/PayDialog/
git commit -m "feat(7c-2): PayDialog scaffold — Radix shell + wizard context

3-step wizard (rail / params / confirm). Step indicator + shared context
via usePayDialog. Step components imported but not yet implemented; tsc
will fail until Tasks 6-8 land them. Commit allows incremental progress."
```

---

## Task 6: Step 1 — rail picker (filtered by currency + admin-enabled)

**Files:**
- Create: `frontend/src/components/owner/PayDialog/StepRailPicker.tsx`

The picker shows only the rails the owner can self-initiate (`OWNER_RAILS` in `initiatePayment.ts`: WIRE_TRANSFER, MOBILE_MONEY, THIRD_PARTY, WALLET) AND that have at least one active provider serving them in the chosen currency. WALLET is special: shown only if the shipowner's wallet balance is positive.

- [ ] **Step 1: Create the rail picker**

Create `frontend/src/components/owner/PayDialog/StepRailPicker.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Banknote, Smartphone, Briefcase, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { usePayDialog, type Rail } from './usePayDialogContext';

interface RailEligibility {
    rail: Rail;
    eligible: boolean;
    providers: Array<{ provider: string; routes_rail: string[]; display_order: number }>;
    reason?: string;
}

interface AvailabilityResponse {
    rails: RailEligibility[];
}

const RAIL_META: Record<Rail, { icon: React.ComponentType<{ className?: string }>; color: string; key: string }> = {
    WIRE_TRANSFER: { icon: Banknote,   color: '#10B981', key: 'wire' },
    MOBILE_MONEY:  { icon: Smartphone, color: '#1DC9B7', key: 'momo' },
    THIRD_PARTY:   { icon: Briefcase,  color: '#FF4800', key: 'third' },
    WALLET:        { icon: Wallet,     color: '#8B5CF6', key: 'wallet' },
};

export function StepRailPicker() {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const [loading, setLoading] = React.useState(true);
    const [rails, setRails] = React.useState<RailEligibility[]>([]);
    const [fetchError, setFetchError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setFetchError(null);
            try {
                const url = new URL('/api/owner/payment-availability', window.location.origin);
                url.searchParams.set('currency', ctx.currency);
                url.searchParams.set('walletBalanceUsdMinor', String(ctx.walletBalanceUsdMinor));
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data: AvailabilityResponse = await res.json();
                if (!cancelled) setRails(data.rails);
            } catch (e) {
                if (!cancelled) setFetchError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [ctx.currency, ctx.walletBalanceUsdMinor]);

    function pickRail(r: RailEligibility) {
        ctx.setRail(r.rail);
        ctx.setChosenProvider(r.providers[0]?.provider ?? null);
        ctx.setStep('params');
    }

    if (loading) {
        return <p className="text-xs text-[var(--os-text-muted)] py-4">{t('loadingRails')}</p>;
    }
    if (fetchError) {
        return <p className="text-xs text-[#EF4444] py-4">{fetchError}</p>;
    }

    return (
        <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--os-text-muted)] mb-1">
                {t('chooseRail', { currency: ctx.currency })}
            </p>
            {rails.map((r) => {
                const meta = RAIL_META[r.rail];
                const Icon = meta.icon;
                return (
                    <button
                        key={r.rail}
                        onClick={() => r.eligible && pickRail(r)}
                        disabled={!r.eligible}
                        className="flex items-center gap-3 p-3 rounded-xl border transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-[var(--os-surface-3)]"
                        style={{ borderColor: 'var(--os-border)', backgroundColor: 'var(--os-surface-2)' }}
                    >
                        <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                        >
                            <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[var(--os-text-primary)]">{t(`rail.${meta.key}.label`)}</p>
                            <p className="text-[11px] text-[var(--os-text-muted)] mt-0.5">
                                {r.eligible
                                    ? t(`rail.${meta.key}.hint`, { provider: r.providers[0]?.provider ?? '' })
                                    : (r.reason ?? t('railNotAvailable'))}
                            </p>
                        </div>
                    </button>
                );
            })}
            {rails.every((r) => !r.eligible) && (
                <p className="text-xs text-[#EAB308] mt-2">{t('noRailEligible')}</p>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Create the availability API**

Create `frontend/src/app/api/owner/payment-availability/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { selectProvidersForRail } from '@/services/paymentService';

const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
type Rail = typeof OWNER_RAILS[number];

interface RailEligibility {
    rail: Rail;
    eligible: boolean;
    providers: Array<{ provider: string; routes_rail: string[]; display_order: number }>;
    reason?: string;
}

export async function GET(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const walletBalanceUsdMinor = Number(url.searchParams.get('walletBalanceUsdMinor') ?? '0');

    const rails: RailEligibility[] = [];
    for (const rail of OWNER_RAILS) {
        if (rail === 'WALLET') {
            rails.push({
                rail,
                eligible: walletBalanceUsdMinor > 0,
                providers: [],
                reason: walletBalanceUsdMinor > 0 ? undefined : 'wallet_empty',
            });
            continue;
        }
        const providers = await selectProvidersForRail(supabase, rail);
        rails.push({
            rail,
            eligible: providers.length > 0,
            providers,
            reason: providers.length === 0 ? 'no_active_provider' : undefined,
        });
    }

    return NextResponse.json({ rails });
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: still errors for `StepRailParams` + `StepConfirm` only.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/owner/PayDialog/StepRailPicker.tsx \
        frontend/src/app/api/owner/payment-availability/route.ts
git commit -m "feat(7c-2): PayDialog Step 1 — rail picker + availability API

StepRailPicker fetches /api/owner/payment-availability which evaluates
each OWNER_RAIL: WIRE_TRANSFER/MOBILE_MONEY/THIRD_PARTY need an active
provider serving that rail; WALLET needs a positive balance. Disabled
rails show a localized reason."
```

---

## Task 7: Step 2 — rail-specific params form

**Files:**
- Create: `frontend/src/components/owner/PayDialog/StepRailParams.tsx`

Each rail collects different fields. We branch on `ctx.rail` and write everything into `ctx.railDetails` so Step 3 can submit it as the `railDetails` JSONB to `initiatePayment`.

- [ ] **Step 1: Create the params form**

Create `frontend/src/components/owner/PayDialog/StepRailParams.tsx`:

```tsx
'use client';

import * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { usePayDialog } from './usePayDialogContext';

export function StepRailParams() {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const [local, setLocal] = React.useState<Record<string, string>>({});

    function set(k: string, v: string) {
        setLocal((s) => ({ ...s, [k]: v }));
    }

    function next() {
        // Validate per rail
        if (ctx.rail === 'WIRE_TRANSFER') {
            if (!local.bankReference) { ctx.setError(t('errors.bankReferenceRequired')); return; }
            ctx.setRailDetails({
                bank_reference: local.bankReference,
                bank_name: local.bankName ?? null,
                notes: local.notes ?? null,
            });
        } else if (ctx.rail === 'MOBILE_MONEY') {
            if (!local.phoneNumber) { ctx.setError(t('errors.phoneRequired')); return; }
            ctx.setRailDetails({
                phone_number: local.phoneNumber,
                provider_hint: ctx.chosenProvider,
                operator_reference: local.operatorReference ?? null,
            });
        } else if (ctx.rail === 'THIRD_PARTY') {
            if (!local.payerName) { ctx.setError(t('errors.payerNameRequired')); return; }
            ctx.setRailDetails({
                payer_name: local.payerName,
                payer_relationship: local.payerRelationship ?? null,
                external_reference: local.externalReference ?? null,
            });
        } else if (ctx.rail === 'WALLET') {
            ctx.setRailDetails({ source: 'owner_initiated' });
        }
        ctx.setError(null);
        ctx.setStep('confirm');
    }

    function back() {
        ctx.setError(null);
        ctx.setStep('rail');
    }

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--os-text-muted)]">
                {t(`paramsHint.${ctx.rail?.toLowerCase()}`, { provider: ctx.chosenProvider ?? '' })}
            </p>

            {ctx.rail === 'WIRE_TRANSFER' && (
                <>
                    <Field label={t('field.bankReference')} required>
                        <OsInput value={local.bankReference ?? ''} onChange={(e) => set('bankReference', e.target.value)} placeholder="SWIFT-MT103-…" />
                    </Field>
                    <Field label={t('field.bankName')}>
                        <OsInput value={local.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} />
                    </Field>
                    <Field label={t('field.notes')}>
                        <OsInput value={local.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
                    </Field>
                </>
            )}

            {ctx.rail === 'MOBILE_MONEY' && (
                <>
                    <Field label={t('field.phoneNumber')} required>
                        <OsInput value={local.phoneNumber ?? ''} onChange={(e) => set('phoneNumber', e.target.value)} placeholder="+221 …" />
                    </Field>
                    <Field label={t('field.operatorReference')}>
                        <OsInput value={local.operatorReference ?? ''} onChange={(e) => set('operatorReference', e.target.value)} />
                    </Field>
                    <p className="text-[11px] text-[var(--os-text-muted)]">
                        {t('field.viaProvider', { provider: ctx.chosenProvider ?? '' })}
                    </p>
                </>
            )}

            {ctx.rail === 'THIRD_PARTY' && (
                <>
                    <Field label={t('field.payerName')} required>
                        <OsInput value={local.payerName ?? ''} onChange={(e) => set('payerName', e.target.value)} />
                    </Field>
                    <Field label={t('field.payerRelationship')}>
                        <OsInput value={local.payerRelationship ?? ''} onChange={(e) => set('payerRelationship', e.target.value)} />
                    </Field>
                    <Field label={t('field.externalReference')}>
                        <OsInput value={local.externalReference ?? ''} onChange={(e) => set('externalReference', e.target.value)} />
                    </Field>
                </>
            )}

            {ctx.rail === 'WALLET' && (
                <p className="text-xs text-[var(--os-text-primary)] py-2">
                    {t('field.walletConfirm', { balance: (ctx.walletBalanceUsdMinor / 100).toFixed(2) })}
                </p>
            )}

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back}>
                    {t('back')}
                </OsButton>
                <OsButton variant="primary" size="sm" onClick={next}>
                    {t('next')}
                </OsButton>
            </div>
        </div>
    );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[var(--os-text-secondary)] uppercase tracking-wide">
                {label} {required && <span className="text-[#EF4444]">*</span>}
            </span>
            {children}
        </label>
    );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: only `StepConfirm` import unresolved.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/owner/PayDialog/StepRailParams.tsx
git commit -m "feat(7c-2): PayDialog Step 2 — rail-specific params

Branched form for WIRE_TRANSFER (bank_reference required), MOBILE_MONEY
(phone_number required + provider hint), THIRD_PARTY (payer_name required),
WALLET (no fields, just confirmation). Validation surfaces localized
errors via ctx.setError. Forward writes to ctx.railDetails for Step 3."
```

---

## Task 8: Step 3 — confirm + submit via `initiatePayment`

**Files:**
- Create: `frontend/src/components/owner/PayDialog/StepConfirm.tsx`

Final summary screen. Calls Plan 7C-1's `initiatePayment` server action. On success, navigates back to `/owner/(portal)/invoices` and refreshes the page.

- [ ] **Step 1: Create the confirm step**

Create `frontend/src/components/owner/PayDialog/StepConfirm.tsx`:

```tsx
'use client';

import * as React from 'react';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { initiatePayment } from '@/actions/initiatePayment';
import { applyWallet } from '@/actions/applyWallet';
import { usePayDialog } from './usePayDialogContext';

export function StepConfirm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('OwnerPortal.payDialog');
    const ctx = usePayDialog();
    const router = useRouter();

    function back() {
        ctx.setError(null);
        ctx.setStep('params');
    }

    async function submit() {
        if (!ctx.rail) { ctx.setError(t('errors.noRail')); return; }
        ctx.setSubmitting(true);
        ctx.setError(null);
        try {
            if (ctx.rail === 'WALLET') {
                await applyWallet({ transactionId: ctx.transactionId });
            } else {
                await initiatePayment({
                    transactionId: ctx.transactionId,
                    amount: ctx.amountUsd.toFixed(2),
                    currency: ctx.currency,
                    rail: ctx.rail,
                    railDetails: ctx.railDetails,
                });
            }
            ctx.reset();
            onClose();
            router.refresh();
        } catch (e) {
            ctx.setError(e instanceof Error ? e.message : 'Submission failed');
        } finally {
            ctx.setSubmitting(false);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                    {t('summary.invoice')}
                </p>
                <p className="text-sm font-mono text-[var(--os-text-primary)]">{ctx.invoiceRef}</p>

                <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('summary.amount')}</p>
                        <p className="text-sm font-bold text-[var(--os-text-primary)]">
                            {ctx.amountUsd.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        </p>
                    </div>
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('summary.rail')}</p>
                        <p className="text-sm font-bold text-[var(--os-text-primary)]">{ctx.rail}</p>
                    </div>
                </div>

                {ctx.chosenProvider && ctx.rail !== 'WALLET' && ctx.rail !== 'WIRE_TRANSFER' && (
                    <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('summary.provider')}</p>
                        <p className="text-sm text-[var(--os-text-primary)]">{ctx.chosenProvider}</p>
                    </div>
                )}

                {Object.keys(ctx.railDetails).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--os-border)]">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{t('summary.details')}</p>
                        <pre className="text-[11px] text-[var(--os-text-secondary)] whitespace-pre-wrap font-mono">
                            {JSON.stringify(ctx.railDetails, null, 2)}
                        </pre>
                    </div>
                )}
            </div>

            <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">
                {t('summary.disclaimer')}
            </p>

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back} disabled={ctx.submitting}>
                    {t('back')}
                </OsButton>
                <OsButton variant="primary" size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={submit} disabled={ctx.submitting}>
                    {ctx.submitting ? t('submitting') : t('submit')}
                </OsButton>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Type-check — should now be clean**

```bash
npx tsc --noEmit
```

Expected: no errors related to PayDialog.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/owner/PayDialog/StepConfirm.tsx
git commit -m "feat(7c-2): PayDialog Step 3 — confirm + submit

Summary card shows invoice ref / amount / rail / provider / railDetails
JSON. Submit calls initiatePayment for non-wallet rails or applyWallet for
WALLET. On success: reset wizard, close dialog, refresh router."
```

---

## Task 9: Integration on `/owner/(portal)/invoices`

**Files:**
- Modify: `frontend/src/app/owner/\(portal\)/invoices/page.tsx`

Replace `<PayProformaDialog>` with `<PayDialog>`. Wallet balance is fetched on the server and passed in. Legacy `PayProformaDialog.tsx` stays in the repo — it's dropped in Plan 7C-5.

- [ ] **Step 1: Inspect the current page**

```bash
grep -n "PayProformaDialog" frontend/src/app/owner/\(portal\)/invoices/page.tsx
```

Note the exact import line and the JSX usage line.

- [ ] **Step 2: Replace import + usage**

Edit `frontend/src/app/owner/(portal)/invoices/page.tsx`:

Replace the import:

```typescript
// Before:
// import { PayProformaDialog } from './PayProformaDialog';

// After:
import { PayDialog } from '@/components/owner/PayDialog';
```

Add wallet balance fetch (next to the existing transactions query — search for the `createClient()` block that fetches the proforma list):

```typescript
const { data: walletRow } = await supabase
    .from('wallets')
    .select('balance_usd_minor')
    .eq('shipowner_id', shipownerId)
    .maybeSingle();

const walletBalanceUsdMinor = walletRow?.balance_usd_minor ?? 0;
```

Replace the JSX usage:

```tsx
<PayDialog
    open={openPayDialog}
    onOpenChange={setOpenPayDialog}
    transactionId={selectedTx.id}
    invoiceRef={selectedTx.invoice_ref ?? selectedTx.id}
    amountUsd={Number(selectedTx.tax_amount_usd)}
    currency="USD"
    walletBalanceUsdMinor={walletBalanceUsdMinor}
/>
```

Note: `selectedTx`, `openPayDialog`, `setOpenPayDialog` are existing names — preserve them. If the existing page is a server component, the dialog open-state must remain in a sibling client component (the page already has this pattern for `PayProformaDialog`).

- [ ] **Step 3: Build + visual verify**

```bash
npx tsc --noEmit
npx next build
npm run dev
```

Open http://localhost:3300/owner/invoices, click any "Pay" button. Confirm:
- Step 1 shows rail cards with WALLET disabled if balance = 0
- Step 2 shows correct fields per rail
- Step 3 submits and refreshes
- Network tab shows POST to `/api/owner/payment-availability` (Step 1) + server action call (Step 3)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/owner/\(portal\)/invoices/page.tsx
git commit -m "feat(7c-2): wire PayDialog into /owner/invoices

Replace legacy PayProformaDialog usage with PayDialog. Wallet balance is
fetched server-side from wallets.balance_usd_minor. PayProformaDialog.tsx
file remains in repo for one release; Plan 7C-5 will delete it."
```

---

## Task 10: i18n + integration test + final gates

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`
- Create: `frontend/src/components/owner/PayDialog/PayDialog.test.tsx`

- [ ] **Step 1: Add EN i18n keys**

Edit `frontend/messages/en.json`. Add inside the `OwnerPortal` namespace (sibling to existing keys):

```json
"payDialog": {
    "title": "Pay invoice",
    "subtitle": "Choose how you want to pay this pro-forma. Finance will reconcile it before marking your vessel compliant.",
    "back": "Back",
    "next": "Next",
    "submit": "Submit payment",
    "submitting": "Submitting…",
    "loadingRails": "Checking available payment methods…",
    "chooseRail": "Pick a payment method for {currency}:",
    "railNotAvailable": "No active provider supports this rail right now.",
    "noRailEligible": "No payment method is currently available for this currency. Please contact finance.",
    "rail": {
        "wire":   { "label": "Bank wire (SWIFT)",    "hint": "Manual reconciliation" },
        "momo":   { "label": "Mobile money",          "hint": "via {provider}" },
        "third":  { "label": "Third-party payer",    "hint": "via {provider}" },
        "wallet": { "label": "Apply wallet credit",   "hint": "Use existing balance" }
    },
    "paramsHint": {
        "wire_transfer": "Send the wire and enter the bank reference below.",
        "mobile_money":  "Enter the phone number used for the {provider} transfer.",
        "third_party":   "Identify the third party paying on your behalf.",
        "wallet":        "Apply your wallet balance to this invoice."
    },
    "field": {
        "bankReference":      "Bank reference",
        "bankName":           "Bank name",
        "notes":              "Notes",
        "phoneNumber":        "Phone number",
        "operatorReference":  "Operator reference",
        "viaProvider":        "Routed via {provider}",
        "payerName":          "Payer name",
        "payerRelationship":  "Relationship to your company",
        "externalReference":  "External reference",
        "walletConfirm":      "Apply ${balance} from your wallet to this invoice."
    },
    "summary": {
        "invoice":    "Invoice",
        "amount":     "Amount",
        "rail":       "Method",
        "provider":   "Provider",
        "details":    "Details",
        "disclaimer": "Submitting registers your payment as INITIATED. Finance reviews and confirms it within 24h."
    },
    "errors": {
        "bankReferenceRequired": "Bank reference is required.",
        "phoneRequired":         "Phone number is required.",
        "payerNameRequired":     "Payer name is required.",
        "noRail":                "Please pick a payment method first."
    }
}
```

- [ ] **Step 2: Add FR i18n keys**

Edit `frontend/messages/fr.json` with the same structure, French translations:

```json
"payDialog": {
    "title": "Payer la facture",
    "subtitle": "Choisissez comment régler cette pro-forma. Le service finance la rapprochera avant de marquer votre navire conforme.",
    "back": "Retour",
    "next": "Suivant",
    "submit": "Envoyer le paiement",
    "submitting": "Envoi…",
    "loadingRails": "Vérification des moyens de paiement disponibles…",
    "chooseRail": "Choisissez un moyen de paiement pour {currency} :",
    "railNotAvailable": "Aucun prestataire actif ne prend en charge ce rail.",
    "noRailEligible": "Aucun moyen de paiement n'est disponible pour cette devise. Contactez le service finance.",
    "rail": {
        "wire":   { "label": "Virement bancaire (SWIFT)", "hint": "Rapprochement manuel" },
        "momo":   { "label": "Mobile money",               "hint": "via {provider}" },
        "third":  { "label": "Tiers payeur",               "hint": "via {provider}" },
        "wallet": { "label": "Appliquer le crédit wallet", "hint": "Utiliser le solde existant" }
    },
    "paramsHint": {
        "wire_transfer": "Effectuez le virement et saisissez la référence bancaire ci-dessous.",
        "mobile_money":  "Saisissez le numéro de téléphone utilisé pour le transfert {provider}.",
        "third_party":   "Identifiez le tiers qui paie pour votre compte.",
        "wallet":        "Appliquez votre solde wallet à cette facture."
    },
    "field": {
        "bankReference":      "Référence bancaire",
        "bankName":           "Banque",
        "notes":              "Notes",
        "phoneNumber":        "Numéro de téléphone",
        "operatorReference":  "Référence opérateur",
        "viaProvider":        "Routé via {provider}",
        "payerName":          "Nom du payeur",
        "payerRelationship":  "Relation avec votre société",
        "externalReference":  "Référence externe",
        "walletConfirm":      "Appliquer ${balance} de votre wallet à cette facture."
    },
    "summary": {
        "invoice":    "Facture",
        "amount":     "Montant",
        "rail":       "Méthode",
        "provider":   "Prestataire",
        "details":    "Détails",
        "disclaimer": "L'envoi enregistre votre paiement comme INITIATED. Le service finance vérifie et confirme sous 24h."
    },
    "errors": {
        "bankReferenceRequired": "La référence bancaire est requise.",
        "phoneRequired":         "Le numéro de téléphone est requis.",
        "payerNameRequired":     "Le nom du payeur est requis.",
        "noRail":                "Veuillez d'abord choisir un moyen de paiement."
    }
}
```

- [ ] **Step 3: Write the integration test**

Create `frontend/src/components/owner/PayDialog/PayDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PayDialog } from './PayDialog';
import enMessages from '../../../../messages/en.json';

vi.mock('@/actions/initiatePayment', () => ({
    initiatePayment: vi.fn().mockResolvedValue({ id: 'pay-1', status: 'INITIATED' }),
}));
vi.mock('@/actions/applyWallet', () => ({
    applyWallet: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

global.fetch = vi.fn();

function setup(props: Partial<React.ComponentProps<typeof PayDialog>> = {}) {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <PayDialog
                open={true}
                onOpenChange={() => {}}
                transactionId="tx-1"
                invoiceRef="INV-001"
                amountUsd={1000}
                currency="USD"
                walletBalanceUsdMinor={0}
                {...props}
            />
        </NextIntlClientProvider>,
    );
}

describe('PayDialog', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('Step 1 renders rail cards from availability API', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [
                    { rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] },
                    { rail: 'MOBILE_MONEY',  eligible: false, providers: [], reason: 'no_active_provider' },
                    { rail: 'THIRD_PARTY',   eligible: false, providers: [], reason: 'no_active_provider' },
                    { rail: 'WALLET',        eligible: false, providers: [], reason: 'wallet_empty' },
                ],
            }),
        });
        setup();
        await waitFor(() => expect(screen.getByText(/Bank wire/i)).toBeInTheDocument());
        const wireBtn = screen.getByText(/Bank wire/i).closest('button');
        const momoBtn = screen.getByText(/Mobile money/i).closest('button');
        expect(wireBtn).not.toBeDisabled();
        expect(momoBtn).toBeDisabled();
    });

    it('progresses through Step 2 and Step 3 for WIRE_TRANSFER, calls initiatePayment', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Bank wire/i));

        fireEvent.click(screen.getByText(/Bank wire/i).closest('button')!);
        // Step 2
        const refInput = await screen.findByPlaceholderText('SWIFT-MT103-…');
        fireEvent.change(refInput, { target: { value: 'SWIFT-12345' } });
        fireEvent.click(screen.getByText('Next'));

        // Step 3
        await waitFor(() => screen.getByText(/Submit payment/i));
        fireEvent.click(screen.getByText(/Submit payment/i));

        const { initiatePayment } = await import('@/actions/initiatePayment');
        await waitFor(() => expect(initiatePayment).toHaveBeenCalledWith(expect.objectContaining({
            transactionId: 'tx-1',
            rail: 'WIRE_TRANSFER',
            currency: 'USD',
            railDetails: expect.objectContaining({ bank_reference: 'SWIFT-12345' }),
        })));
    });

    it('blocks Step 2 → 3 if WIRE_TRANSFER bank reference missing', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                rails: [{ rail: 'WIRE_TRANSFER', eligible: true, providers: [{ provider: 'wire_transfer', routes_rail: ['WIRE_TRANSFER'], display_order: 5 }] }],
            }),
        });
        setup();
        await waitFor(() => screen.getByText(/Bank wire/i));
        fireEvent.click(screen.getByText(/Bank wire/i).closest('button')!);
        fireEvent.click(screen.getByText('Next'));
        expect(await screen.findByText(/Bank reference is required/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 4: Run vitest**

```bash
npx vitest run src/components/owner/PayDialog/PayDialog.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 5: Final gates**

```bash
npx tsc --noEmit
npx vitest run
npx next build
./supabase/tests/run.sh migrations/060_payment_config_multi_active.test.sql
```

All four MUST pass before commit.

- [ ] **Step 6: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json \
        frontend/src/components/owner/PayDialog/PayDialog.test.tsx
git commit -m "feat(7c-2): i18n EN/FR + PayDialog vitest coverage

OwnerPortal.payDialog namespace covers all 3 steps + summary + errors.
3 tests cover (a) rail picker disables ineligible rails from API,
(b) WIRE_TRANSFER end-to-end through to initiatePayment with correct
railDetails shape, (c) Step 2 validation blocks empty bank_reference.

All gates green: tsc, vitest, next build, mig 060 pg test."
```

---

## Acceptance Criteria

- [ ] Mig 060 applied locally, hosted push deferred to merge time
- [ ] `payment_config_single_active` index dropped (`SELECT * FROM pg_indexes WHERE indexname = 'payment_config_single_active'` returns 0 rows)
- [ ] Two providers can be active simultaneously in `payment_config` (no constraint violation)
- [ ] `selectProvidersForRail('MOBILE_MONEY')` returns the correct subset filtered by `routes_rail`
- [ ] Admin page at `/admin/tax-settings` Payment Providers tab shows independent toggles + "Rails Served" badges
- [ ] PUT `/api/admin/payment-config` accepts both `{ activeProvider }` (legacy) and `{ provider, isActive }` (new) shapes
- [ ] `<PayDialog>` opens from `/owner/invoices` "Pay" button
- [ ] Step 1 fetches `/api/owner/payment-availability` and disables ineligible rails with localized reason
- [ ] WALLET rail disabled when `walletBalanceUsdMinor === 0`
- [ ] Step 2 form validates required fields per rail with localized error messages
- [ ] Step 3 submits via `initiatePayment` (non-wallet) or `applyWallet` (wallet) and refreshes the page
- [ ] EN + FR i18n keys complete under `OwnerPortal.payDialog`
- [ ] All gates green: `npx tsc --noEmit`, `npx vitest run`, `npx next build`, mig 060 pg test
- [ ] Legacy `paymentIntentService` and `PayProformaDialog.tsx` files remain in repo (Plan 7C-5 deletes them)

---

## Hosted DB Push (after merge to develop)

After PR is merged to develop:

```bash
cd c:\Users\lecle\Workspace\africgreen
supabase db push --include-all
```

Expect partial-state pattern from prior pushes (mig 013's index drop may already have been done manually if hosted is out-of-band). If push errors with "index does not exist" on `DROP INDEX`, the `IF EXISTS` clause makes it idempotent — confirm with `supabase migration list` then `supabase migration repair --status applied 060`.

---

## Self-Review Notes

- **Spec coverage:** §7.1 of the shipowner-portal spec calls for owner-initiable rails (WIRE_TRANSFER, MOBILE_MONEY, THIRD_PARTY, WALLET) — all covered. Multi-active providers were NOT in the original spec but are an explicit user requirement (Option B from this conversation) that decouples 7C-2's rail picker from the legacy single-provider lock.
- **Type consistency:** `Rail` type in `usePayDialogContext` matches `OWNER_RAILS` in `initiatePayment.ts`. `chosenProvider: string | null` matches `provider: string` from the availability API.
- **Routing scope:** v1 picks `providers[0]` (first by display_order). A sub-picker for "choose between Flutterwave and Wave for MOBILE_MONEY in the same wallet" is deferred — single-provider-per-rail-per-currency is a reasonable v1 default given current geographic split (Wave only handles XOF/SOS, Flutterwave handles the rest).
- **Backward compat:** Legacy `getActiveProvider`/`setActiveProvider`/`{ activeProvider }` API shape ALL preserved so `paymentIntentService` keeps working until Plan 7C-5 cutover.
