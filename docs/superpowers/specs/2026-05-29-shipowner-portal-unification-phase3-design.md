# Shipowner Portal Unification — Phase 3 (Nav Superset)

**Date:** 2026-05-29
**Status:** Approved (pending written-spec review)
**Author:** Loic Leclerc + Claude

## Background

Final phase of converging the legacy armateur experience onto the v7 `/owner` portal (see Phase 1 + Phase 2 specs). Phase 3 ports the features a legacy `SHIPPING_AGENT` had on `/dashboard` but that `/owner` lacks, so migrated armateurs lose nothing. Approach: **reuse the existing components**, rendered inside `OwnerShell` with owner-scoped (RLS) data — not rebuild.

Scope = **4 features** (The Eye/Map dropped — ambiguous and not selected):
1. **Tax Simulator** — easy (role-agnostic, pure calc).
2. **My Fleet enrichment** — light (add a "recent invoices" section to the existing `/owner/vessels`).
3. **TCO Dashboard** — light/medium (reuse the existing agent view).
4. **Disputes (owner list)** — medium (new owner-scoped list; opening disputes already exists).

Decision: **one Phase-3 spec + one plan**, one task per feature (+ nav + i18n); executed task-by-task.

## Goal
A shipowner on `/owner` can reach a Tax Simulator, a TCO dashboard, a list of their disputes, and see recent invoices on their fleet page — all owner-scoped, via new `OwnerShell` nav entries.

## Non-Goals
- Porting "The Eye"/live map or GreenLedger (dropped from scope).
- Any change to the staff `/dashboard` versions of these features.
- New business logic — this is a porting/reuse phase.

## Key facts (established)
- Owner page pattern: route under `frontend/src/app/owner/(portal)/<x>/page.tsx`; the `(portal)/layout.tsx` already calls `requireOwner()` and renders `OwnerShell`; pages use `session.supabase` (RLS-scoped) or client hooks (browser client, RLS-scoped to the owner). Template: `frontend/src/app/owner/(portal)/invoices/page.tsx`.
- `OwnerShell` (`frontend/src/components/owner/OwnerShell.tsx`): `NAV_ITEMS` (5 entries) with `labelKey` typed as a **string-literal union** (`'dashboard'|'vessels'|'invoices'|'wallet'|'alerts'`) → adding entries requires extending that union. Owner nav i18n keys live under `OwnerPortal.nav` (`dashboard, vessels, invoices, alerts, wallet, signOut`).
- **Tax Simulator**: `frontend/src/components/dashboard/simulator/TaxSimulatorPage.tsx` — no `useRole()`, reads `useTaxConfigs()`; reusable as-is.
- **TCO**: `frontend/src/components/dashboard/tco/TcoDashboard.tsx` — `ShippingAgentView` is a **local (non-exported) function** at line 47; the default export picks agent-vs-finance by `useRole()` (line 325/348). `ShippingAgentView` uses `useTco()` (→ `useVessels`/`useTransactions`, RLS-scoped).
- **Disputes**: `DisputesPage` is role-coupled with an inline list (`filtered.map`, line 152) + a `DisputeDetail` component (line 226). `disputeService.getDisputesBySubmitter(client, userId)` filters `.eq('submitted_by', userId)`. Owners open disputes via the existing `OpenDisputeDialog` → `createOwnerDispute` action. No owner LIST exists yet.
- **My Fleet**: legacy `MyFleetPage` shows a vessel grid + a recent-invoices grid; `/owner/vessels` (`frontend/src/app/owner/(portal)/vessels/page.tsx`) shows the vessel table only. Middleware already maps `/dashboard/my-fleet → /owner/vessels`.

## Design

### A. Nav + i18n (shared prerequisite)
- Extend `OwnerShell` `NAV_ITEMS` + the `labelKey` union with `simulator`, `tco`, `disputes`. Add icons (lucide: `Calculator`, `BarChart3`/`PieChart`, `Scale`).
- Add `OwnerPortal.nav.{simulator,tco,disputes}` in `en.json` + `fr.json`.

### B. Tax Simulator → `/owner/simulator`
- New route `frontend/src/app/owner/(portal)/simulator/page.tsx` rendering the existing `TaxSimulatorPage`. If `TaxSimulatorPage` is a client component with no role/staff dependency, render it directly (server page → client component). Verify it doesn't import staff-only layout/context; if it does, wrap/strip minimally.

### C. My Fleet enrichment → `/owner/vessels`
- Add a "Recent invoices" section to `frontend/src/app/owner/(portal)/vessels/page.tsx` (server-fetch the owner's latest N transactions via `session.supabase`, RLS-scoped, like the invoices page does), rendered below the vessels table. Reuse existing invoice-row presentation where practical. No new route.

### D. TCO → `/owner/tco`
- Export `ShippingAgentView` from `TcoDashboard.tsx` (change `function ShippingAgentView()` → `export function ShippingAgentView()`; leave the default export untouched).
- New route `frontend/src/app/owner/(portal)/tco/page.tsx` rendering `<ShippingAgentView />` (a client component) inside the owner page. Data flows through `useTco()`/`useVessels()`/`useTransactions()` which use the browser Supabase client → RLS scopes to the owner. No finance view, no `useRole()`.

### E. Disputes owner list → `/owner/disputes`
- New route `frontend/src/app/owner/(portal)/disputes/page.tsx` + a client list component that fetches the owner's disputes and renders them (status badges + a detail drawer reusing `DisputeDetail` if it's reasonably decoupled; otherwise a thin owner-specific detail view).
- **Owner scoping**: resolve the exact predicate at plan time — either `disputeService.getDisputesBySubmitter(client, session.userId)` (disputes carry `submitted_by`) or a `shipowner_id`-scoped variant if the disputes table has it. The owner's own RLS must already permit reading their disputes (they can create them). The plan reads the disputes table RLS + `createOwnerDispute` to pick the correct query. Reuse the existing `OpenDisputeDialog` for the "open a dispute" CTA on this page (it already exists in the invoices area).

## Error handling / edge cases
- Empty states: each new page renders a friendly empty state when the owner has no data (no vessels/invoices/disputes/tco rows).
- A feature component that turns out to import a staff-only provider/layout is adapted minimally (render just the inner view) rather than dragging in dashboard chrome.
- All data is RLS-scoped to the signed-in owner; no cross-owner leakage (same guarantee as existing owner pages).

## Security
- No new trust boundary: every page is under `(portal)/layout.tsx` → `requireOwner()`; data via the RLS-scoped client. Reused components must not be given a service-role client.
- Exporting `ShippingAgentView` widens nothing (it's a presentational view bound to RLS-scoped hooks).

## Testing
- **Nav:** `OwnerShell` renders the 3 new entries with correct hrefs/labels.
- **Simulator/TCO/Disputes routes:** smoke-render under a mocked `requireOwner` session; assert the expected component mounts (and, for disputes, that the owner-scoped query is the one called).
- **My Fleet:** the vessels page includes the recent-invoices section when invoices exist; empty state otherwise.
- **No regression:** staff `/dashboard` TCO/Disputes/Simulator unchanged (the TcoDashboard default export still picks the view by role; exporting the agent view doesn't change behavior).
- tsc + full suite + build green.

## Files (anticipated)
**New**
- `frontend/src/app/owner/(portal)/simulator/page.tsx`
- `frontend/src/app/owner/(portal)/tco/page.tsx`
- `frontend/src/app/owner/(portal)/disputes/page.tsx` + a client list component
- tests for the new routes/nav

**Modified**
- `frontend/src/components/owner/OwnerShell.tsx` (nav entries + labelKey union)
- `frontend/src/components/dashboard/tco/TcoDashboard.tsx` (export `ShippingAgentView`)
- `frontend/src/app/owner/(portal)/vessels/page.tsx` (recent-invoices section)
- `frontend/messages/en.json`, `frontend/messages/fr.json` (nav keys)
- possibly `frontend/src/services/disputeService.ts` (add an owner-scoped list helper if needed)

## Open questions
None — design approved. Pending user review of this written spec.
