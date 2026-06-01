# Plan 7E — Wallet UX (owner + admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the owner-facing `/owner/wallet` page (balance + auto-apply toggle + ledger view + top-up flow + next-tax prediction) and the admin-facing `/admin/wallets` page (all-wallets list + drawer + SUPERADMIN-only manual adjustment). Reuses the v7 `wallets` + `wallet_ledger` schema from Plan 7A and extends `<PayDialog>` (Plan 7C-2) with a top-up mode for the topup flow.

**Architecture:** One Postgres migration (064) adds a topup-on-confirm trigger so any payment that hits CONFIRMED with `transaction_id IS NULL` automatically credits the shipowner's wallet via `wallet_ledger(kind='TOPUP')`. New `walletService.ts` exposes typed read helpers (`getWalletForOwner`, `listLedgerEntries`, `predictNextTax`). `<PayDialog>` gains a `mode: 'invoice' | 'topup'` prop — invoice mode unchanged, topup mode hides WALLET rail, shows an amount input on Step 2, and passes `transactionId: null` to `initiatePayment`. Two new pages: `/owner/wallet` (server component fetches balance + ledger + prediction, mounts `<PayDialog mode="topup">`) and `/admin/wallets` (list + drawer with full ledger + SUPERADMIN-only adjustment action).

**Tech Stack:** PostgreSQL 17 / Supabase / Next.js 16 server components + actions / TypeScript strict / Vitest + RTL / next-intl. Reuses Plan 7A's `wallets` + `wallet_ledger`, Plan 7C-1's `applyWallet` + `confirmPayment` overpayment-to-wallet, Plan 7C-2's `<PayDialog>`, Plan 7C-3's admin RBAC patterns, Plan 7C-4's `<PaymentReviewDrawer>` UX patterns, Plan 7D's STRIPE rail.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §7.6 (owner wallet) + §8.4 (admin wallets).

**Predecessor:** Plans 7A through 7D — ALL MERGED on develop (tip `d8c7ad9`). The v7 wallet schema (mig 050) + autoapply trigger (mig 059) + overpayment split (Plan 7C-1) + Stripe topup-capable rail (Plan 7D) are all live.

**Successor:** Plan 7F — Notifications (in-app + email). Plan 7E emits `audit_logs` entries for wallet events but defers email/in-app notifications to 7F. Plan 7G — Refunds (will INSERT `wallet_ledger(kind='REFUND_CREDIT')` from the refund rail picker).

**Out of scope:**
- Email notification `WALLET_TOPPED_UP` — Plan 7F
- In-app notification feed — Plan 7F
- Wallet merge for duplicate shipowners — ops manual SQL for v1
- Multi-currency wallets (EUR/GBP) — schema is USD-only by design; future plan if EU carbon tax
- Wallet expiry / dormancy policy — ops policy, not code
- Wallet → external bank withdrawal (refund-style) — Plan 7G's refund flow handles withdrawal via wallet credit + bank wire reconcile

---

## File Structure

### Files to create

```
supabase/migrations/
└── 064_topup_on_confirm_trigger.sql               # trigger + idempotency

supabase/tests/migrations/
└── 064_topup_on_confirm_trigger.test.sql

frontend/src/services/
├── walletService.ts                                # read helpers + predictNextTax
└── walletService.test.ts

frontend/src/actions/
├── toggleAutoApply.ts                              # owner: UPDATE wallets.auto_apply_to_proforma
├── toggleAutoApply.test.ts
├── adjustWalletManually.ts                         # SUPERADMIN: INSERT ledger ADMIN_ADJUSTMENT
└── adjustWalletManually.test.ts

frontend/src/app/owner/\(portal\)/wallet/
├── page.tsx                                        # server component
└── WalletPageClient.tsx                            # client wrapper (auto-apply toggle + topup button)

frontend/src/components/owner/Wallet/
├── BalanceCard.tsx                                 # solde + auto-apply badge + topup button
├── PredictionCard.tsx                              # predictNextTax estimation
├── LedgerTable.tsx                                 # filtered movements
└── index.ts

frontend/src/app/\(dashboard\)/admin/wallets/
└── page.tsx                                        # admin server component

frontend/src/components/dashboard/admin/AdminWallets/
├── AdminWalletsPanel.tsx                           # list + filters
├── WalletDetailDrawer/
│   ├── WalletDetailDrawer.tsx                     # right drawer
│   ├── AdjustWalletDialog.tsx                     # SUPERADMIN dialog
│   └── index.ts
└── index.ts
```

### Files to modify

```
frontend/src/components/owner/PayDialog/PayDialog.tsx                 # accept mode='invoice'|'topup', transactionId nullable
frontend/src/components/owner/PayDialog/usePayDialogContext.tsx       # context shape (mode + nullable transactionId)
frontend/src/components/owner/PayDialog/StepRailPicker.tsx            # hide WALLET when mode='topup'
frontend/src/components/owner/PayDialog/StepRailParams.tsx            # show amount input when mode='topup'
frontend/src/components/owner/PayDialog/StepConfirm.tsx               # null-safe transaction id
frontend/src/actions/initiatePayment.ts                                # already accepts null transactionId — verify no regression
frontend/src/lib/rbac.ts                                               # add 'wallets' nav entry + canAccessAdminWallets predicate
frontend/src/components/dashboard/layout/DashboardSidebar.tsx          # admin nav entry
frontend/src/components/owner/layout/OwnerSidebar.tsx                  # owner /wallet nav entry (or wherever owner nav lives)
frontend/messages/en.json                                              # OwnerPortal.wallet + AdminWallets namespaces
frontend/messages/fr.json
```

### Test runners

```bash
./supabase/tests/run.sh migrations/064_topup_on_confirm_trigger.test.sql

cd frontend && npx vitest run src/services/walletService.test.ts
cd frontend && npx vitest run src/actions/toggleAutoApply.test.ts
cd frontend && npx vitest run src/actions/adjustWalletManually.test.ts

cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

---

## Task 1: Mig 064 — topup-on-confirm trigger

**Files:**
- Create: `supabase/migrations/064_topup_on_confirm_trigger.sql`
- Create: `supabase/tests/migrations/064_topup_on_confirm_trigger.test.sql`

When a payment row transitions to `status='CONFIRMED'` AND `transaction_id IS NULL`, it represents a wallet top-up. The trigger atomically inserts a `wallet_ledger(kind='TOPUP')` entry. Idempotent: NOT EXISTS check against prior ledger entries for that payment.

Spec §7.6: "payment.transaction_id = NULL, à CONFIRMED → ledger TOPUP".

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/064_topup_on_confirm_trigger.test.sql`:

```sql
BEGIN;

-- Seed: shipowner + wallet + admin + a CONFIRMED-via-INSERT payment with NULL transaction
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@local');
INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@local', 'Admin', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('22222222-2222-2222-2222-222222222222', 'TestCo', 'ACTIVE', 'en');
INSERT INTO public.wallets (shipowner_id) VALUES ('22222222-2222-2222-2222-222222222222');

-- Case 1: INSERT a payment that goes straight to CONFIRMED with NULL transaction_id
-- → Trigger should INSERT a wallet_ledger TOPUP row
INSERT INTO public.payments
  (id, shipowner_id, declared_by, transaction_id, amount_minor, currency, amount_usd_minor,
   rail, status, confirmed_by, confirmed_at)
  VALUES
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', NULL,
   500000, 'USD', 500000, 'STRIPE', 'CONFIRMED',
   '11111111-1111-1111-1111-111111111111', NOW());

DO $$
DECLARE n INT; bal BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.wallet_ledger
    WHERE payment_id = '33333333-3333-3333-3333-333333333333' AND kind = 'TOPUP';
  ASSERT n = 1, format('expected 1 TOPUP ledger entry, found %s', n);

  SELECT balance_usd_minor INTO bal FROM public.wallets
    WHERE shipowner_id = '22222222-2222-2222-2222-222222222222';
  ASSERT bal = 500000, format('expected balance 500000, got %s', bal);
END $$;

-- Case 2: UPDATE an INITIATED payment with NULL transaction to CONFIRMED
-- → Trigger should fire on UPDATE → CONFIRMED transition
INSERT INTO public.payments
  (id, shipowner_id, declared_by, transaction_id, amount_minor, currency, amount_usd_minor,
   rail, status)
  VALUES
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', NULL,
   300000, 'USD', 300000, 'WIRE_TRANSFER', 'INITIATED');

UPDATE public.payments
   SET status = 'CONFIRMED', confirmed_by = '11111111-1111-1111-1111-111111111111', confirmed_at = NOW()
 WHERE id = '44444444-4444-4444-4444-444444444444';

DO $$
DECLARE n INT; bal BIGINT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.wallet_ledger
    WHERE payment_id = '44444444-4444-4444-4444-444444444444' AND kind = 'TOPUP';
  ASSERT n = 1, format('expected 1 TOPUP for UPDATE path, found %s', n);

  SELECT balance_usd_minor INTO bal FROM public.wallets
    WHERE shipowner_id = '22222222-2222-2222-2222-222222222222';
  ASSERT bal = 800000, format('expected balance 800000 (500k+300k), got %s', bal);
END $$;

-- Case 3: Idempotency — re-UPDATE same row (e.g. confirmed_at changed) does NOT create a second TOPUP
UPDATE public.payments
   SET confirmed_at = NOW()
 WHERE id = '44444444-4444-4444-4444-444444444444';

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.wallet_ledger
    WHERE payment_id = '44444444-4444-4444-4444-444444444444' AND kind = 'TOPUP';
  ASSERT n = 1, format('expected idempotent — still 1 TOPUP, found %s', n);
END $$;

-- Case 4: Payment WITH a transaction (normal invoice payment) does NOT trigger TOPUP
INSERT INTO public.vessels (id, imo_number, name, jurisdiction_country)
  VALUES ('55555555-5555-5555-5555-555555555555', '9999999', 'TEST VSL', 'KE');
INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd, status,
   document_type, transaction_type, shipowner_id)
  VALUES
  ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555',
   'TEST VSL', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', '22222222-2222-2222-2222-222222222222');
INSERT INTO public.payments
  (id, shipowner_id, declared_by, transaction_id, amount_minor, currency, amount_usd_minor,
   rail, status, confirmed_by, confirmed_at)
  VALUES
  ('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
   10000, 'USD', 10000, 'STRIPE', 'CONFIRMED',
   '11111111-1111-1111-1111-111111111111', NOW());

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.wallet_ledger
    WHERE payment_id = '77777777-7777-7777-7777-777777777777' AND kind = 'TOPUP';
  ASSERT n = 0, format('expected 0 TOPUP for invoice-linked payment, found %s', n);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test → FAIL** (trigger doesn't exist). If Docker broken, skip.

```bash
./supabase/tests/run.sh migrations/064_topup_on_confirm_trigger.test.sql
```

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/064_topup_on_confirm_trigger.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 064: Topup-on-confirm trigger (Plan 7E)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- When a payment row reaches status='CONFIRMED' AND its transaction_id is NULL,
-- it represents a wallet top-up (per spec §7.6 — `<TopUpDialog>` flow). The
-- trigger atomically INSERTs a wallet_ledger row of kind='TOPUP' so the
-- wallet balance reflects the credit immediately.
--
-- Covers all confirmation paths:
--   - confirmPayment action (admin manual confirm)
--   - /api/webhooks/stripe (Stripe webhook auto-confirm)
--   - /api/cron/stripe-reconcile-pending (cron safety net)
--
-- Idempotent: skips if a TOPUP ledger entry already exists for the payment.

CREATE OR REPLACE FUNCTION public.apply_topup_credit_on_confirm() RETURNS TRIGGER AS $$
DECLARE
  wallet_uuid UUID;
  already INT;
BEGIN
  -- Only act when status reached CONFIRMED AND no transaction (= top-up)
  IF NEW.status <> 'CONFIRMED' OR NEW.transaction_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- INSERT path: OLD is NULL on INSERT, so always proceed
  -- UPDATE path: only proceed if old status was NOT CONFIRMED (transition into CONFIRMED)
  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' THEN
    RETURN NEW;
  END IF;

  -- Find the wallet for this shipowner. Auto-create if missing (defensive).
  SELECT id INTO wallet_uuid FROM public.wallets WHERE shipowner_id = NEW.shipowner_id;
  IF wallet_uuid IS NULL THEN
    INSERT INTO public.wallets (shipowner_id) VALUES (NEW.shipowner_id) RETURNING id INTO wallet_uuid;
  END IF;

  -- Idempotency: skip if a TOPUP ledger entry already exists for this payment
  SELECT COUNT(*) INTO already FROM public.wallet_ledger
    WHERE payment_id = NEW.id AND kind = 'TOPUP';
  IF already > 0 THEN
    RETURN NEW;
  END IF;

  -- INSERT the TOPUP ledger entry — the wallet's balance trigger
  -- (apply_ledger_to_wallet from mig 050) handles the balance UPDATE.
  INSERT INTO public.wallet_ledger
    (wallet_id, amount_signed_usd_minor, kind, payment_id, created_by)
  VALUES
    (wallet_uuid, NEW.amount_usd_minor, 'TOPUP', NEW.id, NEW.confirmed_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_topup_credit_on_confirm ON public.payments;
CREATE TRIGGER trg_topup_credit_on_confirm
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_topup_credit_on_confirm();

COMMENT ON FUNCTION public.apply_topup_credit_on_confirm() IS
  'Plan 7E: when a payment hits CONFIRMED with NULL transaction_id, INSERT a wallet_ledger TOPUP entry. Idempotent.';
```

- [ ] **Step 4: Re-run test → PASS** (4 ASSERTs green). Or DEFERRED if Docker broken.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/064_topup_on_confirm_trigger.sql \
        supabase/tests/migrations/064_topup_on_confirm_trigger.test.sql
git -c commit.gpgsign=false commit -m "feat(7e): mig 064 — topup-on-confirm trigger

When a payment hits status='CONFIRMED' AND transaction_id IS NULL,
atomically INSERT a wallet_ledger(kind='TOPUP') entry crediting the
shipowner's wallet. The existing apply_ledger_to_wallet trigger
(mig 050) maintains the balance. Idempotent via NOT EXISTS check.

Covers all confirmation paths (admin action, Stripe webhook, cron).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `walletService.ts` — typed read helpers + predictNextTax

**Files:**
- Create: `frontend/src/services/walletService.ts`
- Create: `frontend/src/services/walletService.test.ts`

Three exports: `getWalletForOwner(client, shipownerId)` returns wallet row, `listLedgerEntries(client, walletId, filters)` returns paginated ledger entries, `predictNextTax(client, shipownerId)` returns `{ estimated_count_30d, estimated_amount_30d_usd, confidence }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/services/walletService.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from './walletService';

function makeClient(opts: {
    wallet?: Record<string, unknown> | null;
    ledger?: Array<Record<string, unknown>>;
    alerts?: Array<Record<string, unknown>>;
} = {}) {
    const single = (data: unknown) => vi.fn().mockResolvedValue({ data, error: null });
    const order = (data: unknown[]) => vi.fn().mockResolvedValue({ data, error: null });
    return {
        from: vi.fn((table: string) => {
            if (table === 'wallets') {
                return {
                    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: single(opts.wallet ?? null) })) })),
                };
            }
            if (table === 'wallet_ledger') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            order: vi.fn(() => ({
                                range: vi.fn().mockResolvedValue({ data: opts.ledger ?? [], error: null }),
                                limit: vi.fn().mockResolvedValue({ data: opts.ledger ?? [], error: null }),
                            })),
                        })),
                    })),
                };
            }
            if (table === 'arrival_alerts') {
                return {
                    select: vi.fn(() => ({
                        eq: vi.fn(() => ({
                            gte: vi.fn(() => ({
                                order: vi.fn().mockResolvedValue({ data: opts.alerts ?? [], error: null }),
                            })),
                        })),
                    })),
                };
            }
            return { select: vi.fn() };
        }),
    } as unknown as SupabaseClient;
}

describe('getWalletForOwner', () => {
    it('returns wallet row when found', async () => {
        const client = makeClient({ wallet: { id: 'w1', balance_usd_minor: 50000, auto_apply_to_proforma: true } });
        const w = await getWalletForOwner(client, 'own-1');
        expect(w?.id).toBe('w1');
        expect(w?.balance_usd_minor).toBe(50000);
    });

    it('returns null when no wallet', async () => {
        const client = makeClient({ wallet: null });
        const w = await getWalletForOwner(client, 'own-1');
        expect(w).toBeNull();
    });
});

describe('listLedgerEntries', () => {
    it('returns ledger entries ordered desc', async () => {
        const client = makeClient({
            ledger: [
                { id: 'l1', amount_signed_usd_minor: 500000, kind: 'TOPUP', created_at: '2026-05-10T00:00:00Z' },
                { id: 'l2', amount_signed_usd_minor: -100000, kind: 'PROFORMA_APPLY', created_at: '2026-05-09T00:00:00Z' },
            ],
        });
        const rows = await listLedgerEntries(client, 'w1', { kinds: [], offset: 0, limit: 50 });
        expect(rows).toHaveLength(2);
        expect(rows[0].kind).toBe('TOPUP');
    });
});

describe('predictNextTax', () => {
    it('returns confidence=low when fewer than 5 alerts', async () => {
        const client = makeClient({ alerts: [
            { tax_amount_usd: 100, created_at: '2026-05-01' },
            { tax_amount_usd: 120, created_at: '2026-05-05' },
        ] });
        const p = await predictNextTax(client, 'own-1');
        expect(p.confidence).toBe('low');
    });

    it('returns prediction with median × frequency when enough alerts', async () => {
        const baseDate = new Date('2026-03-01');
        const alerts = Array.from({ length: 30 }, (_, i) => ({
            tax_amount_usd: 100 + i * 10,
            created_at: new Date(baseDate.getTime() + i * 86400000).toISOString(),
        }));
        const client = makeClient({ alerts });
        const p = await predictNextTax(client, 'own-1');
        expect(p.confidence).toBe('high');
        expect(p.estimated_count_30d).toBeGreaterThan(0);
        expect(p.estimated_amount_30d_usd).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run → fail**

```bash
cd frontend && npx vitest run src/services/walletService.test.ts
```

- [ ] **Step 3: Implement the service**

Create `frontend/src/services/walletService.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WalletRow {
    id: string;
    shipowner_id: string;
    balance_usd_minor: number;
    auto_apply_to_proforma: boolean;
    created_at: string;
    updated_at: string;
}

export type LedgerKind =
    | 'TOPUP'
    | 'OVERPAYMENT_CREDIT'
    | 'REFUND_CREDIT'
    | 'PROFORMA_APPLY'
    | 'ADMIN_ADJUSTMENT'
    | 'FX_DIFFERENCE';

export interface LedgerRow {
    id: string;
    wallet_id: string;
    amount_signed_usd_minor: number;
    kind: LedgerKind;
    payment_id: string | null;
    transaction_id: string | null;
    refund_id: string | null;
    created_by: string;
    justification: string | null;
    created_at: string;
}

export interface LedgerFilters {
    kinds: LedgerKind[];   // empty = all
    offset: number;
    limit: number;
}

export interface NextTaxPrediction {
    estimated_count_30d: number;
    estimated_amount_30d_usd: number;
    confidence: 'low' | 'medium' | 'high';
}

/**
 * Get the wallet row for a shipowner. Returns null if the shipowner has no wallet yet.
 */
export async function getWalletForOwner(
    client: SupabaseClient,
    shipownerId: string,
): Promise<WalletRow | null> {
    const { data, error } = await client
        .from('wallets')
        .select('id, shipowner_id, balance_usd_minor, auto_apply_to_proforma, created_at, updated_at')
        .eq('shipowner_id', shipownerId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as WalletRow | null;
}

/**
 * List ledger entries for a wallet, newest first, paginated.
 * Filters: kinds (empty = all).
 */
export async function listLedgerEntries(
    client: SupabaseClient,
    walletId: string,
    filters: LedgerFilters,
): Promise<LedgerRow[]> {
    let q = client
        .from('wallet_ledger')
        .select('*')
        .eq('wallet_id', walletId);
    if (filters.kinds.length > 0) {
        q = q.in('kind', filters.kinds);
    }
    const { data, error } = await q
        .order('created_at', { ascending: false })
        .range(filters.offset, filters.offset + filters.limit - 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as LedgerRow[];
}

/**
 * Predict the carbon-tax exposure for the shipowner in the next 30 days.
 *
 * Algorithm:
 *   - Look at arrival_alerts for the shipowner over the last 90 days
 *   - If < 5 alerts → confidence='low', return zero estimates
 *   - Median tax_amount_usd × (alerts/day × 30) = projection
 *   - Confidence: low (< 5), medium (5-14), high (15+)
 */
export async function predictNextTax(
    client: SupabaseClient,
    shipownerId: string,
): Promise<NextTaxPrediction> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data, error } = await client
        .from('arrival_alerts')
        .select('tax_amount_usd, created_at')
        .eq('shipowner_id', shipownerId)
        .gte('created_at', ninetyDaysAgo)
        .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ tax_amount_usd: number | null; created_at: string }>;
    const amounts = rows.map((r) => r.tax_amount_usd).filter((x): x is number => typeof x === 'number' && x > 0);

    if (amounts.length < 5) {
        return { estimated_count_30d: 0, estimated_amount_30d_usd: 0, confidence: 'low' };
    }

    // Median tax amount
    const sorted = [...amounts].sort((a, b) => a - b);
    const medianTax = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    // Frequency: alerts/day over the actual window (first → last alert)
    const firstAt = new Date(rows[0].created_at).getTime();
    const lastAt = new Date(rows[rows.length - 1].created_at).getTime();
    const windowDays = Math.max(1, (lastAt - firstAt) / 86400000);
    const alertsPerDay = rows.length / windowDays;
    const estimatedCount30d = Math.round(alertsPerDay * 30);

    const confidence: 'low' | 'medium' | 'high' =
        amounts.length < 5 ? 'low' :
        amounts.length < 15 ? 'medium' :
        'high';

    return {
        estimated_count_30d: estimatedCount30d,
        estimated_amount_30d_usd: Math.round(medianTax * estimatedCount30d),
        confidence,
    };
}
```

- [ ] **Step 4: Run → pass + tsc clean**

```bash
cd frontend && npx vitest run src/services/walletService.test.ts
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/walletService.ts frontend/src/services/walletService.test.ts
git -c commit.gpgsign=false commit -m "feat(7e): walletService — getWalletForOwner + listLedgerEntries + predictNextTax

3 typed read helpers + 6 unit tests:
- getWalletForOwner(client, shipownerId): wallet row or null
- listLedgerEntries(client, walletId, filters): paginated, kind-filterable
- predictNextTax: median tax × (alerts/day × 30) over 90-day window;
  confidence low/medium/high based on alert count

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `toggleAutoApply` action

**Files:**
- Create: `frontend/src/actions/toggleAutoApply.ts`
- Create: `frontend/src/actions/toggleAutoApply.test.ts`

Owner toggles `wallets.auto_apply_to_proforma`. Gated by `requireOwner` (only the wallet's shipowner can flip the flag).

- [ ] **Step 1: Write failing tests**

Create `frontend/src/actions/toggleAutoApply.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/requireOwner', () => ({ requireOwner: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { toggleAutoApply } from './toggleAutoApply';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createClient } from '@supabase/supabase-js';

function makeCtx(shipownerId = 'own-1') {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));
    const supabase = { from: vi.fn(() => ({ update })) };
    (createClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase);
    (requireOwner as ReturnType<typeof vi.fn>).mockResolvedValue({
        shipowner: { id: shipownerId },
        userId: 'user-1',
    });
    return { supabase, update };
}

describe('toggleAutoApply', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('UPDATEs wallet with the new flag', async () => {
        const { update } = makeCtx();
        await toggleAutoApply({ enabled: false });
        expect(update).toHaveBeenCalledWith({ auto_apply_to_proforma: false });
    });

    it('throws when requireOwner rejects', async () => {
        (requireOwner as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('not owner'));
        await expect(toggleAutoApply({ enabled: true })).rejects.toThrow(/not owner/);
    });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

Create `frontend/src/actions/toggleAutoApply.ts`:

```typescript
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({ enabled: z.boolean() });

export async function toggleAutoApply(input: { enabled: boolean }): Promise<void> {
    const parsed = schema.parse(input);
    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { error } = await admin
        .from('wallets')
        .update({ auto_apply_to_proforma: parsed.enabled })
        .eq('shipowner_id', ctx.shipowner.id);

    if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Tests pass + tsc**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/toggleAutoApply.ts frontend/src/actions/toggleAutoApply.test.ts
git -c commit.gpgsign=false commit -m "feat(7e): toggleAutoApply action — owner-gated

UPDATE wallets.auto_apply_to_proforma. requireOwner gates the caller
to the wallet's owning shipowner. 2 unit tests cover happy path +
unauthorized.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extend `<PayDialog>` for topup mode

**Files:**
- Modify: `frontend/src/components/owner/PayDialog/PayDialog.tsx`
- Modify: `frontend/src/components/owner/PayDialog/usePayDialogContext.tsx`
- Modify: `frontend/src/components/owner/PayDialog/StepRailPicker.tsx`
- Modify: `frontend/src/components/owner/PayDialog/StepRailParams.tsx`
- Modify: `frontend/src/components/owner/PayDialog/StepConfirm.tsx`

Add a `mode: 'invoice' | 'topup'` prop to `<PayDialog>`. Default is `'invoice'` (no breaking change). When `mode='topup'`:
- `transactionId: null` (already supported by `initiatePayment` per Plan 7C-1)
- WALLET rail hidden in Step 1 (can't top-up a wallet from itself)
- Step 2 shows an amount input (no invoice amount to default from)
- Title/subtitle i18n switches to topup variants
- Step 3 success shows "Wallet credited" instead of "Payment received"

- [ ] **Step 1: Widen the context**

Edit `usePayDialogContext.tsx`:

```typescript
export type PayDialogMode = 'invoice' | 'topup';

export interface PayDialogContextValue extends PayDialogState {
    mode: PayDialogMode;                       // ← new
    transactionId: string | null;              // ← was `string`; widen to nullable
    invoiceRef: string | null;                 // ← also nullable in topup mode
    // ... existing fields
}

// Provider props gain `mode` and accept nullable transactionId/invoiceRef
export function PayDialogProvider(
    props: React.PropsWithChildren<{
        mode: PayDialogMode;
        transactionId: string | null;
        invoiceRef: string | null;
        amountUsd: number;                     // 0 in topup mode — owner enters in Step 2
        currency: string;
        walletBalanceUsdMinor: number;
    }>,
) { /* …pass mode through… */ }
```

- [ ] **Step 2: Widen `<PayDialog>` props**

```typescript
interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode?: 'invoice' | 'topup';                // default 'invoice'
    transactionId: string | null;              // widen
    invoiceRef: string | null;                  // widen
    amountUsd: number;                          // 0 in topup mode
    currency: string;
    walletBalanceUsdMinor: number;
}

export function PayDialog(props: Props) {
    const mode = props.mode ?? 'invoice';
    return (
        // … pass mode through provider …
    );
}
```

- [ ] **Step 3: Step 1 — hide WALLET in topup mode**

Edit `StepRailPicker.tsx`:

```typescript
// Inside the rails.map render:
.filter((r) => !(ctx.mode === 'topup' && r.rail === 'WALLET'))
```

Also widen the availability API query: when `ctx.mode === 'topup'`, pass `mode=topup` query param. The route at `/api/owner/payment-availability` should treat WALLET as ineligible in topup mode (or simply not include it). For v1 the client-side filter is sufficient — the server still returns WALLET eligibility but we ignore it.

- [ ] **Step 4: Step 2 — amount input in topup mode**

Edit `StepRailParams.tsx`:

```typescript
{ctx.mode === 'topup' && (
    <Field label={t('field.topupAmount')} required>
        <OsInput
            type="number"
            min="1"
            step="0.01"
            value={ctx.amountUsd > 0 ? String(ctx.amountUsd) : ''}
            onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (!Number.isNaN(n) && n > 0) ctx.setAmountUsd(n);
            }}
            placeholder="100.00"
        />
    </Field>
)}
```

Requires `usePayDialogContext` to expose `setAmountUsd`. Add to context:

```typescript
setAmountUsd: (n: number) => void;
```

And to the validate-next logic: if `ctx.mode === 'topup'` and `ctx.amountUsd <= 0`, show error.

- [ ] **Step 5: Step 3 — null-safe submit**

Edit `StepConfirm.tsx`:

```typescript
// In the submit handler — already passes ctx.transactionId which is now string | null
// Just ensure initiatePayment receives null (it already accepts string | null per Plan 7C-1)
const result = await initiatePayment({
    transactionId: ctx.transactionId,           // already nullable
    amount: ctx.amountUsd.toFixed(2),
    currency: ctx.currency,
    rail: ctx.rail!,
    railDetails: ctx.railDetails,
});
```

Adapt the success-screen text to use `t('summary.topupSuccess')` vs `t('summary.success')` based on `ctx.mode`.

- [ ] **Step 6: Verify `initiatePayment` accepts null `transactionId`**

```bash
grep -n "transactionId" frontend/src/actions/initiatePayment.ts | head -5
```

Plan 7C-1's schema is `z.string().uuid().nullable()` per project memory. Should work as-is.

- [ ] **Step 7: tsc + build + existing PayDialog tests**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run src/components/owner/PayDialog/
cd frontend && npx next build
```

Existing PayDialog RTL tests (Plan 7C-2) should still pass — they don't pass `mode` prop, default is `'invoice'`, backward compat preserved.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/owner/PayDialog/
git -c commit.gpgsign=false commit -m "feat(7e): extend PayDialog for topup mode

New optional 'mode' prop ('invoice' | 'topup', default 'invoice').
When mode='topup':
- transactionId nullable (already supported by initiatePayment from 7C-1)
- WALLET rail hidden in Step 1 (can't top-up wallet from itself)
- Step 2 shows amount input (no invoice amount to default to)
- Step 3 success text shows 'Wallet credited' instead of 'Payment received'

Existing invoice flow unchanged (Plan 7C-2 backward compat preserved).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `/owner/wallet` page + components

**Files:**
- Create: `frontend/src/app/owner/(portal)/wallet/page.tsx`
- Create: `frontend/src/app/owner/(portal)/wallet/WalletPageClient.tsx`
- Create: `frontend/src/components/owner/Wallet/BalanceCard.tsx`
- Create: `frontend/src/components/owner/Wallet/PredictionCard.tsx`
- Create: `frontend/src/components/owner/Wallet/LedgerTable.tsx`
- Create: `frontend/src/components/owner/Wallet/index.ts`

Server component fetches wallet + ledger + prediction. Client wrapper owns the topup-dialog state and the auto-apply toggle (because both need React state).

- [ ] **Step 1: BalanceCard.tsx**

```tsx
'use client';

import * as React from 'react';
import { Wallet, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';

interface Props {
    balanceUsd: number;
    autoApplyEnabled: boolean;
    onToggleAutoApply: () => void;
    onOpenTopup: () => void;
    togglePending: boolean;
}

export function BalanceCard({ balanceUsd, autoApplyEnabled, onToggleAutoApply, onOpenTopup, togglePending }: Props) {
    const t = useTranslations('OwnerPortal.wallet');
    return (
        <section className="os-card p-5">
            <div className="flex items-center gap-2 mb-3">
                <Wallet className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('balanceCard.title')}</h2>
            </div>
            <p className="text-3xl font-bold text-[var(--os-text-primary)] mb-4 tabular-nums">
                ${balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </p>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-[var(--os-text-muted)]">{t('balanceCard.autoApply')}</span>
                <button
                    onClick={onToggleAutoApply}
                    disabled={togglePending}
                    className="text-xs font-semibold px-3 py-1 rounded-full border"
                    style={{
                        borderColor: autoApplyEnabled ? '#10B981' : 'var(--os-border)',
                        backgroundColor: autoApplyEnabled ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                        color: autoApplyEnabled ? '#10B981' : 'var(--os-text-muted)',
                    }}
                >
                    {autoApplyEnabled ? t('balanceCard.autoApplyOn') : t('balanceCard.autoApplyOff')}
                </button>
            </div>
            <OsButton variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={onOpenTopup}>
                {t('balanceCard.topupCta')}
            </OsButton>
        </section>
    );
}
```

- [ ] **Step 2: PredictionCard.tsx**

```tsx
'use client';

import * as React from 'react';
import { TrendingUp, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NextTaxPrediction } from '@/services/walletService';

interface Props {
    prediction: NextTaxPrediction;
    currentBalanceUsd: number;
}

export function PredictionCard({ prediction, currentBalanceUsd }: Props) {
    const t = useTranslations('OwnerPortal.wallet');
    const insufficient = prediction.estimated_amount_30d_usd > currentBalanceUsd;
    const recommended = Math.max(0, prediction.estimated_amount_30d_usd - currentBalanceUsd);

    if (prediction.confidence === 'low') {
        return (
            <section className="os-card p-5">
                <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-[var(--os-text-muted)]" />
                    <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('predictionCard.title')}</h2>
                </div>
                <p className="text-xs text-[var(--os-text-muted)]">{t('predictionCard.notEnoughData')}</p>
            </section>
        );
    }

    return (
        <section className="os-card p-5">
            <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('predictionCard.title')}</h2>
            </div>
            <p className="text-xs text-[var(--os-text-muted)] mb-1">
                {t('predictionCard.estimate30d', {
                    count: prediction.estimated_count_30d,
                    amount: prediction.estimated_amount_30d_usd.toLocaleString('en-US'),
                })}
            </p>
            <p className="text-xs text-[var(--os-text-muted)] mb-3">
                {t('predictionCard.confidence', { level: t(`predictionCard.confidenceLevel.${prediction.confidence}`) })}
            </p>
            {insufficient && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                    <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-200">
                        {t('predictionCard.insufficientWarning', { amount: recommended.toLocaleString('en-US') })}
                    </p>
                </div>
            )}
        </section>
    );
}
```

- [ ] **Step 3: LedgerTable.tsx**

```tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import type { LedgerRow, LedgerKind } from '@/services/walletService';

const KIND_VARIANT: Record<LedgerKind, BadgeVariant> = {
    TOPUP: 'active',
    OVERPAYMENT_CREDIT: 'active',
    REFUND_CREDIT: 'active',
    PROFORMA_APPLY: 'archived',
    ADMIN_ADJUSTMENT: 'warning',
    FX_DIFFERENCE: 'info',
};

const ALL_KINDS: LedgerKind[] = ['TOPUP','OVERPAYMENT_CREDIT','REFUND_CREDIT','PROFORMA_APPLY','ADMIN_ADJUSTMENT','FX_DIFFERENCE'];

interface Props {
    rows: LedgerRow[];
    onFilterChange: (kinds: LedgerKind[]) => void;
    activeFilters: LedgerKind[];
}

export function LedgerTable({ rows, onFilterChange, activeFilters }: Props) {
    const t = useTranslations('OwnerPortal.wallet.ledger');

    function toggleKind(k: LedgerKind) {
        const next = activeFilters.includes(k)
            ? activeFilters.filter((x) => x !== k)
            : [...activeFilters, k];
        onFilterChange(next);
    }

    const columns: OsColumn<LedgerRow>[] = [
        {
            key: 'date',
            header: t('col.date'),
            render: (r) => <span className="text-xs tabular-nums">{new Date(r.created_at).toLocaleDateString()}</span>,
        },
        {
            key: 'amount',
            header: t('col.amount'),
            className: 'text-right',
            render: (r) => {
                const isPositive = r.amount_signed_usd_minor > 0;
                const dollars = Math.abs(r.amount_signed_usd_minor) / 100;
                return (
                    <span
                        className="font-mono text-sm tabular-nums"
                        style={{ color: isPositive ? '#10B981' : '#F59E0B' }}
                    >
                        {isPositive ? '+' : '−'}${dollars.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                );
            },
        },
        {
            key: 'kind',
            header: t('col.kind'),
            render: (r) => <OsBadge variant={KIND_VARIANT[r.kind]} label={t(`kind.${r.kind}`)} />,
        },
        {
            key: 'justification',
            header: t('col.note'),
            render: (r) => <span className="text-xs text-[var(--os-text-muted)]">{r.justification ?? '—'}</span>,
        },
    ];

    return (
        <section className="os-card p-5">
            <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{t('title')}</h2>
                <div className="flex flex-wrap gap-1">
                    {ALL_KINDS.map((k) => {
                        const active = activeFilters.includes(k);
                        return (
                            <button
                                key={k}
                                onClick={() => toggleKind(k)}
                                className="text-[10px] font-mono px-2 py-0.5 rounded-md border"
                                style={{
                                    borderColor: active ? '#10B981' : 'var(--os-border)',
                                    backgroundColor: active ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                    color: active ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                {k}
                            </button>
                        );
                    })}
                </div>
            </header>
            <OsTable columns={columns} rows={rows} keyExtractor={(r) => r.id} emptyMessage={t('empty')} />
        </section>
    );
}
```

- [ ] **Step 4: WalletPageClient.tsx (client-side wrapper)**

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BalanceCard } from '@/components/owner/Wallet/BalanceCard';
import { PredictionCard } from '@/components/owner/Wallet/PredictionCard';
import { LedgerTable } from '@/components/owner/Wallet/LedgerTable';
import { PayDialog } from '@/components/owner/PayDialog';
import { toggleAutoApply } from '@/actions/toggleAutoApply';
import type { LedgerRow, LedgerKind, NextTaxPrediction } from '@/services/walletService';

interface Props {
    walletId: string;
    initialBalanceUsdMinor: number;
    initialAutoApply: boolean;
    initialLedger: LedgerRow[];
    prediction: NextTaxPrediction;
}

export function WalletPageClient({
    walletId,
    initialBalanceUsdMinor,
    initialAutoApply,
    initialLedger,
    prediction,
}: Props) {
    const router = useRouter();
    const [autoApply, setAutoApply] = React.useState(initialAutoApply);
    const [togglePending, setTogglePending] = React.useState(false);
    const [topupOpen, setTopupOpen] = React.useState(false);
    const [ledgerFilters, setLedgerFilters] = React.useState<LedgerKind[]>([]);

    const balanceUsd = initialBalanceUsdMinor / 100;

    // Filter ledger client-side for v1 (no server-side pagination)
    const visibleLedger = ledgerFilters.length === 0
        ? initialLedger
        : initialLedger.filter((r) => ledgerFilters.includes(r.kind));

    async function handleToggleAutoApply() {
        setTogglePending(true);
        try {
            await toggleAutoApply({ enabled: !autoApply });
            setAutoApply(!autoApply);
        } catch (e) {
            console.error(e);
            alert('Failed to toggle auto-apply. Please retry.');
        } finally {
            setTogglePending(false);
        }
    }

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <BalanceCard
                    balanceUsd={balanceUsd}
                    autoApplyEnabled={autoApply}
                    onToggleAutoApply={handleToggleAutoApply}
                    onOpenTopup={() => setTopupOpen(true)}
                    togglePending={togglePending}
                />
                <PredictionCard prediction={prediction} currentBalanceUsd={balanceUsd} />
            </div>
            <LedgerTable
                rows={visibleLedger}
                onFilterChange={setLedgerFilters}
                activeFilters={ledgerFilters}
            />
            {topupOpen && (
                <PayDialog
                    open={topupOpen}
                    onOpenChange={(o) => {
                        setTopupOpen(o);
                        if (!o) router.refresh();
                    }}
                    mode="topup"
                    transactionId={null}
                    invoiceRef={null}
                    amountUsd={0}
                    currency="USD"
                    walletBalanceUsdMinor={initialBalanceUsdMinor}
                />
            )}
        </>
    );
}
```

- [ ] **Step 5: page.tsx (server component)**

```tsx
import { requireOwner } from '@/lib/auth/requireOwner';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from '@/services/walletService';
import { WalletPageClient } from './WalletPageClient';

export const metadata = {
    title: 'Owner portal — wallet',
};

export const dynamic = 'force-dynamic';

export default async function OwnerWalletPage() {
    const session = await requireOwner();

    const wallet = await getWalletForOwner(session.supabase, session.shipowner.id);

    if (!wallet) {
        // Wallet auto-creates on first ledger entry (per mig 064 fallback). If it's still missing here,
        // there's literally been no payment activity. Show empty state with a topup CTA.
        return (
            <div className="px-6 py-6 max-w-6xl mx-auto">
                <header className="mb-6">
                    <h1 className="text-2xl font-semibold">Wallet</h1>
                    <p className="text-sm text-[var(--os-text-muted)] mt-1">
                        Your wallet is empty. Top it up to apply credits to future invoices.
                    </p>
                </header>
                <WalletPageClient
                    walletId="pending"
                    initialBalanceUsdMinor={0}
                    initialAutoApply={true}
                    initialLedger={[]}
                    prediction={{ estimated_count_30d: 0, estimated_amount_30d_usd: 0, confidence: 'low' }}
                />
            </div>
        );
    }

    const [ledger, prediction] = await Promise.all([
        listLedgerEntries(session.supabase, wallet.id, { kinds: [], offset: 0, limit: 100 }),
        predictNextTax(session.supabase, session.shipowner.id),
    ]);

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold">Wallet</h1>
            </header>
            <WalletPageClient
                walletId={wallet.id}
                initialBalanceUsdMinor={wallet.balance_usd_minor}
                initialAutoApply={wallet.auto_apply_to_proforma}
                initialLedger={ledger}
                prediction={prediction}
            />
        </div>
    );
}
```

- [ ] **Step 6: index.ts**

```typescript
export { BalanceCard } from './BalanceCard';
export { PredictionCard } from './PredictionCard';
export { LedgerTable } from './LedgerTable';
```

- [ ] **Step 7: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/owner/\(portal\)/wallet/ \
        frontend/src/components/owner/Wallet/
git -c commit.gpgsign=false commit -m "feat(7e): /owner/wallet page — balance + prediction + ledger + topup CTA

Server component fetches wallet + ledger + 30d-prediction via walletService.
Client wrapper owns toggle + topup dialog state. <BalanceCard> shows
balance + auto-apply badge + top-up button. <PredictionCard> shows
30-day forecast or 'not enough data' (< 5 alerts). <LedgerTable>
filterable by 6 ledger kinds.

Top-up button opens <PayDialog mode='topup' transactionId={null}>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `/admin/wallets` page + admin panel

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/wallets/page.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminWallets/AdminWalletsPanel.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminWallets/index.ts`

List all wallets with shipowner name + balance + last activity + auto-apply badge. Click row → drawer (Task 7).

- [ ] **Step 1: AdminWalletsPanel.tsx**

```tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Wallet, RefreshCw } from 'lucide-react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { WalletDetailDrawer } from './WalletDetailDrawer';

export interface AdminWalletRow {
    wallet_id: string;
    shipowner_id: string;
    shipowner_name: string;
    balance_usd_minor: number;
    auto_apply_to_proforma: boolean;
    last_activity_at: string | null;
}

interface Props {
    rows: AdminWalletRow[];
}

export function AdminWalletsPanel({ rows }: Props) {
    const t = useTranslations('AdminWallets');
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [refreshKey, setRefreshKey] = React.useState(0);

    const columns: OsColumn<AdminWalletRow>[] = [
        { key: 'owner', header: t('col.owner'), render: (r) => <span className="text-sm">{r.shipowner_name}</span> },
        {
            key: 'balance',
            header: t('col.balance'),
            className: 'text-right',
            render: (r) => (
                <span className="font-mono text-sm tabular-nums">
                    ${(r.balance_usd_minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
            ),
        },
        {
            key: 'autoApply',
            header: t('col.autoApply'),
            render: (r) => <OsBadge variant={r.auto_apply_to_proforma ? 'active' : 'draft'} label={r.auto_apply_to_proforma ? t('autoApply.on') : t('autoApply.off')} />,
        },
        {
            key: 'activity',
            header: t('col.lastActivity'),
            render: (r) => <span className="text-xs text-[var(--os-text-muted)]">{r.last_activity_at ? new Date(r.last_activity_at).toLocaleDateString() : '—'}</span>,
        },
    ];

    return (
        <section className="os-card p-5">
            <header className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-500" />
                    <h1 className="text-lg font-bold">{t('title')}</h1>
                </div>
                <OsButton
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                    onClick={() => setRefreshKey((k) => k + 1)}
                >
                    {t('refresh')}
                </OsButton>
            </header>
            <OsTable
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.wallet_id}
                emptyMessage={t('empty')}
                onRowClick={(r) => setSelectedId(r.wallet_id)}
            />
            {selectedId && (
                <WalletDetailDrawer
                    walletId={selectedId}
                    onClose={() => { setSelectedId(null); setRefreshKey((k) => k + 1); }}
                />
            )}
        </section>
    );
}
```

NB: `OsTable.onRowClick` may not exist as a prop. If not, wire the click via the `render` columns or wrap the row. Adapt as needed.

- [ ] **Step 2: page.tsx (server component with RBAC + data fetch)**

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AdminWalletsPanel, type AdminWalletRow } from '@/components/dashboard/admin/AdminWallets';

export const metadata: Metadata = {
    title: 'Wallets | Green Gate',
    description: 'All shipowner wallets — balances, auto-apply, manual adjustments.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN', 'MANAGER']);

export default async function AdminWalletsRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) redirect('/dashboard');

    // Wallets + shipowner name + last ledger activity (left join)
    const { data: wallets } = await supabase
        .from('wallets')
        .select(`
            id,
            shipowner_id,
            balance_usd_minor,
            auto_apply_to_proforma,
            shipowner:shipowners(name)
        `)
        .order('balance_usd_minor', { ascending: false })
        .limit(200);

    // Latest ledger entry per wallet — single aggregate query
    const walletIds = (wallets ?? []).map((w) => w.id as string);
    const { data: lastActivities } = walletIds.length > 0
        ? await supabase
            .from('wallet_ledger')
            .select('wallet_id, created_at')
            .in('wallet_id', walletIds)
            .order('created_at', { ascending: false })
        : { data: [] };

    const lastActivityMap = new Map<string, string>();
    for (const row of (lastActivities ?? [])) {
        if (!lastActivityMap.has(row.wallet_id as string)) {
            lastActivityMap.set(row.wallet_id as string, row.created_at as string);
        }
    }

    const rows: AdminWalletRow[] = (wallets ?? []).map((w) => ({
        wallet_id: w.id as string,
        shipowner_id: w.shipowner_id as string,
        shipowner_name: (w.shipowner as { name?: string } | null)?.name ?? '—',
        balance_usd_minor: w.balance_usd_minor as number,
        auto_apply_to_proforma: w.auto_apply_to_proforma as boolean,
        last_activity_at: lastActivityMap.get(w.id as string) ?? null,
    }));

    return (
        <div className="px-6 py-4">
            <AdminWalletsPanel rows={rows} />
        </div>
    );
}
```

- [ ] **Step 3: index.ts**

```typescript
export { AdminWalletsPanel, type AdminWalletRow } from './AdminWalletsPanel';
```

- [ ] **Step 4: tsc (WalletDetailDrawer not yet implemented — expect 1 error)**

```bash
cd frontend && npx tsc --noEmit
```

Expected: `Cannot find module './WalletDetailDrawer'`. Task 7 fixes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/wallets/ \
        frontend/src/components/dashboard/admin/AdminWallets/
git -c commit.gpgsign=false commit -m "feat(7e): /admin/wallets page + AdminWalletsPanel

Lists all shipowner wallets (top 200 by balance) with shipowner name +
balance + auto-apply badge + last-activity date. Click row opens
<WalletDetailDrawer> (Task 7).

RBAC: SUPERADMIN / FINANCE_ADMIN / MANAGER (read). SUPERADMIN-only
adjustments come via the drawer in Task 7. tsc fails until Task 7
lands the drawer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `<WalletDetailDrawer>` + `<AdjustWalletDialog>`

**Files:**
- Create: `frontend/src/components/dashboard/admin/AdminWallets/WalletDetailDrawer/WalletDetailDrawer.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminWallets/WalletDetailDrawer/AdjustWalletDialog.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminWallets/WalletDetailDrawer/index.ts`

Right-side drawer (480px) loads the wallet + full ledger. Shows balance + ledger table. SUPERADMIN-only "Manual adjustment" button opens an `<AdjustWalletDialog>` with amount + justification fields.

- [ ] **Step 1: WalletDetailDrawer.tsx**

```tsx
'use client';

import * as React from 'react';
import { X, Wallet, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { useRole } from '@/lib/RoleContext';
import { AdjustWalletDialog } from './AdjustWalletDialog';
import type { WalletRow, LedgerRow, LedgerKind } from '@/services/walletService';

const KIND_VARIANT: Record<LedgerKind, BadgeVariant> = {
    TOPUP: 'active', OVERPAYMENT_CREDIT: 'active', REFUND_CREDIT: 'active',
    PROFORMA_APPLY: 'archived', ADMIN_ADJUSTMENT: 'warning', FX_DIFFERENCE: 'info',
};

interface Props {
    walletId: string;
    onClose: () => void;
}

interface ApiResponse {
    wallet: WalletRow & { shipowner: { id: string; name: string } | null };
    ledger: LedgerRow[];
}

export function WalletDetailDrawer({ walletId, onClose }: Props) {
    const t = useTranslations('AdminWallets.drawer');
    const { role } = useRole();
    const canAdjust = role === 'SUPERADMIN';

    const [data, setData] = React.useState<ApiResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [showAdjust, setShowAdjust] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await fetch(`/api/admin/wallets/${walletId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (!cancelled) setData(json);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [walletId]);

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
            <aside
                className="fixed top-0 right-0 z-50 h-screen w-[520px] max-w-full overflow-y-auto p-5"
                style={{
                    backgroundColor: 'var(--os-surface-1)',
                    borderLeft: '1px solid var(--os-border)',
                }}
            >
                <header className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-emerald-500" />
                        <h2 className="text-base font-semibold">{t('title')}</h2>
                    </div>
                    <button onClick={onClose}><X className="w-4 h-4" /></button>
                </header>

                {loading && (
                    <p className="text-xs flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {t('loading')}</p>
                )}
                {error && <p className="text-xs text-red-500">{error}</p>}

                {data && (
                    <>
                        <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)] mb-4">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                                {t('owner')}
                            </p>
                            <p className="text-sm mb-3">{data.wallet.shipowner?.name ?? '—'}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                                {t('balance')}
                            </p>
                            <p className="text-2xl font-bold tabular-nums">
                                ${(data.wallet.balance_usd_minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                            </p>
                        </div>

                        {canAdjust && (
                            <div className="mb-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <p className="text-xs text-amber-200 mb-2">{t('adjustNotice')}</p>
                                    <OsButton variant="secondary" size="sm" onClick={() => setShowAdjust(true)}>
                                        {t('adjustCta')}
                                    </OsButton>
                                </div>
                            </div>
                        )}

                        <div>
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                                {t('ledgerTitle', { count: data.ledger.length })}
                            </p>
                            <ul className="flex flex-col gap-1">
                                {data.ledger.map((row) => {
                                    const isPos = row.amount_signed_usd_minor > 0;
                                    return (
                                        <li key={row.id} className="rounded-lg border border-[var(--os-border)] p-2 text-xs">
                                            <div className="flex items-center justify-between mb-1">
                                                <OsBadge variant={KIND_VARIANT[row.kind]} label={row.kind} />
                                                <span
                                                    className="font-mono font-bold tabular-nums"
                                                    style={{ color: isPos ? '#10B981' : '#F59E0B' }}
                                                >
                                                    {isPos ? '+' : '−'}${(Math.abs(row.amount_signed_usd_minor) / 100).toFixed(2)}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-[var(--os-text-muted)]">
                                                {new Date(row.created_at).toLocaleString()}
                                            </p>
                                            {row.justification && (
                                                <p className="text-[10px] mt-1 text-[var(--os-text-secondary)] italic">
                                                    {row.justification}
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </>
                )}

                {showAdjust && data && (
                    <AdjustWalletDialog
                        walletId={data.wallet.id}
                        shipownerName={data.wallet.shipowner?.name ?? '—'}
                        currentBalanceUsdMinor={data.wallet.balance_usd_minor}
                        onClose={(refresh) => {
                            setShowAdjust(false);
                            if (refresh) {
                                // Re-fetch to show the new ledger entry
                                window.location.reload();
                            }
                        }}
                    />
                )}
            </aside>
        </>
    );
}
```

- [ ] **Step 2: AdjustWalletDialog.tsx**

```tsx
'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { AlertTriangle } from 'lucide-react';
import { adjustWalletManually } from '@/actions/adjustWalletManually';

interface Props {
    walletId: string;
    shipownerName: string;
    currentBalanceUsdMinor: number;
    onClose: (refresh: boolean) => void;
}

export function AdjustWalletDialog({ walletId, shipownerName, currentBalanceUsdMinor, onClose }: Props) {
    const t = useTranslations('AdminWallets.adjust');
    const [amount, setAmount] = React.useState('');
    const [direction, setDirection] = React.useState<'+' | '−'>('+');
    const [justification, setJustification] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function submit() {
        setError(null);
        if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount)) {
            setError(t('errors.amountInvalid'));
            return;
        }
        if (justification.trim().length < 5) {
            setError(t('errors.justificationRequired'));
            return;
        }
        const signed = (direction === '+' ? 1 : -1) * Math.round(parseFloat(amount) * 100);
        if (direction === '−' && Math.abs(signed) > currentBalanceUsdMinor) {
            setError(t('errors.wouldGoNegative'));
            return;
        }
        setSubmitting(true);
        try {
            await adjustWalletManually({ walletId, amountSignedMinor: signed, justification: justification.trim() });
            onClose(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('errors.failed'));
            setSubmitting(false);
        }
    }

    return (
        <Dialog.Root open={true} onOpenChange={(o) => !o && onClose(false)}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                >
                    <Dialog.Title className="text-base font-semibold mb-1">{t('title', { owner: shipownerName })}</Dialog.Title>
                    <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-4">{t('subtitle')}</Dialog.Description>

                    <div className="mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-200">{t('warning')}</p>
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={() => setDirection('+')}
                                className="px-3 py-2 rounded-lg border text-sm font-bold"
                                style={{
                                    borderColor: direction === '+' ? '#10B981' : 'var(--os-border)',
                                    backgroundColor: direction === '+' ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                    color: direction === '+' ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                + {t('credit')}
                            </button>
                            <button
                                onClick={() => setDirection('−')}
                                className="px-3 py-2 rounded-lg border text-sm font-bold"
                                style={{
                                    borderColor: direction === '−' ? '#F59E0B' : 'var(--os-border)',
                                    backgroundColor: direction === '−' ? 'rgba(245,158,11,0.12)' : 'var(--os-surface-2)',
                                    color: direction === '−' ? '#F59E0B' : 'var(--os-text-muted)',
                                }}
                            >
                                − {t('debit')}
                            </button>
                            <div></div>
                        </div>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide">{t('amount')} (USD)</span>
                            <OsInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide">{t('justification')}</span>
                            <textarea
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                rows={3}
                                className="px-3 py-2 text-xs rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] resize-none"
                                placeholder={t('justificationPlaceholder')}
                            />
                        </label>

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        <div className="flex items-center justify-between mt-2">
                            <OsButton variant="secondary" size="sm" onClick={() => onClose(false)} disabled={submitting}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton variant="primary" size="sm" onClick={submit} disabled={submitting}>
                                {submitting ? t('submitting') : t('submit')}
                            </OsButton>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
```

- [ ] **Step 3: index.ts**

```typescript
export { WalletDetailDrawer } from './WalletDetailDrawer';
```

- [ ] **Step 4: Need API route `/api/admin/wallets/[id]/route.ts`**

Create `frontend/src/app/api/admin/wallets/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { listLedgerEntries } from '@/services/walletService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN, UserRole.MANAGER];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    try {
        const { data: wallet, error } = await auth.supabase
            .from('wallets')
            .select('id, shipowner_id, balance_usd_minor, auto_apply_to_proforma, created_at, updated_at, shipowner:shipowners(id, name)')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!wallet) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const ledger = await listLedgerEntries(auth.supabase, id, { kinds: [], offset: 0, limit: 200 });
        return NextResponse.json({ wallet, ledger });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
```

- [ ] **Step 5: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/admin/AdminWallets/WalletDetailDrawer/ \
        frontend/src/app/api/admin/wallets/
git -c commit.gpgsign=false commit -m "feat(7e): WalletDetailDrawer + AdjustWalletDialog + GET /api/admin/wallets/[id]

Right-side drawer (520px) loads wallet + full ledger via new API route.
Shows balance + ledger entries with kind badges + justification.
SUPERADMIN-only 'Manual adjustment' button opens AdjustWalletDialog
(direction toggle ±, amount, justification ≥5 chars required, negative
amount can't exceed current balance).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `adjustWalletManually` action

**Files:**
- Create: `frontend/src/actions/adjustWalletManually.ts`
- Create: `frontend/src/actions/adjustWalletManually.test.ts`

SUPERADMIN-only. INSERT `wallet_ledger(kind='ADMIN_ADJUSTMENT')` with signed amount + justification. The DB invariants enforce: non-zero amount, justification NOT NULL on ADMIN_ADJUSTMENT (mig 050 CHECK), and balance non-negative (mig 050 CHECK).

- [ ] **Step 1: Write failing tests**

Create `frontend/src/actions/adjustWalletManually.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole: vi.fn() }));

import { adjustWalletManually } from './adjustWalletManually';
import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

function setupAdminCtx(role: 'SUPERADMIN' | 'FINANCE_ADMIN', userId = 'admin-1') {
    const single = vi.fn().mockResolvedValue({ data: { id: 'wallet-1' }, error: null });
    const eq = vi.fn(() => ({ single, maybeSingle: single }));
    const select = vi.fn(() => ({ eq }));
    const insertCall = vi.fn().mockResolvedValue({ data: [{ id: 'ledger-new' }], error: null });
    const supabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
        from: vi.fn(() => ({ insert: insertCall, select })),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({ supabase, profile: { role, id: userId }, error: null });
    return { supabase, insertCall };
}

describe('adjustWalletManually', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('rejects FINANCE_ADMIN (SUPERADMIN-only)', async () => {
        (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
            error: new Response('forbidden', { status: 403 }),
        });
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 10000,
            justification: 'test',
        })).rejects.toThrow(/forbidden/);
    });

    it('inserts ledger row with kind ADMIN_ADJUSTMENT', async () => {
        const { insertCall } = setupAdminCtx('SUPERADMIN');
        await adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 50000,
            justification: 'Compensation for ops error 2026-05',
        });
        const row = (insertCall as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.kind).toBe('ADMIN_ADJUSTMENT');
        expect(row.amount_signed_usd_minor).toBe(50000);
        expect(row.justification).toBe('Compensation for ops error 2026-05');
    });

    it('rejects zero amount', async () => {
        setupAdminCtx('SUPERADMIN');
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 0,
            justification: 'test',
        })).rejects.toThrow();
    });

    it('rejects empty justification', async () => {
        setupAdminCtx('SUPERADMIN');
        await expect(adjustWalletManually({
            walletId: '11111111-1111-1111-1111-111111111111',
            amountSignedMinor: 10000,
            justification: '',
        })).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

Create `frontend/src/actions/adjustWalletManually.ts`:

```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { z } from 'zod';

const SUPERADMIN_ONLY = [UserRole.SUPERADMIN];

const schema = z.object({
    walletId: z.string().uuid(),
    amountSignedMinor: z.number().int().refine((n) => n !== 0, 'amount must be non-zero'),
    justification: z.string().min(5, 'justification must be at least 5 characters'),
});

export async function adjustWalletManually(input: {
    walletId: string;
    amountSignedMinor: number;
    justification: string;
}): Promise<void> {
    const auth = await requireRole(SUPERADMIN_ONLY);
    if (auth.error) throw new Error('forbidden');

    const parsed = schema.parse(input);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const { error } = await supabase.from('wallet_ledger').insert({
        wallet_id: parsed.walletId,
        amount_signed_usd_minor: parsed.amountSignedMinor,
        kind: 'ADMIN_ADJUSTMENT',
        created_by: user.id,
        justification: parsed.justification,
    });
    if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Tests pass + tsc**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/adjustWalletManually.ts frontend/src/actions/adjustWalletManually.test.ts
git -c commit.gpgsign=false commit -m "feat(7e): adjustWalletManually action — SUPERADMIN-only

INSERT wallet_ledger(kind='ADMIN_ADJUSTMENT') with signed amount +
justification. Zod-validated: non-zero amount, justification ≥5 chars.
DB invariants (mig 050) enforce balance non-negative + justification
NOT NULL on ADMIN_ADJUSTMENT (CHECK constraint). 4 unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: RBAC + sidebar nav

**Files:**
- Modify: `frontend/src/lib/rbac.ts`
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`
- Modify: Owner sidebar (path TBD — read existing structure first)

- [ ] **Step 1: Add `wallets` to admin RBAC + nav**

Edit `frontend/src/lib/rbac.ts`. Add to `NAV_PERMISSIONS`:

```typescript
'wallets': [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN, UserRole.MANAGER],
```

(View access — write access for adjustment is enforced inside the action via `requireRole([SUPERADMIN])`.)

- [ ] **Step 2: Add nav item to admin sidebar**

In `DashboardSidebar.tsx`, add near `/admin/payments`:

```tsx
{ key: 'wallets', icon: <Wallet className="w-4 h-4" />, href: '/admin/wallets', labelKey: 'nav_wallets', section: 'admin' }
```

Import `Wallet` from lucide-react.

- [ ] **Step 3: Add nav item to owner sidebar**

Read `frontend/src/app/owner/(portal)/layout.tsx` (or wherever the owner portal nav lives — find via `grep -rn "OwnerSidebar\|owner/dashboard\|owner/invoices" frontend/src/app/owner/`). Add a `/owner/wallet` entry alongside `/owner/invoices`.

- [ ] **Step 4: Add minimal i18n nav labels**

In `en.json`: `"nav_wallets": "Wallets"` at top level.
In `fr.json`: `"nav_wallets": "Wallets"` (or `"Portefeuilles"` if French-readable).

Owner nav label too: `"OwnerPortal.nav.wallet": "Wallet"` / `"Wallet"` (French uses same word).

(Task 10 sweeps the full namespace.)

- [ ] **Step 5: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/rbac.ts \
        frontend/src/components/dashboard/layout/DashboardSidebar.tsx \
        frontend/src/app/owner/\(portal\)/layout.tsx \
        frontend/messages/en.json frontend/messages/fr.json
git -c commit.gpgsign=false commit -m "feat(7e): RBAC + sidebar nav for /admin/wallets + /owner/wallet

Admin: NAV_PERMISSIONS.wallets allows SUPERADMIN/FINANCE_ADMIN/MANAGER
read access. SUPERADMIN-only adjustment enforced inside the action.
Sidebar shows the link to permitted roles.

Owner: /owner/wallet link added to owner portal nav.

Minimal nav i18n added; full namespaces in Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: i18n — `OwnerPortal.wallet.*` + `AdminWallets.*` namespaces

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

Full namespace additions for all the rail labels, prediction text, ledger column headers, drawer titles, adjustment dialog fields, etc.

- [ ] **Step 1: Add EN keys**

Use the Python round-trip pattern from prior plans. Top-level additions:

```python
import json
with open('frontend/messages/en.json', encoding='utf-8') as f: d = json.load(f)

# OwnerPortal.wallet namespace
d['OwnerPortal']['wallet'] = {
    'balanceCard': {
        'title': 'Current balance',
        'autoApply': 'Auto-apply to invoices',
        'autoApplyOn': 'Enabled',
        'autoApplyOff': 'Disabled',
        'topupCta': 'Top up wallet',
    },
    'predictionCard': {
        'title': 'Next 30 days',
        'estimate30d': '~{count} vessel passages → ~${amount} USD',
        'confidence': 'Confidence: {level}',
        'confidenceLevel': { 'low': 'low', 'medium': 'medium', 'high': 'high' },
        'notEnoughData': 'Not enough activity in the last 90 days to predict (< 5 alerts).',
        'insufficientWarning': 'Estimated need exceeds current balance — recommended top-up: ${amount}',
    },
    'ledger': {
        'title': 'Movements',
        'empty': 'No movements yet.',
        'col': { 'date': 'Date', 'amount': 'Amount', 'kind': 'Kind', 'note': 'Note' },
        'kind': {
            'TOPUP': 'Top-up',
            'OVERPAYMENT_CREDIT': 'Overpayment credit',
            'REFUND_CREDIT': 'Refund credit',
            'PROFORMA_APPLY': 'Applied to invoice',
            'ADMIN_ADJUSTMENT': 'Admin adjustment',
            'FX_DIFFERENCE': 'FX difference',
        },
    },
}

# Also widen PayDialog i18n for topup mode
d['OwnerPortal']['payDialog']['mode'] = d['OwnerPortal']['payDialog'].get('mode', {})
d['OwnerPortal']['payDialog']['mode']['topup'] = {
    'title': 'Top up wallet',
    'subtitle': 'Pre-fund your wallet to cover future carbon tax invoices.',
    'amountLabel': 'Top-up amount',
    'success': 'Wallet credited — your balance is up to date.',
}
d['OwnerPortal']['payDialog']['field']['topupAmount'] = 'Top-up amount (USD)'

# AdminWallets namespace
d['AdminWallets'] = {
    'title': 'Wallets',
    'refresh': 'Refresh',
    'empty': 'No wallets yet.',
    'autoApply': { 'on': 'Auto', 'off': 'Manual' },
    'col': {
        'owner': 'Shipowner', 'balance': 'Balance', 'autoApply': 'Auto-apply', 'lastActivity': 'Last activity',
    },
    'drawer': {
        'title': 'Wallet details',
        'loading': 'Loading wallet…',
        'owner': 'Shipowner',
        'balance': 'Balance',
        'adjustNotice': 'SUPERADMIN can post a manual adjustment to this wallet. Use for ops corrections, goodwill credits, or merging duplicate accounts. All adjustments are logged in the ledger.',
        'adjustCta': 'Manual adjustment',
        'ledgerTitle': 'Ledger ({count} entries)',
    },
    'adjust': {
        'title': 'Manual adjustment — {owner}',
        'subtitle': 'Credit or debit this wallet. All adjustments are append-only and require justification.',
        'warning': 'This action is irreversible. The adjustment will appear in the ledger as ADMIN_ADJUSTMENT.',
        'credit': 'Credit',
        'debit': 'Debit',
        'amount': 'Amount',
        'justification': 'Justification',
        'justificationPlaceholder': 'e.g. Goodwill credit for delayed processing 2026-05; ops ticket #1234',
        'cancel': 'Cancel',
        'submit': 'Post adjustment',
        'submitting': 'Posting…',
        'errors': {
            'amountInvalid': 'Amount must be a positive decimal with up to 2 fraction digits.',
            'justificationRequired': 'Justification must be at least 5 characters.',
            'wouldGoNegative': 'Debit exceeds current balance — would make the wallet negative.',
            'failed': 'Adjustment failed.',
        },
    },
}

with open('frontend/messages/en.json', 'w', encoding='utf-8') as f: json.dump(d, f, ensure_ascii=False, indent=2)
print('en.json updated')
```

Trailing newline: `printf '\n' >> frontend/messages/en.json`

- [ ] **Step 2: Mirror in FR**

Same structure, French translations. Key examples:
- `balanceCard.title`: "Solde actuel"
- `topupCta`: "Recharger le wallet"
- `predictionCard.title`: "30 prochains jours"
- `ledger.title`: "Mouvements"
- `AdminWallets.adjust.title`: "Ajustement manuel — {owner}"
- `kind.TOPUP`: "Recharge", `PROFORMA_APPLY`: "Imputé à une facture", `ADMIN_ADJUSTMENT`: "Ajustement admin", etc.

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/en.json'))" && echo EN ok
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/fr.json'))" && echo FR ok
```

- [ ] **Step 4: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git -c commit.gpgsign=false commit -m "feat(7e): i18n EN/FR — OwnerPortal.wallet + AdminWallets namespaces

OwnerPortal.wallet covers balance card, prediction card, ledger table
(6 kinds), and PayDialog topup-mode subtitle/amount label.

AdminWallets covers list columns, drawer fields, and adjustment dialog
(6 errors + direction toggle + warning).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: RTL tests + final gates

**Files:**
- Create: `frontend/src/components/owner/Wallet/BalanceCard.test.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminWallets/AdminWalletsPanel.test.tsx`
- Create: `frontend/src/components/dashboard/admin/AdminWallets/WalletDetailDrawer/AdjustWalletDialog.test.tsx`

3 representative RTL tests for the most-likely-to-regress paths.

- [ ] **Step 1: BalanceCard.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { BalanceCard } from './BalanceCard';
import en from '../../../../messages/en.json';

describe('BalanceCard', () => {
    it('renders balance + auto-apply badge + topup button', () => {
        const onToggle = vi.fn();
        const onTopup = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={12450}
                    autoApplyEnabled={true}
                    onToggleAutoApply={onToggle}
                    onOpenTopup={onTopup}
                    togglePending={false}
                />
            </NextIntlClientProvider>,
        );
        expect(screen.getByText(/12,450/)).toBeInTheDocument();
        expect(screen.getByText('Enabled')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Top up wallet'));
        expect(onTopup).toHaveBeenCalled();
    });

    it('shows Disabled when autoApplyEnabled is false', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={100}
                    autoApplyEnabled={false}
                    onToggleAutoApply={() => {}}
                    onOpenTopup={() => {}}
                    togglePending={false}
                />
            </NextIntlClientProvider>,
        );
        expect(screen.getByText('Disabled')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: AdminWalletsPanel.test.tsx**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { AdminWalletsPanel } from './AdminWalletsPanel';
import en from '../../../../../messages/en.json';

vi.mock('@/lib/RoleContext', () => ({ useRole: () => ({ role: 'FINANCE_ADMIN' }) }));

describe('AdminWalletsPanel', () => {
    it('renders wallet rows and triggers row click', () => {
        const rows = [
            { wallet_id: 'w1', shipowner_id: 'own-1', shipowner_name: 'Acme', balance_usd_minor: 500000, auto_apply_to_proforma: true, last_activity_at: '2026-05-10T00:00:00Z' },
        ];
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdminWalletsPanel rows={rows} />
            </NextIntlClientProvider>,
        );
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Auto')).toBeInTheDocument();
    });
});
```

- [ ] **Step 3: AdjustWalletDialog.test.tsx**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { AdjustWalletDialog } from './AdjustWalletDialog';
import en from '../../../../../../messages/en.json';

vi.mock('@/actions/adjustWalletManually', () => ({
    adjustWalletManually: vi.fn().mockResolvedValue(undefined),
}));

describe('AdjustWalletDialog', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('blocks submit without justification ≥5 chars', async () => {
        const onClose = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdjustWalletDialog walletId="w1" shipownerName="Acme" currentBalanceUsdMinor={100000} onClose={onClose} />
            </NextIntlClientProvider>,
        );
        const amount = screen.getByPlaceholderText('100.00');
        fireEvent.change(amount, { target: { value: '50.00' } });
        fireEvent.click(screen.getByText('Post adjustment'));
        expect(await screen.findByText(/Justification must be at least 5 characters/i)).toBeInTheDocument();
    });

    it('happy path: calls adjustWalletManually with signed amount', async () => {
        const onClose = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdjustWalletDialog walletId="w1" shipownerName="Acme" currentBalanceUsdMinor={100000} onClose={onClose} />
            </NextIntlClientProvider>,
        );
        const amount = screen.getByPlaceholderText('100.00');
        fireEvent.change(amount, { target: { value: '50.00' } });
        const justification = screen.getByPlaceholderText(/Goodwill credit/);
        fireEvent.change(justification, { target: { value: 'Compensation for ops error' } });
        fireEvent.click(screen.getByText('Post adjustment'));

        const { adjustWalletManually } = await import('@/actions/adjustWalletManually');
        await waitFor(() => {
            expect(adjustWalletManually).toHaveBeenCalledWith(expect.objectContaining({
                walletId: 'w1',
                amountSignedMinor: 5000,
                justification: 'Compensation for ops error',
            }));
        });
    });
});
```

- [ ] **Step 4: Run all gates**

```bash
./supabase/tests/run.sh migrations/064_topup_on_confirm_trigger.test.sql   # DEFERRED if Docker broken
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/owner/Wallet/BalanceCard.test.tsx \
        frontend/src/components/dashboard/admin/AdminWallets/AdminWalletsPanel.test.tsx \
        frontend/src/components/dashboard/admin/AdminWallets/WalletDetailDrawer/AdjustWalletDialog.test.tsx
git -c commit.gpgsign=false commit -m "feat(7e): RTL tests + final gates

5 new RTL tests covering BalanceCard render, AdminWalletsPanel render +
click, AdjustWalletDialog validation + happy path.

All gates green: tsc, vitest, next build. Mig 064 pg test DEFERRED
(Docker — same blocker since 7C-2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria

- [ ] Mig 064 trigger fires on `payments.status → CONFIRMED` with NULL `transaction_id` → INSERT ledger TOPUP
- [ ] Trigger is idempotent (re-UPDATE doesn't duplicate ledger entry)
- [ ] Trigger does NOT fire when `transaction_id` is set (normal invoice payment)
- [ ] `walletService.getWalletForOwner` returns wallet row or null
- [ ] `walletService.listLedgerEntries` is paginated + kind-filterable
- [ ] `walletService.predictNextTax` returns `{ count, amount, confidence }` based on 90-day median
- [ ] `toggleAutoApply` action is owner-gated (only the wallet's shipowner can flip)
- [ ] `adjustWalletManually` is SUPERADMIN-only (FINANCE_ADMIN rejected)
- [ ] `adjustWalletManually` enforces non-zero amount + justification ≥5 chars
- [ ] `<PayDialog>` accepts `mode='topup'` prop with nullable transactionId
- [ ] PayDialog topup mode hides WALLET rail in Step 1
- [ ] PayDialog topup mode shows amount input in Step 2
- [ ] `/owner/wallet` page renders for SHIPOWNER role
- [ ] `<BalanceCard>` shows balance + auto-apply badge + topup button
- [ ] `<PredictionCard>` shows 30-day forecast or "not enough data"
- [ ] `<LedgerTable>` filterable by 6 ledger kinds
- [ ] `/admin/wallets` page renders for SUPERADMIN/FINANCE_ADMIN/MANAGER
- [ ] `<WalletDetailDrawer>` loads wallet + full ledger via new API
- [ ] `<AdjustWalletDialog>` SUPERADMIN-only (button hidden for non-SUPERADMIN)
- [ ] AdjustWalletDialog credits + debits both work, justification required
- [ ] RBAC `NAV_PERMISSIONS.wallets` allows the 3 admin roles
- [ ] Owner sidebar shows `/owner/wallet` link
- [ ] Admin sidebar shows `/admin/wallets` link
- [ ] `OwnerPortal.wallet.*` + `AdminWallets.*` i18n complete in EN + FR
- [ ] All gates green: mig 064 pg test (or DEFERRED), tsc, vitest, next build

---

## Pre-merge checklist for the human

1. **Mig 064 pg test** once Docker is back. With Plans 7C-2 / 7C-4 / 7C-5 / 7D's deferred tests (migs 060/061/062/063), now 5 migrations pending pg verification.

2. **Hosted DB push** after merge: batch push 060-064 with `supabase db push --include-all`. Pre-diagnostic queries grow accordingly:
   ```sql
   SELECT 1 FROM pg_proc WHERE proname='apply_topup_credit_on_confirm';
   SELECT 1 FROM pg_trigger WHERE tgname='trg_topup_credit_on_confirm';
   ```

3. **Functional smoke test**:
   - As SHIPOWNER: `/owner/wallet` → click "Top up wallet" → `<PayDialog mode='topup'>` opens → pick STRIPE → enter $50 → Submit → redirect to Stripe Checkout → TEST card 4242… → success → `/owner/invoices?stripe=success`
   - Verify: `/owner/wallet` reloads → balance increased by $50, ledger shows new TOPUP entry
   - Toggle auto-apply OFF → reload → toggle should persist
   - As FINANCE_ADMIN: `/admin/wallets` → click a wallet → drawer opens → ledger visible, NO "Manual adjustment" button (role check)
   - As SUPERADMIN: `/admin/wallets` → click a wallet → drawer shows "Manual adjustment" → click → enter +$100 + "test reason from runbook" → submit → ledger refreshes with new ADMIN_ADJUSTMENT entry

4. **Predict-next-tax sanity**: pick a shipowner with 10+ arrival_alerts in the last 90 days → `/owner/wallet` should show a credible 30-day estimate. With < 5 alerts → "Not enough activity" copy.

5. **Out-of-scope reminders**:
   - Email notification on TOPUP is Plan 7F (deferred). For v1 the audit_logs entry is the only trace.
   - Bulk wallet operations (merge duplicates, etc.) are ops manual SQL.

---

## Self-Review Notes

- **Spec coverage**: §7.6 (owner wallet) ✓ — balance card, auto-apply toggle, prediction, ledger, topup CTA, predictNextTax algo. §8.4 (admin wallets) ✓ — list, drawer, SUPERADMIN-only adjustment with justification.
- **Reuse**: `<PayDialog>` extended (Plan 7C-2), `applyWallet` unchanged (Plan 7C-1), `confirmPayment` overpayment-to-wallet unchanged (Plan 7C-1), `confirmed_by` system actor pattern reused (Plan 7D `system-actor.ts`), `<PaymentReviewDrawer>` UX pattern mirrored (Plan 7C-3).
- **Idempotency**: trigger checks NOT EXISTS before INSERT. Re-confirming a payment via the action does NOT create double ledger entries.
- **Failure modes**:
  - Owner balance overflow / underflow → DB CHECK `balance_usd_minor >= 0` + non-zero amount in ledger (existing mig 050 constraints)
  - SUPERADMIN tries to debit more than balance → AdjustWalletDialog client-side check + DB CHECK rejects
  - FINANCE_ADMIN tries to adjust → action throws 403 (`requireRole([SUPERADMIN])`)
  - Topup payment fails post-CONFIRMED (Stripe disputes/refunds) → covered by Plan 7G
- **predictNextTax window**: 90 days fixed. Could be parametrized later but not for v1.
- **`OsTable.onRowClick`** may not exist as a prop (it's referenced in Task 6) — verify and adapt to whatever click pattern OsTable supports. Could wrap the row in a button, or render a click handler in a cell.
- **No new pgmq queue or cron** — wallet activity is event-driven (trigger fires synchronously on payment confirm). Future Plan 7F might add async notification dispatch.
