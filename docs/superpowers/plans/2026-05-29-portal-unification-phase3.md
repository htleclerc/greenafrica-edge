# Shipowner Portal Unification — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Tax Simulator, TCO, an owner Disputes list, and a recent-invoices section into the `/owner` portal (new nav entries), reusing existing components, owner-scoped via RLS.

**Architecture:** New routes under `frontend/src/app/owner/(portal)/<x>/` rendered by the existing `requireOwner()` layout + `OwnerShell`. Reuse existing components (`TaxSimulatorPage` as-is, `ShippingAgentView` exported from `TcoDashboard`); build a thin read-only owner disputes list off `disputeService.getDisputesBySubmitter`. Add 3 nav entries + i18n.

**Tech Stack:** Next.js App Router (server pages + client components), Supabase RLS-scoped client, next-intl, Vitest + Testing Library.

---

## Established facts (do not re-investigate)
- Owner pages live under `frontend/src/app/owner/(portal)/<x>/page.tsx`; `(portal)/layout.tsx` already calls `requireOwner()` and renders `OwnerShell`. Server pages use `session.supabase` (RLS-scoped) + `session.userId` + `session.shipowner.id`. Template: `frontend/src/app/owner/(portal)/vessels/page.tsx` (reproduced below).
- `OwnerShell` (`frontend/src/components/owner/OwnerShell.tsx`): `NAV_ITEMS` at L19-25; `labelKey` is a string-literal union at L15 (`'dashboard'|'vessels'|'invoices'|'wallet'|'alerts'`); labels render via `t(\`nav.${item.labelKey}\`)` with `useTranslations('OwnerPortal')`. Icons imported from `lucide-react` at L7.
- Owner nav i18n: `OwnerPortal.nav.{dashboard,vessels,invoices,alerts,wallet,signOut}` (en + fr).
- `TaxSimulatorPage` (`frontend/src/components/dashboard/simulator/TaxSimulatorPage.tsx`): `'use client'`, no `useRole`, uses `useTaxConfigs()`. Self-contained.
- `TcoDashboard` (`frontend/src/components/dashboard/tco/TcoDashboard.tsx`): `ShippingAgentView` is a **local function at L47** (NOT exported); default export picks the view by `useRole()` at L325/348. `ShippingAgentView` uses `useTco()` (client, RLS-scoped). It is `'use client'` (top of file).
- Disputes: `disputeService.getDisputesBySubmitter(client, userId)` → `.eq('submitted_by', userId)`. `createOwnerDispute` sets `submitted_by: auth.user.id`. So an owner's disputes = `getDisputesBySubmitter(session.supabase, session.userId)`. `Dispute` type fields (`frontend/src/types/secure/index.ts:361`): `id, ref, transactionRef, vesselName, status (DisputeStatus), reason, originalAmountUsd, createdAt, description, …`. `DisputeStatus` enum: `OPEN, UNDER_REVIEW, ACCEPTED, REJECTED, ESCALATED`.
- `OsBadge` variants used in the app: `active, warning, critical, info, archived, draft` (+ `size="sm"`).
- Tests: component tests run under the `jsdom` vitest project; per-test `vi.mock('next-intl', () => ({ useTranslations: () => (k) => k }))`. Baseline suite: 544 passed | 11 skipped.

---

### Task 1: Owner nav entries + i18n (Simulator, TCO, Disputes)

**Files:**
- Modify: `frontend/src/components/owner/OwnerShell.tsx`
- Modify: `frontend/messages/en.json`, `frontend/messages/fr.json`
- Test: `frontend/src/components/owner/__tests__/OwnerShell.nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/owner/__tests__/OwnerShell.nav.test.tsx
import { it, expect } from 'vitest';
import { __OWNER_NAV_ITEMS_FOR_TEST } from '../OwnerShell';

it('exposes Simulator, TCO and Disputes nav entries', () => {
    const hrefs = __OWNER_NAV_ITEMS_FOR_TEST.map((n) => n.href);
    expect(hrefs).toEqual(expect.arrayContaining(['/owner/simulator', '/owner/tco', '/owner/disputes']));
    // existing entries preserved
    expect(hrefs).toEqual(expect.arrayContaining(['/owner/dashboard', '/owner/vessels', '/owner/invoices', '/owner/wallet', '/owner/alerts']));
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd frontend && npx vitest run src/components/owner/__tests__/OwnerShell.nav.test.tsx`
Expected: FAIL — `__OWNER_NAV_ITEMS_FOR_TEST` not exported.

- [ ] **Step 3: Edit `OwnerShell.tsx`**

(a) Extend the lucide import (L7) to add icons:
```tsx
import { LayoutDashboard, Ship, FileText, AlertTriangle, Wallet, LogOut, Calculator, BarChart3, Scale } from 'lucide-react';
```
(b) Extend the `labelKey` union (L15):
```tsx
    labelKey: 'dashboard' | 'vessels' | 'invoices' | 'wallet' | 'alerts' | 'simulator' | 'tco' | 'disputes';
```
(c) Add 3 entries to `NAV_ITEMS` (place after `invoices`, before `wallet`):
```tsx
    { href: '/owner/invoices',  labelKey: 'invoices',  icon: <FileText className="w-4 h-4" /> },
    { href: '/owner/simulator', labelKey: 'simulator', icon: <Calculator className="w-4 h-4" /> },
    { href: '/owner/tco',       labelKey: 'tco',       icon: <BarChart3 className="w-4 h-4" /> },
    { href: '/owner/disputes',  labelKey: 'disputes',  icon: <Scale className="w-4 h-4" /> },
    { href: '/owner/wallet',    labelKey: 'wallet',    icon: <Wallet className="w-4 h-4" /> },
```
(d) After the `NAV_ITEMS` array definition, export it for tests:
```tsx
// Exported for tests only.
export const __OWNER_NAV_ITEMS_FOR_TEST = NAV_ITEMS;
```

- [ ] **Step 4: Add i18n keys under `OwnerPortal.nav` (both files)**

`en.json` `OwnerPortal.nav`:
```json
"simulator": "Tax Simulator",
"tco": "TCO Dashboard",
"disputes": "Disputes",
```
`fr.json` `OwnerPortal.nav`:
```json
"simulator": "Simulateur de taxe",
"tco": "Tableau TCO",
"disputes": "Litiges",
```

- [ ] **Step 5: Run test + validate**

Run: `cd frontend && npx vitest run src/components/owner/__tests__/OwnerShell.nav.test.tsx` → PASS.
Run: `cd frontend && node -e "const en=require('./messages/en.json'),fr=require('./messages/fr.json'); for(const m of [en,fr]){const n=m.OwnerPortal.nav; if(!n.simulator||!n.tco||!n.disputes) throw new Error('missing nav key');} console.log('keys ok')"` → `keys ok`.
Run: `cd frontend && npx tsc --noEmit` → EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/owner/OwnerShell.tsx frontend/src/components/owner/__tests__/OwnerShell.nav.test.tsx frontend/messages/en.json frontend/messages/fr.json
git commit -m "feat(portal): owner nav entries + i18n for Simulator/TCO/Disputes"
```

---

### Task 2: `/owner/simulator` route

**Files:**
- Create: `frontend/src/app/owner/(portal)/simulator/page.tsx`

- [ ] **Step 1: READ `TaxSimulatorPage`** to confirm it's `'use client'` and self-contained (it is — `useTaxConfigs`, no role, no dashboard layout import). If it imports a staff-only layout/provider, render only its inner content; report if so.

- [ ] **Step 2: Create the route**

```tsx
// frontend/src/app/owner/(portal)/simulator/page.tsx
import { TaxSimulatorPage } from '@/components/dashboard/simulator/TaxSimulatorPage';

export const metadata = { title: 'Owner portal — tax simulator' };
export const dynamic = 'force-dynamic';

export default function OwnerSimulatorPage() {
    return <TaxSimulatorPage />;
}
```
(If `TaxSimulatorPage` is a default export rather than named, adjust the import accordingly — READ the file's export line first and match it.)

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit` → EXIT 0.
Run: `cd frontend && npx next build` → green (the new route appears). (No unit test — this is a thin wrapper around an already-tested client component; build + manual cover it.)

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/owner/(portal)/simulator/"
git commit -m "feat(portal): /owner/simulator route (reuse TaxSimulatorPage)"
```

---

### Task 3: `/owner/tco` route (export + reuse ShippingAgentView)

**Files:**
- Modify: `frontend/src/components/dashboard/tco/TcoDashboard.tsx` (export `ShippingAgentView`)
- Create: `frontend/src/app/owner/(portal)/tco/page.tsx`

- [ ] **Step 1: Export `ShippingAgentView`**

In `TcoDashboard.tsx` L47, change:
```tsx
function ShippingAgentView() {
```
to:
```tsx
export function ShippingAgentView() {
```
Leave the default export (`TcoDashboard`) and `FinanceAdminView` untouched — staff `/dashboard/tco` behavior is unchanged.

- [ ] **Step 2: Create the route**

```tsx
// frontend/src/app/owner/(portal)/tco/page.tsx
import { ShippingAgentView } from '@/components/dashboard/tco/TcoDashboard';

export const metadata = { title: 'Owner portal — TCO' };
export const dynamic = 'force-dynamic';

export default function OwnerTcoPage() {
    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <ShippingAgentView />
        </div>
    );
}
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit` → EXIT 0.
Run: `cd frontend && npx next build` → green. (No unit test — `ShippingAgentView` is presentational over RLS-scoped `useTco`; build + manual cover it. The staff `/dashboard/tco` still renders the role-picked view — exporting the function changes nothing there.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/tco/TcoDashboard.tsx "frontend/src/app/owner/(portal)/tco/"
git commit -m "feat(portal): /owner/tco route (reuse exported ShippingAgentView)"
```

---

### Task 4: `/owner/disputes` — owner-scoped read-only list

**Files:**
- Create: `frontend/src/app/owner/(portal)/disputes/page.tsx`
- Create: `frontend/src/app/owner/(portal)/disputes/OwnerDisputesList.tsx`
- Test: `frontend/src/app/owner/(portal)/disputes/__tests__/OwnerDisputesList.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/owner/(portal)/disputes/__tests__/OwnerDisputesList.test.tsx
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OwnerDisputesList, type OwnerDisputeRow } from '../OwnerDisputesList';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

const rows: OwnerDisputeRow[] = [
    { id: 'd1', ref: 'DSP-1', vesselName: 'MV Test', status: 'OPEN', originalAmountUsd: 1200, createdAt: '2026-05-01T00:00:00Z' },
];

it('renders a dispute row with its ref, vessel and status', () => {
    render(<OwnerDisputesList rows={rows} />);
    expect(screen.getByText('DSP-1')).toBeInTheDocument();
    expect(screen.getByText('MV Test')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
});

it('renders an empty state when there are no disputes', () => {
    render(<OwnerDisputesList rows={[]} />);
    expect(screen.getByText('empty')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `cd frontend && npx vitest run "src/app/owner/(portal)/disputes/__tests__/OwnerDisputesList.test.tsx"`
Expected: FAIL — module `../OwnerDisputesList` not found.

- [ ] **Step 3: Create the list component**

```tsx
// frontend/src/app/owner/(portal)/disputes/OwnerDisputesList.tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';

export interface OwnerDisputeRow {
    id: string;
    ref: string;
    vesselName: string;
    status: 'OPEN' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'ESCALATED';
    originalAmountUsd: number;
    createdAt: string;
}

const STATUS_VARIANT: Record<OwnerDisputeRow['status'], BadgeVariant> = {
    OPEN: 'warning',
    UNDER_REVIEW: 'info',
    ACCEPTED: 'active',
    REJECTED: 'critical',
    ESCALATED: 'critical',
};

export function OwnerDisputesList({ rows }: { rows: OwnerDisputeRow[] }) {
    const t = useTranslations('OwnerPortal.disputes');

    if (rows.length === 0) {
        return (
            <div className="os-card p-8 text-center text-sm text-[var(--os-text-muted)]">
                {t('empty')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {rows.map((d) => (
                <div key={d.id} className="os-card p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-[var(--os-text-muted)]">{d.ref}</span>
                            <OsBadge variant={STATUS_VARIANT[d.status]} label={d.status} size="sm" />
                        </div>
                        <p className="text-sm font-medium text-[var(--os-text-primary)] truncate mt-0.5">{d.vesselName}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold tabular-nums text-[var(--os-text-primary)]">
                            ${d.originalAmountUsd.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">
                            {new Date(d.createdAt).toLocaleDateString()}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}
```

- [ ] **Step 4: Create the server page**

```tsx
// frontend/src/app/owner/(portal)/disputes/page.tsx
import { requireOwner } from '@/lib/auth/requireOwner';
import { getDisputesBySubmitter } from '@/services/disputeService';
import { OwnerDisputesList, type OwnerDisputeRow } from './OwnerDisputesList';

export const metadata = { title: 'Owner portal — disputes' };
export const dynamic = 'force-dynamic';

export default async function OwnerDisputesPage() {
    const session = await requireOwner();
    const disputes = await getDisputesBySubmitter(session.supabase, session.userId);
    const rows: OwnerDisputeRow[] = disputes.map((d) => ({
        id: d.id,
        ref: d.ref,
        vesselName: d.vesselName,
        status: d.status,
        originalAmountUsd: d.originalAmountUsd,
        createdAt: d.createdAt,
    }));

    return (
        <div className="px-6 py-6 max-w-4xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">Disputes</h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    Disputes you have opened. Open a new dispute from an invoice in the Invoices page.
                </p>
            </header>
            <OwnerDisputesList rows={rows} />
        </div>
    );
}
```
(`d.status` is the `DisputeStatus` enum whose values are the same strings as `OwnerDisputeRow['status']`; if tsc complains about the enum-vs-union assignment, cast `status: d.status as OwnerDisputeRow['status']`.)

- [ ] **Step 5: Add i18n key `OwnerPortal.disputes.empty` (both files)**

`en.json` → add an `OwnerPortal.disputes` object: `{ "empty": "You haven't opened any disputes yet." }`
`fr.json` → `{ "empty": "Vous n'avez ouvert aucun litige pour le moment." }`

- [ ] **Step 6: Verify**

Run: `cd frontend && npx vitest run "src/app/owner/(portal)/disputes/__tests__/OwnerDisputesList.test.tsx"` → 2 pass.
Run: `cd frontend && npx tsc --noEmit` → EXIT 0.
Run: `cd frontend && npx next build` → green.

- [ ] **Step 7: Commit**

```bash
git add "frontend/src/app/owner/(portal)/disputes/" frontend/messages/en.json frontend/messages/fr.json
git commit -m "feat(portal): /owner/disputes owner-scoped list"
```

---

### Task 5: My Fleet enrichment — recent invoices on `/owner/vessels`

**Files:**
- Modify: `frontend/src/app/owner/(portal)/vessels/page.tsx`

- [ ] **Step 1: Add a recent-invoices fetch + section**

The current page (reproduced):
```tsx
import { requireOwner } from '@/lib/auth/requireOwner';
import { VesselsTable, type VesselRow } from './VesselsTable';
export const metadata = { title: 'Owner portal — vessels' };
export const dynamic = 'force-dynamic';
export default async function OwnerVesselsPage() {
    const session = await requireOwner();
    const { data, error } = await session.supabase
        .from('vessels')
        .select('id, name, mmsi, imo_number, flag_code, category, last_zone, compliance_status')
        .order('name');
    const vessels: VesselRow[] = (data ?? []) as VesselRow[];
    return ( /* ... */ );
}
```

Add a parallel fetch of the owner's 5 most recent transactions and render them below the vessels table. Replace the body with:

```tsx
import { requireOwner } from '@/lib/auth/requireOwner';
import { VesselsTable, type VesselRow } from './VesselsTable';

export const metadata = { title: 'Owner portal — vessels' };
export const dynamic = 'force-dynamic';

interface RecentInvoice {
    id: string;
    invoice_ref: string | null;
    vessel_name: string;
    tax_amount_usd: number;
    status: string;
    created_at: string;
}

export default async function OwnerVesselsPage() {
    const session = await requireOwner();

    const [vesselsRes, invoicesRes] = await Promise.all([
        session.supabase
            .from('vessels')
            .select('id, name, mmsi, imo_number, flag_code, category, last_zone, compliance_status')
            .order('name'),
        session.supabase
            .from('transactions')
            .select('id, invoice_ref, vessel_name, tax_amount_usd, status, created_at')
            .order('created_at', { ascending: false })
            .limit(5),
    ]);

    const vessels: VesselRow[] = (vesselsRes.data ?? []) as VesselRow[];
    const recent: RecentInvoice[] = (invoicesRes.data ?? []) as RecentInvoice[];

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">Vessels</h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">
                    {vessels.length} {vessels.length === 1 ? 'vessel' : 'vessels'} on file.
                </p>
            </header>

            {vesselsRes.error ? (
                <div className="os-card p-4 text-sm" style={{ color: '#FCA5A5' }}>
                    Failed to load vessels: {vesselsRes.error.message}
                </div>
            ) : (
                <VesselsTable rows={vessels} />
            )}

            {recent.length > 0 && (
                <section className="mt-8">
                    <h2 className="text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-3">
                        Recent invoices
                    </h2>
                    <div className="flex flex-col gap-2">
                        {recent.map((inv) => (
                            <div key={inv.id} className="os-card p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <span className="text-xs font-mono text-[var(--os-text-muted)]">{inv.invoice_ref ?? inv.id.slice(0, 8)}</span>
                                    <p className="text-sm font-medium text-[var(--os-text-primary)] truncate">{inv.vessel_name}</p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-sm font-bold tabular-nums text-[var(--os-text-primary)]">${Number(inv.tax_amount_usd).toLocaleString()}</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)]">{inv.status} · {new Date(inv.created_at).toLocaleDateString()}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit` → EXIT 0.
Run: `cd frontend && npx next build` → green. (Server-fetch addition; RLS scopes transactions to the owner. No unit test — covered by build + manual.)

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/owner/(portal)/vessels/page.tsx"
git commit -m "feat(portal): recent invoices section on /owner/vessels (My Fleet parity)"
```

---

## Final verification (after all tasks)
- [ ] `cd frontend && npx tsc --noEmit` → EXIT 0
- [ ] `cd frontend && npx vitest run` → all pass, no regressions
- [ ] `cd frontend && npx next build` → green (new routes: /owner/simulator, /owner/tco, /owner/disputes)
- [ ] **Manual** (as an ACTIVE owner, e.g. Acme): the nav shows Tax Simulator / TCO Dashboard / Disputes; `/owner/simulator` computes; `/owner/tco` shows the agent TCO view with the owner's vessels/transactions; `/owner/disputes` lists the owner's disputes (and empty-states cleanly); `/owner/vessels` shows a "Recent invoices" section.

## Notes for the implementer
- **Reuse, don't rebuild.** TaxSimulatorPage + ShippingAgentView are rendered as-is; only `ShippingAgentView` needs an `export` keyword added.
- **Owner scoping is automatic** via `session.supabase` (server) / the browser client (client hooks) — both RLS-scoped to the signed-in owner. Do NOT introduce a service-role client anywhere here.
- **Staff `/dashboard` unaffected** — no staff page is modified; exporting `ShippingAgentView` doesn't change `TcoDashboard`'s default behavior.
- Thin wrapper pages (simulator, tco) have no unit test by design — they reuse already-tested components; tsc + build + manual are the gates.
- If `TaxSimulatorPage` is a default export, adjust the import in Task 2 to `import TaxSimulatorPage from '...'`.
- **Deferred:** "The Eye"/live map (dropped from Phase 3 scope).
```
