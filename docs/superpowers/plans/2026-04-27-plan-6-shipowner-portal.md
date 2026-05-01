# Plan 6 — Shipowner Portal v0

**Spec**: `docs/superpowers/specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md` (Phase 2 §6.7).
**Branch**: `feat/shipowner-portal-v0` from `develop` @ `c8b90e9`.
**Feature flag**: `feature.shipowner_portal_enabled` (already `true` in `app_config`).
**Sessions estimate**: 3-4.

## Outcome

A registered shipowner authenticates via magic link sent by an admin/manager,
lands on `/owner/dashboard`, can:

- View their fleet (`/owner/vessels`)
- View alerts on their vessels (`/owner/alerts`)
- View their pro-formas / finals / refunds, download PDFs (`/owner/invoices`)
- **Pay** an unpaid pro-forma (records a payment intent, FINANCE_ADMIN
  reconciles via existing mark-paid flow — no payment provider integration
  in v0)
- **Dispute** a charge (creates a dispute row, viewable by Port Officer
  via existing `/dashboard/disputes` UI)

Out of scope for v0:
- Self-service registration (admin-gated invitation only)
- Agent management by owner (read-only on agent assignments)
- Multi-owner switching (each `auth.users` ↔ one `shipowners` row)
- Stripe / external payment rails — payment is "I notify I've paid via
  bank transfer ref X", not a real settlement
- Phase 2 features `feature.ais_global_enabled`, `feature.equasis_scraper_enabled`

## Why this order

The hardest unknown is the auth + RLS contract. Build that first (Tasks 0-2).
Once a shipowner can log in and see their data with strict isolation, the
read-only views (Tasks 3-5) are mechanical. Actions (Tasks 6-7) are the
last and least risky — they reuse existing server actions with a wider RBAC
gate. Translations + tests (Task 8) close it.

## Tasks

### Task 0 — Schema + RLS gap

Migration `038_shipowner_portal_v0.sql`:

- Add `vessels` SELECT RLS policy for SHIPOWNER (mig 033 missed it):
  ```sql
  CREATE POLICY "shipowner reads own vessels"
    ON public.vessels FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.shipowners s
       WHERE s.id = vessels.shipowner_id
         AND s.profile_id = auth.uid()
    ));
  ```
- Add `disputes` SELECT + INSERT RLS for SHIPOWNER (own transactions only)
- Add `shipowners.invited_at TIMESTAMPTZ`, `invited_by UUID REFERENCES profiles(id)` 
  for audit; `account_state` already covers the lifecycle
- Add `shipowner_payment_intents` table (transaction_id, owner_profile_id,
  reference, declared_at, status enum DECLARED|CONFIRMED|REJECTED) — owner
  declares "I paid", FINANCE_ADMIN confirms via existing mark-paid

Migration tests in `supabase/tests/migrations/038_shipowner_portal.test.sql`:
- SHIPOWNER A cannot SELECT SHIPOWNER B's vessels/alerts/transactions
- Same isolation for disputes + payment_intents
- Without `account_state='ACTIVE'`, SHIPOWNER reads return empty (defence-in-depth)

### Task 1 — Invitation flow (admin side)

**Server action** `inviteShipowner({ shipownerId, email })`, gated
`SUPERADMIN | MANAGER`:

1. Validate `shipowners.id` exists, `account_state IN ('GHOST', 'INVITED')`
2. Use `supabase.auth.admin.inviteUserByEmail(email)` — Supabase generates
   the magic link + sends via configured email; redirect to
   `/owner/auth/callback`
3. Create `profiles` row with `role='SHIPOWNER'`, `is_active=true` (no
   admin re-approval — invitation IS the approval)
4. Set `shipowners.profile_id = profiles.id`,
   `shipowners.account_state='INVITED'`, `invited_at=now()`,
   `invited_by=auth.uid()`
5. Audit log entry

**UI** in `/admin/owner-agent-mappings` (or new column on the existing
shipowners listing): "Invite to portal" button; disabled if state is
`ACTIVE`. Toast on success.

### Task 2 — Owner login + callback

- Public `/owner/login` — minimal form, just email; POSTs to
  `supabase.auth.signInWithOtp({ email })` (re-issues magic link if user
  exists; bouncer otherwise via existing rate limit hook)
- `/owner/auth/callback` — handles Supabase `?token_hash=...&type=magiclink`,
  flips `shipowners.account_state` from `INVITED` to `ACTIVE` on first
  successful redeem
- Middleware extension: `/owner/*` paths require authenticated user with
  `profiles.role='SHIPOWNER'` AND `shipowners.profile_id=auth.uid()`;
  redirect to `/owner/login` otherwise (NOT `/login` — that's the staff
  entry point)

### Task 3 — Owner shell + dashboard

- `/owner/layout.tsx` — owner-specific shell (logo, sidebar with 4 items:
  Dashboard / Vessels / Invoices / Alerts; logout)
- `/owner/dashboard/page.tsx` — counters: active vessels, open alerts,
  unpaid pro-formas (sum USD), YTD paid (sum USD); reuse `OsCard` primitives
- New service `ownerPortalService.ts` with one helper per counter (RLS
  does the filtering — service just queries by current `auth.uid()`)

### Task 4 — Owner vessels page

- `/owner/vessels/page.tsx` — `OsTable` with columns: name, MMSI, IMO,
  flag, category, last zone, current alert status
- Click row → `/owner/vessels/[id]` detail (read-only): static info +
  recent alerts on this vessel + transactions

### Task 5 — Owner invoices page

- `/owner/invoices/page.tsx` — list `transactions` filtered by RLS;
  columns: ref, doc type badge (PROFORMA/FINAL/COMPLEMENT/REFUND), vessel
  name, amount USD, status, paid_at, "PDF" button + "Pay" button when
  `document_type='PROFORMA' AND status='PENDING'`
- "PDF" reuses existing `/api/invoices/[ref]/download` (HMAC-signed,
  works for any role with row access)
- Filter chips: All / Unpaid / Paid / Refunds

### Task 6 — Pay action (declare payment intent)

- New action `declarePaymentIntent({ transactionId, reference })` —
  inserts into `shipowner_payment_intents` (DECLARED), sends notification
  email to FINANCE_ADMIN (reuse `emailService.sendInternalNotification`)
- `PayProformaDialog.tsx` — modal with reference field + confirm
- On `/admin/payments`, FINANCE_ADMIN sees pending intents, validates →
  triggers existing mark-paid route which transitions intent to CONFIRMED

### Task 7 — Dispute action (open dispute)

- Wire SHIPOWNER role into existing `DisputeFormModal.tsx` (currently
  agent-side); confirm RBAC server-side via `requireRole`
- Verify the dispute appears in `/dashboard/disputes` for Port Officer
  with `created_by_role='SHIPOWNER'` distinguisher (add column if missing)

### Task 8 — Translations + tests

- New i18n namespace `OwnerPortal` with EN + FR strings (AR/PT/SW deferred
  to P2)
- E2E vitest covering: invite → magic-link redeem (mock Supabase auth) →
  view own vessel → declare payment intent → admin confirms → status
  transitions to CONFIRMED
- RLS isolation test (raw SQL): two test owners, assert each sees only
  their own rows

## Risk & rollout

- **RLS regression risk**: Task 0's vessels policy interacts with the
  existing dashboard RLS for SHIPPING_AGENT. Test agent dashboards still
  work after each migration step.
- **Magic-link delivery**: depends on Resend domain config + auth email
  template. Verify against staging before sending real customer invites.
- **Feature flag rollout**: `feature.shipowner_portal_enabled` already
  `true` in hosted DB. After Task 2 ships, the route exists but is
  invitation-gated (no public signup), so accidental discovery has no
  blast radius.
- **Rollback path**: each migration in 038 is paired with a `down.sql`
  in the same file (commented `-- DOWN:` block). RLS additions are
  removable without data loss.

## Dependencies between tasks

```
Task 0 (schema/RLS) ─┬─→ Task 2 (login)  ──┬─→ Task 3 (dashboard)
                     │                      ├─→ Task 4 (vessels)
                     │                      ├─→ Task 5 (invoices)
                     │                      └─→ Task 7 (dispute action)
                     ├─→ Task 1 (invite) ───┘
                     └─→ Task 6 (pay action) — needs Task 5's UI surface
                                                  └─→ Task 8 (i18n + tests)
```

Tasks 0, 1, 2 are the critical path. 3, 4, 5 can be parallelised. 6, 7
depend on 5. 8 closes.

## Out-of-scope follow-ups (Phase 2.1+)

- Real payment provider (Stripe / Wave / bank API)
- Owner can manage their list of authorised agents
- Multi-tenant: one user belongs to multiple shipowners (group account)
- AR/PT/SW translations
- AIS-global discovery (`feature.ais_global_enabled`)
- Equasis scraper (`feature.equasis_scraper_enabled`)
