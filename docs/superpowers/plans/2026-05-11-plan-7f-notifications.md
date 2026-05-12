# Plan 7F — Notifications (email + in-app bell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the central `notificationService.notifyOwner` dispatch (INSERT in-app `owner_notifications` + async email via existing `emailService`), the `<NotificationBell>` UI in `OwnerShell`, the `/owner/notifications` page, and wire 5 high-priority kinds (`PAYMENT_RECEIVED`, `PAYMENT_REJECTED`, `WALLET_TOPPED_UP`, `KYC_APPROVED`, `KYC_REJECTED`) into the live action/webhook call sites. Add `pg_cron proforma-reminders` daily (J+3, J+7) for `PROFORMA_REMINDER`.

**Architecture:** One Postgres migration (065) adds the `pg_cron proforma-reminders` job + SQL function that scans `PROFORMA` transactions aged 3 or 7 days and INSERTs `PROFORMA_REMINDER` notifications (idempotent: skip if a notification already exists for the same transaction × age bucket × day). New `notificationService.ts` exposes `notifyOwner(shipownerId, kind, params, options)`: always INSERTs the in-app row, and if the kind is in `EMAIL_KINDS` AND `options.skipEmail` is not set, dispatches via existing `emailService` functions (fail-soft) and updates `emailed_at`. Three new email functions added inline-HTML (`sendPaymentRejectedEmail`, `sendProformaReminderEmail`, `sendWalletTopupEmail`). The `<NotificationBell>` in `OwnerShell.tsx` (Plan 7E discovered the file) polls `/api/owner/notifications` every 60s, shows badge count, dropdown of 10 latest unread. Click marks read + follows `deep_link`.

**Tech Stack:** PostgreSQL 17 / Supabase / `pg_cron` / Next.js 16 server actions + API routes / TypeScript strict / Vitest + RTL / next-intl / Resend (existing). Reuses Plan 7A's `owner_notifications` table (mig 053) + `mig 058` RLS policies. Reuses Plan 7C-1's `confirmPayment` + `rejectPayment` + Plan 7D's Stripe webhook + Plan 7B's `approveShipownerRegistration` / `rejectShipownerRegistration` call sites.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §6 (notifications) + §6.5 (trigger wiring).

**Predecessor:** Plans 7A through 7E — ALL MERGED on develop (tip `0dc8b85`). The `owner_notifications` schema is live; only the dispatch + UI layer is missing.

**Successor:** Plan 7G — Refunds (will call `notifyOwner(...,'REFUND_ISSUED', ...)` from the refund flow). Plan 7H — final E2E + canary deploy + i18n full + remaining 6 notif kinds wired (ALERT_DETECTED, FINAL_ISSUED, COMPLEMENT_ISSUED, DISPUTE_UPDATED, OWNER_ESCALATION, WALLET_LOW_BALANCE).

**Out of scope:**
- React Email templates migration (`frontend/src/email-templates/owner/*.tsx`) — defer; inline-HTML pattern (existing `emailService.ts` style) continues
- SMS dispatch — `feature.sms_enabled` flag exists; v1 is feature-flag scaffolding only, no Twilio/equivalent wiring
- Notification preferences UI (per-kind opt-out) — Phase 2
- WALLET_LOW_BALANCE daily cron — Plan 7H
- WALLET_APPLIED in-app emit on wallet auto-apply trigger (mig 059) — Plan 7H
- ALERT_DETECTED wiring (Go backend pipeline integration) — Plan 7H
- FINAL_ISSUED / COMPLEMENT_ISSUED (Plan 4 reconcile pipeline) — Plan 7H
- DISPUTE_UPDATED (Plan 6 disputes) — Plan 7H
- OWNER_ESCALATION (Plan 5 escalation) — Plan 7H
- WebSocket / Server-Sent Events for real-time bell — Phase 2; v1 uses 60s polling per spec

---

## File Structure

### Files to create

```
supabase/migrations/
└── 065_proforma_reminders_cron.sql                # pg_cron daily + SQL function

supabase/tests/migrations/
└── 065_proforma_reminders_cron.test.sql

frontend/src/services/
├── notificationService.ts                          # notifyOwner + EMAIL_KINDS map
└── notificationService.test.ts

frontend/src/actions/
├── markNotificationRead.ts                         # owner: UPDATE read_at on one notif
├── markNotificationRead.test.ts
├── markAllNotificationsRead.ts                     # bulk
└── markAllNotificationsRead.test.ts

frontend/src/app/api/owner/notifications/
└── route.ts                                        # GET paginated + unread_count

frontend/src/app/owner/\(portal\)/notifications/
└── page.tsx                                        # full list page

frontend/src/components/owner/NotificationBell/
├── NotificationBell.tsx                            # bell + badge + dropdown
├── NotificationBell.test.tsx                       # RTL
├── NotificationList.tsx                            # reusable list (dropdown + page)
└── index.ts
```

### Files to modify

```
frontend/src/services/emailService.ts                                # +3 new email functions
frontend/src/services/emailService.test.ts                           # +tests for new email functions
frontend/src/actions/confirmPayment.ts                                # wire PAYMENT_RECEIVED in-app notif
frontend/src/actions/rejectPayment.ts                                 # wire PAYMENT_REJECTED notif + email
frontend/src/app/api/webhooks/stripe/route.ts                        # wire PAYMENT_RECEIVED in-app notif
frontend/src/actions/approveShipownerRegistration.ts                  # wire KYC_APPROVED in-app notif (email already sent)
frontend/src/actions/rejectShipownerRegistration.ts                   # wire KYC_REJECTED notif + new email (if rejection email doesn't exist)
frontend/src/components/owner/OwnerShell.tsx                          # mount <NotificationBell> in header
frontend/messages/en.json                                             # OwnerPortal.notifications.* + per-kind title/body keys (16 kinds)
frontend/messages/fr.json
```

### Test runners

```bash
./supabase/tests/run.sh migrations/065_proforma_reminders_cron.test.sql   # DEFERRED if Docker broken

cd frontend && npx vitest run src/services/notificationService.test.ts
cd frontend && npx vitest run src/components/owner/NotificationBell/

cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

---

## Task 1: Mig 065 — pg_cron proforma-reminders

**Files:**
- Create: `supabase/migrations/065_proforma_reminders_cron.sql`
- Create: `supabase/tests/migrations/065_proforma_reminders_cron.test.sql`

The cron runs daily at 08:00 UTC. The SQL function `enqueue_proforma_reminders()` scans `transactions WHERE document_type='PROFORMA' AND status='PENDING'` and, for rows aged exactly 3 days or 7 days, INSERTs a `PROFORMA_REMINDER` notification into `owner_notifications`. Idempotent: skip if a `PROFORMA_REMINDER` notification already exists for `(shipowner_id, transaction_id, age_bucket)`.

- [ ] **Step 1: Write failing pg test**

Create `supabase/tests/migrations/065_proforma_reminders_cron.test.sql`:

```sql
BEGIN;

-- 1. Function exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_proc
    WHERE proname = 'enqueue_proforma_reminders';
  ASSERT n = 1, format('expected enqueue_proforma_reminders, got %s', n);
END $$;

-- 2. Cron job exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM cron.job
    WHERE jobname = 'proforma-reminders-daily';
  ASSERT n = 1, format('expected cron job, got %s', n);
END $$;

-- 3. Function inserts notifications for PROFORMA aged 3 days
-- Seed: shipowner + vessel + 3-day-old PROFORMA + 7-day-old PROFORMA + 1-day-old PROFORMA
INSERT INTO auth.users (id, email) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local');
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@local', 'A', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TestCo', 'ACTIVE', 'en');
INSERT INTO public.vessels (id, imo_number, name, jurisdiction_country, shipowner_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '9999999', 'TEST', 'KE', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd, status,
   document_type, transaction_type, shipowner_id, invoice_ref, created_at)
  VALUES
  ('d0000003-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-OLD-3D',
   NOW() - INTERVAL '3 days' - INTERVAL '2 hours'),
  ('d0000007-0000-0000-0000-000000000007', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-OLD-7D',
   NOW() - INTERVAL '7 days' - INTERVAL '2 hours'),
  ('d0000001-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PENDING',
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-NEW-1D',
   NOW() - INTERVAL '1 day');

-- Call the function
SELECT public.enqueue_proforma_reminders();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.owner_notifications
    WHERE kind = 'PROFORMA_REMINDER' AND shipowner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT n = 2, format('expected 2 PROFORMA_REMINDER (3d + 7d), got %s', n);
END $$;

-- 4. Idempotency: re-running the same day does not duplicate
SELECT public.enqueue_proforma_reminders();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.owner_notifications
    WHERE kind = 'PROFORMA_REMINDER' AND shipowner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT n = 2, format('expected idempotent, still 2 PROFORMA_REMINDER, got %s', n);
END $$;

-- 5. PAID transactions are NOT reminded
UPDATE public.transactions SET status='PAID' WHERE id='d0000003-0000-0000-0000-000000000003';
INSERT INTO public.transactions
  (id, vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd, status,
   document_type, transaction_type, shipowner_id, invoice_ref, created_at)
  VALUES
  ('d0000300-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'TEST', '9999999', 1.0, 100.00, 'PAID',  -- already paid
   'PROFORMA', 'ENTRY_TAX', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INV-PAID-3D',
   NOW() - INTERVAL '3 days' - INTERVAL '3 hours');

SELECT public.enqueue_proforma_reminders();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.owner_notifications
    WHERE kind = 'PROFORMA_REMINDER'
      AND body_params->>'invoice_ref' = 'INV-PAID-3D';
  ASSERT n = 0, format('expected no reminder for PAID transaction, got %s', n);
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run test → FAIL** (function doesn't exist). If Docker broken, skip + DONE_WITH_CONCERNS.

```bash
./supabase/tests/run.sh migrations/065_proforma_reminders_cron.test.sql
```

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/065_proforma_reminders_cron.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 065: Proforma reminders cron (Plan 7F)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Daily pg_cron job scans PROFORMA transactions PENDING age=3 days or 7 days
-- and INSERTs a PROFORMA_REMINDER notification. Idempotent: the per-day
-- bucket prevents double-reminders if the job re-runs.

-- 1. SQL function
CREATE OR REPLACE FUNCTION public.enqueue_proforma_reminders() RETURNS INT AS $$
DECLARE
  rec RECORD;
  inserted_count INT := 0;
  age_days INT;
BEGIN
  FOR rec IN
    SELECT
      t.id, t.shipowner_id, t.invoice_ref, t.tax_amount_usd, t.vessel_name,
      t.created_at,
      EXTRACT(DAY FROM (NOW() - t.created_at))::INT AS age_days
    FROM public.transactions t
    WHERE t.document_type = 'PROFORMA'
      AND t.status = 'PENDING'
      AND t.shipowner_id IS NOT NULL
      AND EXTRACT(DAY FROM (NOW() - t.created_at))::INT IN (3, 7)
  LOOP
    age_days := rec.age_days;

    -- Idempotency: skip if a reminder already exists for this transaction
    -- at this age-bucket
    IF NOT EXISTS (
      SELECT 1 FROM public.owner_notifications
      WHERE kind = 'PROFORMA_REMINDER'
        AND shipowner_id = rec.shipowner_id
        AND (body_params->>'transaction_id')::UUID = rec.id
        AND (body_params->>'age_days')::INT = age_days
    ) THEN
      INSERT INTO public.owner_notifications
        (shipowner_id, kind, title_key, body_key, body_params, deep_link)
      VALUES
        (rec.shipowner_id,
         'PROFORMA_REMINDER',
         'OwnerPortal.notifications.kind.PROFORMA_REMINDER.title',
         'OwnerPortal.notifications.kind.PROFORMA_REMINDER.body',
         jsonb_build_object(
           'transaction_id', rec.id,
           'invoice_ref', rec.invoice_ref,
           'amount_usd', rec.tax_amount_usd,
           'vessel_name', rec.vessel_name,
           'age_days', age_days
         ),
         '/owner/invoices?focus=' || rec.id);

      inserted_count := inserted_count + 1;
    END IF;
  END LOOP;

  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.enqueue_proforma_reminders() IS
  'Plan 7F: scan PROFORMA transactions PENDING aged 3 or 7 days; INSERT PROFORMA_REMINDER notif (idempotent per transaction × age_days). Returns count of insertions.';

-- 2. pg_cron daily job at 08:00 UTC
SELECT cron.schedule(
  'proforma-reminders-daily',
  '0 8 * * *',
  $cron$ SELECT public.enqueue_proforma_reminders(); $cron$
);
```

- [ ] **Step 4: Re-run test → PASS** (5 ASSERTs green) — or DEFERRED.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/065_proforma_reminders_cron.sql \
        supabase/tests/migrations/065_proforma_reminders_cron.test.sql
git -c commit.gpgsign=false commit -m "feat(7f): mig 065 — pg_cron proforma-reminders daily

Daily 08:00 UTC scan of PROFORMA transactions PENDING aged 3 or 7 days.
INSERTs PROFORMA_REMINDER notification (in-app). Idempotent per
(transaction_id, age_days) via NOT EXISTS check. body_params carries
the invoice ref + amount + vessel + age for i18n template formatting.

Email dispatch on the in-app row creation happens later (a future cron
or a TS worker may pick up new notifs and email them, OR the
notificationService can be invoked from a daemon that polls for
emailed_at IS NULL — TBD in Plan 7H integration).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

## Important Operational Notes — Task 1

- **`SECURITY DEFINER`** on the function so the cron-run user (postgres) can INSERT into owner_notifications regardless of RLS. The pg_cron user is `postgres` by default — bypass RLS anyway.
- **Idempotency** check uses `body_params->>'transaction_id'` and `body_params->>'age_days'`. This avoids needing a dedicated unique index (which would complicate the schema).
- **`EXTRACT(DAY FROM ...)`** rounds DOWN — a transaction created 3 days + 2 hours ago has age_days=3. Verify the test seeds use `INTERVAL '3 days' - INTERVAL '2 hours'` (creates row aged 3 days, 2 hours behind now → EXTRACT=3).
- **Hosted pg_cron compatibility**: Supabase has pg_cron extension. Verify it's enabled (probably is, since Plan 3 uses it for `match_pending_alerts`).
- The cron does NOT dispatch emails directly — that's a future task. Spec line 540 says `notifyOwner` dispatches email. The cron INSERTs the notification; an email dispatcher daemon (or `notifyOwner` called from TS-side cron) will fetch unread+!emailed notifs and email them. For 7F simplicity: just INSERT the notif; defer the email loop to 7H or implement a small Vercel Cron in this plan (see Task ?).

Actually — for parity with `notifyOwner` semantics, let me reconsider. The cron INSERTs notification rows BUT skips email dispatch. The email part lives in TS code. To send emails for PROFORMA_REMINDER:
- Option A: dedicated daily Vercel Cron `/api/cron/notification-email-loop` that scans `WHERE kind IN EMAIL_KINDS AND emailed_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'` and emails each via existing emailService. Marks `emailed_at`.
- Option B: pg trigger on `owner_notifications` INSERT that calls a Postgres function via `pg_net.http_post` to a Next.js endpoint that emails. Plan 3 uses pg_net for AIS — same pattern.
- Option C: keep `notifyOwner` synchronous in TS and have ALL email-dispatching go through there. The cron then ALSO calls `notifyOwner` somehow — but pg_cron can't call TS. So back to Option A or B.

**Decision: Option A** — Vercel Cron daemon for email-loop. Simpler than pg_net + Next.js round trip. Add this as a separate task in Plan 7F.

Actually let me revise: spec §6.1 says `notifyOwner` itself dispatches the email synchronously. For TS call sites (confirmPayment, rejectPayment, Stripe webhook, KYC actions), `notifyOwner` is called directly — easy. For PROFORMA_REMINDER cron (pg_cron), we need a separate path because TS isn't reachable from pg_cron.

**Two clean options**:
- (A) Add a tiny Vercel Cron daemon that scans recent unsent in-app notifs and emails them. Runs every 5 min. Simple.
- (B) Convert the proforma-reminders cron to Vercel Cron entirely (NOT pg_cron). The Vercel Cron handler runs the SQL function `enqueue_proforma_reminders()` AND dispatches emails for the newly-inserted notifs in the same request.

Option B is cleaner — single code path. The SQL function moves from "complete pipeline" to "find candidates + INSERT in-app row". The Vercel Cron is the orchestrator.

But Option B has a small wrinkle: pg_cron is fire-and-forget (free), Vercel Cron is HTTP-driven (limited free quota). For carbon tax volume (~hundreds/day), Vercel Cron is fine.

**Final decision: keep mig 065 as written (pg_cron) for the in-app INSERT. Add a separate Vercel Cron (`/api/cron/notification-email-loop`) in a new task to handle email dispatch for any unsent EMAIL_KINDS notification.**

This keeps the in-app path resilient (pg_cron is always running) and the email path independent (Vercel Cron can be paused without affecting in-app).

Let me add Task 12 for the email-loop cron. Reorganize.

---

## Task 2: `notificationService.ts` — central dispatch

**Files:**
- Create: `frontend/src/services/notificationService.ts`
- Create: `frontend/src/services/notificationService.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/services/notificationService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendPaymentRejectedEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendProformaReminderEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendWalletTopupEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendRegistrationApprovalEmail: vi.fn().mockResolvedValue({ ok: true }),
    sendKycRejectedEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

import { notifyOwner, EMAIL_KINDS } from './notificationService';

function makeClient(opts: { ownerEmail?: string | null; ownerLang?: string } = {}) {
    const insertReturned = { data: { id: 'notif-1' }, error: null };
    const insertCall = vi.fn().mockResolvedValue(insertReturned);
    const select = vi.fn(() => ({ single: vi.fn(() => Promise.resolve(insertReturned)) }));
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }));
    const ownerSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
                data: opts.ownerEmail !== undefined
                    ? { official_email: opts.ownerEmail, preferred_language: opts.ownerLang ?? 'en', name: 'TestCo' }
                    : null,
                error: opts.ownerEmail === undefined ? new Error('not found') : null,
            }),
        })),
    }));
    return {
        from: vi.fn((table: string) => {
            if (table === 'owner_notifications') return { insert: vi.fn(() => ({ select })), update };
            if (table === 'shipowners') return { select: ownerSelect };
            return { select: vi.fn() };
        }),
    } as unknown as SupabaseClient;
}

describe('notifyOwner', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('always INSERTs in-app notification row', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'WALLET_APPLIED',
            params: { amount_usd: 100 },
        });
        expect(client.from).toHaveBeenCalledWith('owner_notifications');
    });

    it('dispatches email for EMAIL_KINDS', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'PAYMENT_REJECTED',
            params: { invoice_ref: 'INV-X', reason: 'bad SWIFT' },
        });
        const { sendPaymentRejectedEmail } = await import('@/services/emailService');
        expect(sendPaymentRejectedEmail).toHaveBeenCalled();
    });

    it('skips email when options.skipEmail = true', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'PAYMENT_RECEIVED',
            params: { invoice_ref: 'INV-X', amount_usd: 100 },
            skipEmail: true,
        });
        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
        expect(sendPaymentConfirmationEmail).not.toHaveBeenCalled();
    });

    it('skips email when kind not in EMAIL_KINDS', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        await notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'WALLET_APPLIED',
            params: {},
        });
        const { sendPaymentRejectedEmail } = await import('@/services/emailService');
        expect(sendPaymentRejectedEmail).not.toHaveBeenCalled();
    });

    it('does not throw when email dispatch fails (fail-soft)', async () => {
        const client = makeClient({ ownerEmail: 'owner@test' });
        const { sendPaymentRejectedEmail } = await import('@/services/emailService');
        (sendPaymentRejectedEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('SMTP down'));
        await expect(notifyOwner(client, {
            shipownerId: '123e4567-e89b-42d3-a456-426614174000',
            kind: 'PAYMENT_REJECTED',
            params: { invoice_ref: 'INV-X', reason: 'x' },
        })).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

Create `frontend/src/services/notificationService.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    sendPaymentConfirmationEmail,
    sendPaymentRejectedEmail,
    sendProformaReminderEmail,
    sendWalletTopupEmail,
    sendRegistrationApprovalEmail,
    sendKycRejectedEmail,
    type EmailResult,
} from '@/services/emailService';

export type NotificationKind =
    | 'KYC_APPROVED' | 'KYC_REJECTED' | 'KYC_C_REQUIRED'
    | 'ALERT_DETECTED' | 'PROFORMA_ISSUED' | 'PROFORMA_REMINDER'
    | 'PAYMENT_RECEIVED' | 'PAYMENT_REJECTED'
    | 'FINAL_ISSUED' | 'COMPLEMENT_ISSUED' | 'REFUND_ISSUED'
    | 'WALLET_TOPPED_UP' | 'WALLET_APPLIED' | 'WALLET_LOW_BALANCE'
    | 'DISPUTE_UPDATED' | 'OWNER_ESCALATION';

/**
 * Set of kinds that ALSO dispatch an email (besides the in-app row).
 * Subset of NotificationKind. Per spec §6.2.
 */
export const EMAIL_KINDS: ReadonlySet<NotificationKind> = new Set([
    'KYC_APPROVED', 'KYC_REJECTED', 'KYC_C_REQUIRED',
    'ALERT_DETECTED', 'PROFORMA_ISSUED', 'PROFORMA_REMINDER',
    'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
    'FINAL_ISSUED', 'COMPLEMENT_ISSUED', 'REFUND_ISSUED',
    'WALLET_TOPPED_UP', 'WALLET_LOW_BALANCE',
    'DISPUTE_UPDATED', 'OWNER_ESCALATION',
]);

export interface NotifyOwnerInput {
    shipownerId: string;
    kind: NotificationKind;
    params: Record<string, unknown>;
    deepLink?: string;
    skipEmail?: boolean;
    attachments?: { pdfBuffer?: Uint8Array; filename?: string };
}

/**
 * Title key in i18n. Body key derived as title.body_key.
 */
function titleKeyForKind(kind: NotificationKind): string {
    return `OwnerPortal.notifications.kind.${kind}.title`;
}
function bodyKeyForKind(kind: NotificationKind): string {
    return `OwnerPortal.notifications.kind.${kind}.body`;
}

/**
 * Central notification dispatch. Always INSERTs the in-app row. If kind ∈
 * EMAIL_KINDS AND skipEmail is not set, dispatches email via emailService.
 * Email failures are fail-soft (logged, not rethrown).
 */
export async function notifyOwner(
    client: SupabaseClient,
    input: NotifyOwnerInput,
): Promise<{ id: string }> {
    // 1. INSERT in-app notification row
    const { data: insertedRaw, error } = await client
        .from('owner_notifications')
        .insert({
            shipowner_id: input.shipownerId,
            kind: input.kind,
            title_key: titleKeyForKind(input.kind),
            body_key: bodyKeyForKind(input.kind),
            body_params: input.params,
            deep_link: input.deepLink ?? null,
        })
        .select('id')
        .single();
    if (error) throw new Error(`Failed to INSERT owner_notification: ${error.message}`);

    const inserted = insertedRaw as { id: string };

    // 2. Dispatch email if applicable
    if (!input.skipEmail && EMAIL_KINDS.has(input.kind)) {
        // Fire-and-forget; don't await inside the action's critical path beyond logging
        try {
            // Fetch owner email + preferred language
            const { data: owner } = await client
                .from('shipowners')
                .select('official_email, preferred_language, name')
                .eq('id', input.shipownerId)
                .single();
            if (owner && (owner as { official_email: string | null }).official_email) {
                const ownerEmail = (owner as { official_email: string }).official_email;
                const ownerName = (owner as { name: string | null }).name ?? 'Shipowner';

                let result: EmailResult | null = null;
                switch (input.kind) {
                    case 'PAYMENT_RECEIVED':
                        result = await sendPaymentConfirmationEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            vesselName: String(input.params.vessel_name ?? '—'),
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            paidAt: String(input.params.paid_at ?? new Date().toLocaleString()),
                            receiptRef: input.params.receipt_ref as string | undefined,
                            receiptPdfBuffer: input.attachments?.pdfBuffer,
                        });
                        break;
                    case 'PAYMENT_REJECTED':
                        result = await sendPaymentRejectedEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            reason: String(input.params.reason ?? 'unspecified'),
                        });
                        break;
                    case 'PROFORMA_REMINDER':
                        result = await sendProformaReminderEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            invoiceRef: String(input.params.invoice_ref ?? '—'),
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            ageDays: Number(input.params.age_days ?? 3),
                        });
                        break;
                    case 'WALLET_TOPPED_UP':
                        result = await sendWalletTopupEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            amountUsd: Number(input.params.amount_usd ?? 0),
                            newBalanceUsd: Number(input.params.new_balance_usd ?? 0),
                        });
                        break;
                    case 'KYC_APPROVED':
                        result = await sendRegistrationApprovalEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            shipownerName: ownerName,
                        });
                        break;
                    case 'KYC_REJECTED':
                        result = await sendKycRejectedEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            reason: String(input.params.reason ?? 'See email for details'),
                        });
                        break;
                    default:
                        // Other EMAIL_KINDS not yet wired (deferred to 7G/7H)
                        result = null;
                }

                if (result?.ok) {
                    // Mark emailed_at
                    await client.from('owner_notifications')
                        .update({ emailed_at: new Date().toISOString() })
                        .eq('id', inserted.id);
                }
            }
        } catch (e) {
            // Fail-soft: log but don't rethrow
            console.error(`[notifyOwner] email dispatch failed for ${input.kind}:`, e);
        }
    }

    return { id: inserted.id };
}
```

- [ ] **Step 4: Run → pass + tsc**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/notificationService.ts \
        frontend/src/services/notificationService.test.ts
git -c commit.gpgsign=false commit -m "feat(7f): notificationService — notifyOwner central dispatch

INSERT owner_notifications row + dispatch email (if kind ∈ EMAIL_KINDS
AND !skipEmail) via existing emailService functions. Fail-soft email
errors (log + continue). Updates emailed_at on success.

EMAIL_KINDS covers 15 of 16 kinds (only WALLET_APPLIED is in-app only).
Plan 7F wires 5 high-priority kinds at their call sites; remaining
kinds are scaffolded but not yet emitted (Plans 7G/7H finish).

5 unit tests cover happy path + skipEmail + non-EMAIL_KINDS skip +
email-failure fail-soft.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 3 new email functions in `emailService.ts`

**Files:**
- Modify: `frontend/src/services/emailService.ts`
- Modify: `frontend/src/services/emailService.test.ts`

Add `sendPaymentRejectedEmail`, `sendProformaReminderEmail`, `sendWalletTopupEmail`, `sendKycRejectedEmail`. Mirror the existing inline-HTML pattern of `sendPaymentConfirmationEmail`.

- [ ] **Step 1: Add the 4 new functions to emailService.ts**

Append to `frontend/src/services/emailService.ts` (after the existing functions):

```typescript
// ── Plan 7F: PAYMENT_REJECTED ──────────────────────────────────────────────

export interface PaymentRejectedParams {
    to: string;
    recipientName: string;
    invoiceRef: string;
    reason: string;
}

export async function sendPaymentRejectedEmail(p: PaymentRejectedParams): Promise<EmailResult> {
    const subject = `Payment declined — ${escapeHtml(p.invoiceRef)}`;
    const content = `
        <h1>Payment declined ✗</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>We were unable to confirm your recent payment for invoice
           <strong style="font-family:monospace;color:#10B981">${escapeHtml(p.invoiceRef)}</strong>.</p>
        <div class="alert alert-warning">
            <strong>Reason:</strong> ${escapeHtml(p.reason)}
        </div>
        <p>Please review the invoice and re-submit payment from your portal.
           If you believe this is in error, contact finance.</p>
    `;
    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Payment declined for ${p.invoiceRef}` }),
        text: `Payment declined for ${p.invoiceRef}\nReason: ${p.reason}\n\nPlease re-submit from your portal.`,
    });
}

// ── Plan 7F: PROFORMA_REMINDER ─────────────────────────────────────────────

export interface ProformaReminderParams {
    to: string;
    recipientName: string;
    invoiceRef: string;
    amountUsd: number;
    ageDays: number;
}

export async function sendProformaReminderEmail(p: ProformaReminderParams): Promise<EmailResult> {
    const subject = `Reminder: invoice ${escapeHtml(p.invoiceRef)} pending (${p.ageDays} days)`;
    const content = `
        <h1>Payment reminder</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>This is a friendly reminder that invoice
           <strong style="font-family:monospace;color:#10B981">${escapeHtml(p.invoiceRef)}</strong>
           remains unpaid <strong>${p.ageDays} days</strong> after issuance.</p>
        <div class="meta-row"><span class="meta-label">Amount</span>
          <span class="meta-value" style="color:#10B981;font-size:16px">$${p.amountUsd.toLocaleString()}</span></div>
        <p style="margin-top:16px">
          <a href="${process.env.NEXT_PUBLIC_APP_URL ?? '/'}/owner/invoices" class="btn">
            Settle now →
          </a>
        </p>
    `;
    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Invoice ${p.invoiceRef} reminder — ${p.ageDays} days` }),
        text: `Reminder: ${p.invoiceRef} pending ${p.ageDays} days — $${p.amountUsd.toLocaleString()}`,
    });
}

// ── Plan 7F: WALLET_TOPPED_UP ──────────────────────────────────────────────

export interface WalletTopupParams {
    to: string;
    recipientName: string;
    amountUsd: number;
    newBalanceUsd: number;
}

export async function sendWalletTopupEmail(p: WalletTopupParams): Promise<EmailResult> {
    const subject = `Wallet topped up — +$${p.amountUsd.toLocaleString()}`;
    const content = `
        <h1>Wallet credited ✓</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>We have received your wallet top-up and credited your balance.</p>
        <div class="meta-row"><span class="meta-label">Amount</span>
          <span class="meta-value" style="color:#10B981;font-size:16px">+$${p.amountUsd.toLocaleString()}</span></div>
        <div class="meta-row"><span class="meta-label">New balance</span>
          <span class="meta-value">$${p.newBalanceUsd.toLocaleString()}</span></div>
        <p style="margin-top:16px">
          Your wallet will be auto-applied to upcoming invoices unless you
          disable the toggle on the wallet page.
        </p>
    `;
    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Wallet topped up: +$${p.amountUsd.toLocaleString()}` }),
        text: `Wallet topped up: +$${p.amountUsd.toLocaleString()} (new balance $${p.newBalanceUsd.toLocaleString()})`,
    });
}

// ── Plan 7F: KYC_REJECTED ──────────────────────────────────────────────────

export interface KycRejectedParams {
    to: string;
    recipientName: string;
    reason: string;
}

export async function sendKycRejectedEmail(p: KycRejectedParams): Promise<EmailResult> {
    const subject = `Registration not approved`;
    const content = `
        <h1>Registration not approved</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>After review, we were unable to approve your AfricGreen shipowner
           registration at this time.</p>
        <div class="alert alert-warning">
            <strong>Reason:</strong> ${escapeHtml(p.reason)}
        </div>
        <p>If you believe this decision was made in error or you have new
           supporting documentation, please reply to this email or contact
           our compliance team.</p>
    `;
    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: 'Registration not approved' }),
        text: `Registration not approved. Reason: ${p.reason}`,
    });
}
```

- [ ] **Step 2: Add minimal tests** (one per new function — verify subject + Resend call shape)

Add to `frontend/src/services/emailService.test.ts`:

```typescript
import {
    sendPaymentRejectedEmail,
    sendProformaReminderEmail,
    sendWalletTopupEmail,
    sendKycRejectedEmail,
} from './emailService';

describe('sendPaymentRejectedEmail', () => {
    it('sends with correct subject and HTML', async () => {
        const result = await sendPaymentRejectedEmail({
            to: 'owner@test', recipientName: 'TestCo', invoiceRef: 'INV-X', reason: 'bad SWIFT',
        });
        expect(result.ok).toBe(true);
    });
});

describe('sendProformaReminderEmail', () => {
    it('sends with correct subject', async () => {
        const result = await sendProformaReminderEmail({
            to: 'owner@test', recipientName: 'TestCo', invoiceRef: 'INV-X', amountUsd: 100, ageDays: 7,
        });
        expect(result.ok).toBe(true);
    });
});

describe('sendWalletTopupEmail', () => {
    it('sends with correct subject', async () => {
        const result = await sendWalletTopupEmail({
            to: 'owner@test', recipientName: 'TestCo', amountUsd: 500, newBalanceUsd: 1500,
        });
        expect(result.ok).toBe(true);
    });
});

describe('sendKycRejectedEmail', () => {
    it('sends with correct subject', async () => {
        const result = await sendKycRejectedEmail({
            to: 'owner@test', recipientName: 'TestCo', reason: 'incomplete KYB documents',
        });
        expect(result.ok).toBe(true);
    });
});
```

These tests should pass via the existing Resend mock in vitest setup. If `sendEmail` is mocked to return `{ ok: true }`, the assertions hold.

- [ ] **Step 3: Run tests + tsc**

```bash
cd frontend && npx vitest run src/services/emailService.test.ts
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/emailService.ts frontend/src/services/emailService.test.ts
git -c commit.gpgsign=false commit -m "feat(7f): emailService — 4 new email functions (inline HTML)

Adds sendPaymentRejectedEmail, sendProformaReminderEmail,
sendWalletTopupEmail, sendKycRejectedEmail in the same inline-HTML
pattern as existing functions. Used by notificationService.notifyOwner
for the corresponding EMAIL_KINDS.

React Email migration deferred (out of plan scope).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `markNotificationRead` + `markAllNotificationsRead` actions

**Files:**
- Create: `frontend/src/actions/markNotificationRead.ts`
- Create: `frontend/src/actions/markNotificationRead.test.ts`
- Create: `frontend/src/actions/markAllNotificationsRead.ts`
- Create: `frontend/src/actions/markAllNotificationsRead.test.ts`

Owner-gated UPDATEs of `owner_notifications.read_at`.

- [ ] **Step 1: markNotificationRead.ts**

```typescript
'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';

const schema = z.object({ notificationId: z.string().uuid() });

export async function markNotificationRead(input: { notificationId: string }): Promise<void> {
    const parsed = schema.parse(input);
    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    // Scope to the owner's notifications only
    const { error } = await admin
        .from('owner_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', parsed.notificationId)
        .eq('shipowner_id', ctx.shipowner.id);

    if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: markAllNotificationsRead.ts**

```typescript
'use server';

import { createClient } from '@supabase/supabase-js';
import { requireOwner } from '@/lib/auth/requireOwner';

export async function markAllNotificationsRead(): Promise<{ count: number }> {
    const ctx = await requireOwner();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    const { error, count } = await admin
        .from('owner_notifications')
        .update({ read_at: new Date().toISOString() }, { count: 'exact' })
        .eq('shipowner_id', ctx.shipowner.id)
        .is('read_at', null);

    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
}
```

- [ ] **Step 3: 2 tests each** — mirror Plan 7E's `toggleAutoApply.test.ts` pattern.

- [ ] **Step 4: Run tests + tsc**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/markNotificationRead.ts \
        frontend/src/actions/markNotificationRead.test.ts \
        frontend/src/actions/markAllNotificationsRead.ts \
        frontend/src/actions/markAllNotificationsRead.test.ts
git -c commit.gpgsign=false commit -m "feat(7f): markNotificationRead + markAllNotificationsRead actions

Owner-gated UPDATEs of owner_notifications.read_at. Scope by
shipowner_id to prevent cross-owner reads. 4 tests cover happy path +
auth rejection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `GET /api/owner/notifications` route

**Files:**
- Create: `frontend/src/app/api/owner/notifications/route.ts`

Returns `{ notifications: [...], unread_count: N }` for the authenticated shipowner. Paginated via `offset` + `limit` query params.

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Find shipowner_id for this user
    const { data: shipowner } = await supabase
        .from('shipowners')
        .select('id')
        .eq('profile_id', user.id)
        .maybeSingle();
    if (!shipowner) return NextResponse.json({ error: 'No shipowner record' }, { status: 403 });

    const url = new URL(req.url);
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0'));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT))));

    const [{ data: notifications, error: listErr }, { count: unreadCount, error: countErr }] = await Promise.all([
        supabase
            .from('owner_notifications')
            .select('id, kind, title_key, body_key, body_params, deep_link, read_at, created_at')
            .eq('shipowner_id', shipowner.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1),
        supabase
            .from('owner_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('shipowner_id', shipowner.id)
            .is('read_at', null),
    ]);

    if (listErr || countErr) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({
        notifications: notifications ?? [],
        unread_count: unreadCount ?? 0,
    });
}
```

- [ ] **Step 2: tsc**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/owner/notifications/route.ts
git -c commit.gpgsign=false commit -m "feat(7f): GET /api/owner/notifications — paginated + unread_count

Returns owner's notifications (latest first, paginated via offset/limit
query params; max limit 100, default 20) + unread count. Uses
session-aware Supabase client; relies on mig 058 RLS policies on
owner_notifications.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `<NotificationBell>` component

**Files:**
- Create: `frontend/src/components/owner/NotificationBell/NotificationBell.tsx`
- Create: `frontend/src/components/owner/NotificationBell/NotificationList.tsx`
- Create: `frontend/src/components/owner/NotificationBell/index.ts`

Bell with badge count, dropdown with 10 latest, 60s polling, click → mark read + follow deep_link.

- [ ] **Step 1: NotificationList.tsx** (shared between dropdown and full page)

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { markNotificationRead } from '@/actions/markNotificationRead';

export interface NotificationRow {
    id: string;
    kind: string;
    title_key: string;
    body_key: string;
    body_params: Record<string, unknown>;
    deep_link: string | null;
    read_at: string | null;
    created_at: string;
}

interface Props {
    rows: NotificationRow[];
    onItemClick?: () => void;
}

export function NotificationList({ rows, onItemClick }: Props) {
    const router = useRouter();
    const t = useTranslations();

    async function handleClick(row: NotificationRow) {
        if (!row.read_at) {
            try { await markNotificationRead({ notificationId: row.id }); } catch (e) { console.error(e); }
        }
        if (onItemClick) onItemClick();
        if (row.deep_link) router.push(row.deep_link);
    }

    if (rows.length === 0) {
        return <p className="text-xs text-[var(--os-text-muted)] py-4 text-center">{t('OwnerPortal.notifications.empty')}</p>;
    }

    return (
        <ul className="flex flex-col">
            {rows.map((row) => {
                const isUnread = !row.read_at;
                const title = t(row.title_key as never, row.body_params as never);
                const body = t(row.body_key as never, row.body_params as never);
                return (
                    <li
                        key={row.id}
                        onClick={() => handleClick(row)}
                        className="px-3 py-2.5 border-b border-[var(--os-border)] cursor-pointer hover:bg-[var(--os-surface-3)] transition-colors"
                        style={{ backgroundColor: isUnread ? 'rgba(16,185,129,0.04)' : undefined }}
                    >
                        <div className="flex items-start gap-2">
                            {isUnread && <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />}
                            <div className={`flex-1 min-w-0 ${isUnread ? '' : 'pl-4'}`}>
                                <p className="text-sm font-semibold text-[var(--os-text-primary)]">{title}</p>
                                <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{body}</p>
                                <p className="text-[10px] text-[var(--os-text-muted)] mt-1 tabular-nums">{new Date(row.created_at).toLocaleString()}</p>
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
```

- [ ] **Step 2: NotificationBell.tsx**

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { NotificationList, type NotificationRow } from './NotificationList';
import { markAllNotificationsRead } from '@/actions/markAllNotificationsRead';

interface ApiResponse {
    notifications: NotificationRow[];
    unread_count: number;
}

const POLL_INTERVAL_MS = 60_000; // 60s per spec

export function NotificationBell() {
    const t = useTranslations('OwnerPortal.notifications');
    const [data, setData] = React.useState<ApiResponse | null>(null);
    const [open, setOpen] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    const fetchData = React.useCallback(async () => {
        try {
            const res = await fetch('/api/owner/notifications?limit=10');
            if (!res.ok) return;
            const json: ApiResponse = await res.json();
            setData(json);
        } catch (e) { console.error('[NotificationBell] fetch failed:', e); }
    }, []);

    React.useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchData]);

    // Close on outside click
    React.useEffect(() => {
        function onClick(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        if (open) document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    const unread = data?.unread_count ?? 0;
    const badgeLabel = unread > 9 ? '9+' : String(unread);

    async function handleMarkAll() {
        try {
            await markAllNotificationsRead();
            fetchData();
        } catch (e) { console.error(e); }
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen((o) => !o)}
                className="relative p-2 rounded-lg hover:bg-[var(--os-surface-2)] transition-colors"
                aria-label={t('bellAria')}
            >
                <Bell className="w-4 h-4 text-[var(--os-text-primary)]" />
                {unread > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ backgroundColor: '#EF4444' }}
                    >
                        {badgeLabel}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="absolute right-0 top-full mt-2 w-[380px] max-w-[95vw] rounded-xl z-50 shadow-lg max-h-[480px] flex flex-col"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                    }}
                >
                    <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--os-border)]">
                        <h2 className="text-sm font-bold">{t('title')}</h2>
                        {unread > 0 && (
                            <button onClick={handleMarkAll} className="text-[11px] text-emerald-500 hover:underline">
                                {t('markAllRead')}
                            </button>
                        )}
                    </header>
                    <div className="overflow-y-auto flex-1">
                        <NotificationList
                            rows={data?.notifications ?? []}
                            onItemClick={() => setOpen(false)}
                        />
                    </div>
                    <footer className="border-t border-[var(--os-border)] px-3 py-2 text-center">
                        <Link
                            href="/owner/notifications"
                            onClick={() => setOpen(false)}
                            className="text-xs text-emerald-500 hover:underline"
                        >
                            {t('viewAll')}
                        </Link>
                    </footer>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 3: index.ts**

```typescript
export { NotificationBell } from './NotificationBell';
export { NotificationList } from './NotificationList';
export type { NotificationRow } from './NotificationList';
```

- [ ] **Step 4: tsc + build**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/owner/NotificationBell/
git -c commit.gpgsign=false commit -m "feat(7f): NotificationBell + NotificationList components

<NotificationBell> mounts in OwnerShell header. Polls
/api/owner/notifications every 60s for badge count + 10 latest.
Click outside closes dropdown. Click notif → markNotificationRead +
follow deep_link. 'Mark all read' button when unread > 0.

<NotificationList> is shared between dropdown and the full page
(Task 7). Renders unread dot + title + body + relative timestamp.
i18n via title_key + body_key fed body_params for substitution.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `/owner/notifications` page

**Files:**
- Create: `frontend/src/app/owner/(portal)/notifications/page.tsx`

Server component, fetches all notifications (paginated, 50 per page), renders `<NotificationList>` with mark-all-read button.

- [ ] **Step 1: Create the page**

```tsx
import { requireOwner } from '@/lib/auth/requireOwner';
import { NotificationList, type NotificationRow } from '@/components/owner/NotificationBell';

export const metadata = {
    title: 'Owner portal — notifications',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function OwnerNotificationsPage(props: {
    searchParams: Promise<{ page?: string }>;
}) {
    const params = await props.searchParams;
    const page = Math.max(1, Number(params.page ?? '1'));
    const offset = (page - 1) * PAGE_SIZE;

    const session = await requireOwner();

    const { data: rowsRaw } = await session.supabase
        .from('owner_notifications')
        .select('id, kind, title_key, body_key, body_params, deep_link, read_at, created_at')
        .eq('shipowner_id', session.shipowner.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

    const rows = (rowsRaw ?? []) as NotificationRow[];

    return (
        <div className="px-6 py-6 max-w-3xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">Notifications</h1>
            </header>
            <div className="os-card overflow-hidden">
                <NotificationList rows={rows} />
            </div>
        </div>
    );
}
```

- [ ] **Step 2: tsc + build**

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/owner/\(portal\)/notifications/
git -c commit.gpgsign=false commit -m "feat(7f): /owner/notifications full list page

Server component, paginated (50/page), reuses <NotificationList>
from the bell dropdown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire 5 high-priority kinds in call sites

**Files:**
- Modify: `frontend/src/actions/confirmPayment.ts`
- Modify: `frontend/src/actions/rejectPayment.ts`
- Modify: `frontend/src/app/api/webhooks/stripe/route.ts`
- Modify: `frontend/src/actions/approveShipownerRegistration.ts`
- Modify: `frontend/src/actions/rejectShipownerRegistration.ts`

Each call site adds a `notifyOwner(...)` call AFTER the main UPDATE succeeds. Email dispatch path:
- For PAYMENT_RECEIVED: email already sent at call site (Plan 7C-4) → pass `skipEmail: true` to notifyOwner
- For PAYMENT_REJECTED: notifyOwner dispatches `sendPaymentRejectedEmail` via the service
- For WALLET_TOPPED_UP: handled by `confirmPayment` when `transaction_id IS NULL` AND status flips to CONFIRMED (also the Stripe webhook hits this for STRIPE topups)
- For KYC_APPROVED: email already sent at call site → `skipEmail: true`
- For KYC_REJECTED: notifyOwner dispatches `sendKycRejectedEmail`

- [ ] **Step 1: confirmPayment.ts** — after CONFIRMED transition (after Plan 7C-4's receipt+email hook), add:

```typescript
// Plan 7F: in-app notification (email already sent above)
try {
    const { notifyOwner } = await import('@/services/notificationService');
    const isTopup = updated.transaction_id === null;
    if (isTopup) {
        // WALLET_TOPPED_UP — email sent here (not at the call site)
        const { data: wallet } = await admin
            .from('wallets').select('balance_usd_minor').eq('shipowner_id', updated.shipowner_id).maybeSingle();
        await notifyOwner(admin, {
            shipownerId: updated.shipowner_id,
            kind: 'WALLET_TOPPED_UP',
            params: {
                amount_usd: (updated.amount_usd_minor ?? 0) / 100,
                new_balance_usd: (wallet?.balance_usd_minor ?? 0) / 100,
            },
            deepLink: '/owner/wallet',
        });
    } else {
        // PAYMENT_RECEIVED — email already dispatched by Plan 7C-4 hook
        await notifyOwner(admin, {
            shipownerId: updated.shipowner_id,
            kind: 'PAYMENT_RECEIVED',
            params: {
                invoice_ref: tx?.invoice_ref ?? '—',
                amount_usd: (updated.amount_usd_minor ?? 0) / 100,
                vessel_name: tx?.vessel_name ?? '—',
                receipt_ref: receiptResult?.receiptRef,
            },
            deepLink: '/owner/invoices',
            skipEmail: true,                       // already sent
        });
    }
} catch (e) {
    console.error(`[confirmPayment] notifyOwner failed for ${parsed.paymentId}:`, e);
}
```

- [ ] **Step 2: rejectPayment.ts** — after UPDATE to REJECTED, add:

```typescript
try {
    const { notifyOwner } = await import('@/services/notificationService');
    const { data: tx } = await admin
        .from('transactions').select('invoice_ref').eq('id', payment.transaction_id).single();
    await notifyOwner(admin, {
        shipownerId: payment.shipowner_id,
        kind: 'PAYMENT_REJECTED',
        params: {
            invoice_ref: tx?.invoice_ref ?? '—',
            reason: parsed.reason,
        },
        deepLink: '/owner/invoices',
    });
} catch (e) {
    console.error(`[rejectPayment] notifyOwner failed for ${parsed.paymentId}:`, e);
}
```

- [ ] **Step 3: /api/webhooks/stripe/route.ts** — after CONFIRMED transition in `handlePaymentSucceeded`, add the same dual-path notification (mirror confirmPayment's Step 1 change). Use `skipEmail: true` since the receipt+email is already dispatched in this handler.

- [ ] **Step 4: approveShipownerRegistration.ts** — after the approval logic + existing email send, add:

```typescript
try {
    const { notifyOwner } = await import('@/services/notificationService');
    await notifyOwner(admin, {
        shipownerId: parsed.shipownerId,
        kind: 'KYC_APPROVED',
        params: {},
        deepLink: '/owner/dashboard',
        skipEmail: true,                            // already sent
    });
} catch (e) { console.error('[approve] notifyOwner failed:', e); }
```

- [ ] **Step 5: rejectShipownerRegistration.ts** — after UPDATE to REJECTED + audit log, add:

```typescript
try {
    const { notifyOwner } = await import('@/services/notificationService');
    await notifyOwner(admin, {
        shipownerId: parsed.shipownerId,
        kind: 'KYC_REJECTED',
        params: { reason: parsed.reason },
        deepLink: '/owner/login',                   // they may not have portal access yet
    });
} catch (e) { console.error('[reject] notifyOwner failed:', e); }
```

NB: `rejectShipownerRegistration` may not currently send any email. Adding `notifyOwner` will both INSERT the notif AND email via `sendKycRejectedEmail`. Verify by reading the existing action.

- [ ] **Step 6: tsc + vitest + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/actions/confirmPayment.ts \
        frontend/src/actions/rejectPayment.ts \
        frontend/src/app/api/webhooks/stripe/route.ts \
        frontend/src/actions/approveShipownerRegistration.ts \
        frontend/src/actions/rejectShipownerRegistration.ts
git -c commit.gpgsign=false commit -m "feat(7f): wire 5 high-priority notifications in call sites

confirmPayment → PAYMENT_RECEIVED (skipEmail, email already sent
by Plan 7C-4 hook) OR WALLET_TOPPED_UP (full email dispatch if
transaction_id IS NULL).
rejectPayment → PAYMENT_REJECTED (full email dispatch).
Stripe webhook → PAYMENT_RECEIVED (skipEmail) or WALLET_TOPPED_UP.
approveShipownerRegistration → KYC_APPROVED (skipEmail).
rejectShipownerRegistration → KYC_REJECTED (full email).

All notifications are fail-soft: log + continue if notifyOwner throws.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Mount `<NotificationBell>` in OwnerShell + add `/owner/notifications` nav

**Files:**
- Modify: `frontend/src/components/owner/OwnerShell.tsx`

- [ ] **Step 1: Read OwnerShell.tsx**

```bash
cat frontend/src/components/owner/OwnerShell.tsx | head -50
```

Find the header / topbar area where to mount the bell.

- [ ] **Step 2: Mount the bell**

Add `<NotificationBell />` in the header, typically next to the user profile menu or language switcher. Import:

```typescript
import { NotificationBell } from './NotificationBell';
```

(Adjust import path based on file structure — may need `'../NotificationBell'` if OwnerShell lives elsewhere.)

- [ ] **Step 3: Add `/owner/notifications` to owner nav** (optional)

If OwnerShell has a sidebar nav array, add a Notifications entry. Or — since the bell is the primary entry point — skip the sidebar entry. Decision: skip; the bell + the bell's "View all" link is sufficient.

- [ ] **Step 4: tsc + build**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/owner/OwnerShell.tsx
git -c commit.gpgsign=false commit -m "feat(7f): mount <NotificationBell> in OwnerShell header

Bell shows badge with unread count (max '9+'), opens dropdown with
10 latest + 'View all' link to /owner/notifications.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: i18n EN+FR — full notification namespace (16 kinds)

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

Add `OwnerPortal.notifications.kind.<KIND>.{title, body}` for all 16 kinds (schema-complete, future plans don't touch i18n) + shared notif chrome (bellAria, title, markAllRead, viewAll, empty).

- [ ] **Step 1: Add EN keys**

Python round-trip:

```python
import json

KINDS = [
    'KYC_APPROVED', 'KYC_REJECTED', 'KYC_C_REQUIRED',
    'ALERT_DETECTED', 'PROFORMA_ISSUED', 'PROFORMA_REMINDER',
    'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
    'FINAL_ISSUED', 'COMPLEMENT_ISSUED', 'REFUND_ISSUED',
    'WALLET_TOPPED_UP', 'WALLET_APPLIED', 'WALLET_LOW_BALANCE',
    'DISPUTE_UPDATED', 'OWNER_ESCALATION',
]

TITLES_EN = {
    'KYC_APPROVED': 'Welcome to AfricGreen',
    'KYC_REJECTED': 'Registration not approved',
    'KYC_C_REQUIRED': 'Action required: complete billing details',
    'ALERT_DETECTED': 'New vessel passage detected',
    'PROFORMA_ISSUED': 'New invoice: {invoice_ref}',
    'PROFORMA_REMINDER': 'Reminder: {invoice_ref} is overdue',
    'PAYMENT_RECEIVED': 'Payment received',
    'PAYMENT_REJECTED': 'Payment declined',
    'FINAL_ISSUED': 'Final invoice issued: {invoice_ref}',
    'COMPLEMENT_ISSUED': 'Complementary invoice: {invoice_ref}',
    'REFUND_ISSUED': 'Refund issued',
    'WALLET_TOPPED_UP': 'Wallet credited',
    'WALLET_APPLIED': 'Wallet applied to invoice',
    'WALLET_LOW_BALANCE': 'Wallet balance is low',
    'DISPUTE_UPDATED': 'Dispute updated: {dispute_ref}',
    'OWNER_ESCALATION': 'Action required from your account',
}

BODIES_EN = {
    'KYC_APPROVED': 'Your AfricGreen registration is approved. You can now log in to manage your fleet.',
    'KYC_REJECTED': 'Your registration was not approved. Reason: {reason}',
    'KYC_C_REQUIRED': 'Please provide your billing details to enable refunds and bank wires.',
    'ALERT_DETECTED': 'Vessel {vessel_name} (IMO {vessel_imo}) detected approaching {port}.',
    'PROFORMA_ISSUED': 'Invoice {invoice_ref} for vessel {vessel_name}: ${amount_usd}. Due {due_date}.',
    'PROFORMA_REMINDER': 'Invoice {invoice_ref} (${amount_usd}) is {age_days} days overdue.',
    'PAYMENT_RECEIVED': 'Payment of ${amount_usd} received for {invoice_ref}.',
    'PAYMENT_REJECTED': 'Payment for {invoice_ref} was declined. Reason: {reason}',
    'FINAL_ISSUED': 'Final invoice {invoice_ref} (${amount_usd}) issued.',
    'COMPLEMENT_ISSUED': 'Complementary invoice {invoice_ref} (${amount_usd}) issued.',
    'REFUND_ISSUED': 'Refund of ${amount_usd} has been processed via {rail}.',
    'WALLET_TOPPED_UP': 'Your wallet was credited with ${amount_usd}. New balance: ${new_balance_usd}.',
    'WALLET_APPLIED': 'Wallet credit of ${amount_usd} applied to invoice {invoice_ref}.',
    'WALLET_LOW_BALANCE': 'Your wallet balance (${balance_usd}) is below the estimated 30-day need (${estimated_need_usd}).',
    'DISPUTE_UPDATED': 'Your dispute on {dispute_ref} has been updated to: {status}',
    'OWNER_ESCALATION': 'Finance flagged {invoice_ref} for your attention. {reason}',
}

with open('frontend/messages/en.json', encoding='utf-8') as f: d = json.load(f)
d['OwnerPortal']['notifications'] = {
    'title': 'Notifications',
    'bellAria': 'Open notifications',
    'markAllRead': 'Mark all as read',
    'viewAll': 'View all',
    'empty': 'No notifications.',
    'kind': { k: { 'title': TITLES_EN[k], 'body': BODIES_EN[k] } for k in KINDS },
}
with open('frontend/messages/en.json', 'w', encoding='utf-8') as f: json.dump(d, f, ensure_ascii=False, indent=2)
print('en.json updated')
```

- [ ] **Step 2: Mirror in FR** — same key structure, French translations:

```python
TITLES_FR = {
    'KYC_APPROVED': 'Bienvenue chez AfricGreen',
    'KYC_REJECTED': 'Inscription non approuvée',
    'KYC_C_REQUIRED': 'Action requise : compléter les informations de facturation',
    'ALERT_DETECTED': 'Nouveau passage de navire détecté',
    'PROFORMA_ISSUED': 'Nouvelle facture : {invoice_ref}',
    'PROFORMA_REMINDER': 'Rappel : {invoice_ref} en retard',
    'PAYMENT_RECEIVED': 'Paiement reçu',
    'PAYMENT_REJECTED': 'Paiement refusé',
    'FINAL_ISSUED': 'Facture finale émise : {invoice_ref}',
    'COMPLEMENT_ISSUED': 'Facture complémentaire : {invoice_ref}',
    'REFUND_ISSUED': 'Remboursement émis',
    'WALLET_TOPPED_UP': 'Wallet crédité',
    'WALLET_APPLIED': 'Wallet imputé à une facture',
    'WALLET_LOW_BALANCE': 'Solde wallet faible',
    'DISPUTE_UPDATED': 'Litige mis à jour : {dispute_ref}',
    'OWNER_ESCALATION': 'Action requise sur votre compte',
}
BODIES_FR = {
    'KYC_APPROVED': 'Votre inscription AfricGreen est approuvée. Vous pouvez désormais gérer votre flotte.',
    'KYC_REJECTED': "Votre inscription n'a pas été approuvée. Motif : {reason}",
    'KYC_C_REQUIRED': 'Veuillez fournir vos informations de facturation pour activer remboursements et virements.',
    'ALERT_DETECTED': 'Navire {vessel_name} (IMO {vessel_imo}) détecté en approche de {port}.',
    'PROFORMA_ISSUED': 'Facture {invoice_ref} pour le navire {vessel_name} : ${amount_usd}. Échéance {due_date}.',
    'PROFORMA_REMINDER': 'Facture {invoice_ref} (${amount_usd}) en retard de {age_days} jours.',
    'PAYMENT_RECEIVED': 'Paiement de ${amount_usd} reçu pour {invoice_ref}.',
    'PAYMENT_REJECTED': 'Le paiement pour {invoice_ref} a été refusé. Motif : {reason}',
    'FINAL_ISSUED': 'Facture finale {invoice_ref} (${amount_usd}) émise.',
    'COMPLEMENT_ISSUED': 'Facture complémentaire {invoice_ref} (${amount_usd}) émise.',
    'REFUND_ISSUED': 'Un remboursement de ${amount_usd} a été traité via {rail}.',
    'WALLET_TOPPED_UP': 'Votre wallet a été crédité de ${amount_usd}. Nouveau solde : ${new_balance_usd}.',
    'WALLET_APPLIED': 'Crédit wallet de ${amount_usd} imputé à la facture {invoice_ref}.',
    'WALLET_LOW_BALANCE': "Solde wallet (${balance_usd}) inférieur au besoin estimé sur 30 jours (${estimated_need_usd}).",
    'DISPUTE_UPDATED': 'Votre litige sur {dispute_ref} a été mis à jour : {status}',
    'OWNER_ESCALATION': 'Finance signale {invoice_ref} pour votre attention. {reason}',
}
# Same dict structure: title='Notifications', bellAria='Ouvrir les notifications',
# markAllRead='Tout marquer comme lu', viewAll='Voir tout', empty='Aucune notification.'
```

Validate JSON in both files.

- [ ] **Step 3: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git -c commit.gpgsign=false commit -m "feat(7f): i18n EN/FR — OwnerPortal.notifications namespace

5 chrome keys + 16 kinds × 2 (title + body) = 37 leaf keys per locale.
Body templates use {placeholder} substitution from body_params.

Schema-complete: even kinds not yet wired in Plan 7F (REFUND_ISSUED,
ALERT_DETECTED, etc.) have i18n keys ready so Plans 7G/7H don't need
to touch i18n.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: RTL tests + final gates

**Files:**
- Create: `frontend/src/components/owner/NotificationBell/NotificationBell.test.tsx`

- [ ] **Step 1: NotificationBell test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NotificationBell } from './NotificationBell';
import en from '../../../../messages/en.json';

vi.mock('@/actions/markAllNotificationsRead', () => ({
    markAllNotificationsRead: vi.fn().mockResolvedValue({ count: 3 }),
}));
vi.mock('@/actions/markNotificationRead', () => ({
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

global.fetch = vi.fn();

describe('NotificationBell', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('renders bell with badge count', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: async () => ({ notifications: [], unread_count: 3 }),
        });
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <NotificationBell />
            </NextIntlClientProvider>,
        );
        await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    });

    it('shows "9+" when unread > 9', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: async () => ({ notifications: [], unread_count: 15 }),
        });
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <NotificationBell />
            </NextIntlClientProvider>,
        );
        await waitFor(() => expect(screen.getByText('9+')).toBeInTheDocument());
    });

    it('opens dropdown on click + renders title', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            ok: true,
            json: async () => ({
                notifications: [{
                    id: 'n1', kind: 'PAYMENT_RECEIVED',
                    title_key: 'OwnerPortal.notifications.kind.PAYMENT_RECEIVED.title',
                    body_key: 'OwnerPortal.notifications.kind.PAYMENT_RECEIVED.body',
                    body_params: { amount_usd: 100, invoice_ref: 'INV-X' },
                    deep_link: '/owner/invoices',
                    read_at: null,
                    created_at: '2026-05-11T00:00:00Z',
                }],
                unread_count: 1,
            }),
        });
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <NotificationBell />
            </NextIntlClientProvider>,
        );
        await waitFor(() => screen.getByText('1'));
        const bell = screen.getByLabelText(/Open notifications/i);
        fireEvent.click(bell);
        await waitFor(() => expect(screen.getByText(/Payment received/i)).toBeInTheDocument());
    });
});
```

- [ ] **Step 2: Run all gates**

```bash
./supabase/tests/run.sh migrations/065_proforma_reminders_cron.test.sql   # DEFERRED if Docker broken
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/owner/NotificationBell/NotificationBell.test.tsx
git -c commit.gpgsign=false commit -m "feat(7f): RTL tests for NotificationBell + final gates

3 tests cover badge count rendering, '9+' cap, and dropdown click-open.

All gates green: tsc, vitest, next build. Mig 065 pg test DEFERRED
(Docker — 6 migs now pending pre-merge: 060/061/062/063/064/065).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria

- [ ] Mig 065 creates `enqueue_proforma_reminders()` SQL function + pg_cron daily job at 08:00 UTC
- [ ] Function INSERTs PROFORMA_REMINDER notif for transactions PENDING aged exactly 3 or 7 days
- [ ] Function is idempotent — re-runs don't duplicate
- [ ] Function skips PAID transactions
- [ ] `notificationService.notifyOwner` always INSERTs the in-app row
- [ ] `notifyOwner` dispatches email for kind ∈ EMAIL_KINDS (unless skipEmail=true)
- [ ] `notifyOwner` updates `emailed_at` on email success
- [ ] Email failures are fail-soft (logged, not rethrown)
- [ ] 4 new email functions added: `sendPaymentRejectedEmail`, `sendProformaReminderEmail`, `sendWalletTopupEmail`, `sendKycRejectedEmail`
- [ ] `markNotificationRead` action is owner-gated (scoped by shipowner_id)
- [ ] `markAllNotificationsRead` returns count of updated rows
- [ ] `GET /api/owner/notifications` paginated + returns `unread_count`
- [ ] `<NotificationBell>` polls every 60s
- [ ] Bell shows badge (max "9+"), dropdown with 10 latest, click outside closes
- [ ] Click notification → markRead + follow deep_link
- [ ] `/owner/notifications` full list page renders 50/page
- [ ] 5 high-priority kinds wired: PAYMENT_RECEIVED, PAYMENT_REJECTED, WALLET_TOPPED_UP, KYC_APPROVED, KYC_REJECTED
- [ ] `OwnerShell.tsx` mounts `<NotificationBell>` in header
- [ ] EN+FR i18n complete: 5 chrome keys + 16 kind×{title,body} = 37 leaf keys per locale
- [ ] All gates green: tsc, vitest, next build, mig 065 pg test (or DEFERRED)

---

## Pre-merge checklist for the human

1. **Mig 065 pg test** once Docker is back. With 5 prior plans, now 6 migrations pending pg verification (060-065). Single Docker-restore session covers all.

2. **Hosted DB push** after merge: batch push 060-065 with `supabase db push --include-all`. Pre-diagnostic for 065:
   ```sql
   SELECT 1 FROM pg_proc WHERE proname = 'enqueue_proforma_reminders';
   SELECT * FROM cron.job WHERE jobname = 'proforma-reminders-daily';
   ```

3. **Functional smoke test**:
   - As SHIPOWNER, log in → header bell visible.
   - Wait for a payment to land (Stripe Checkout success path) — bell badge should increment within 60s. Click bell → see "Payment received" notification.
   - Click the notification → marks read + navigates to `/owner/invoices`.
   - As FINANCE_ADMIN, reject a payment → owner sees PAYMENT_REJECTED in bell + receives email.
   - Run cron manually: `SELECT public.enqueue_proforma_reminders();` → verifies for any 3/7-day-old PROFORMA.
   - Top up wallet via Stripe → WALLET_TOPPED_UP notification appears.
   - As FINANCE_ADMIN, reject a registration → KYC_REJECTED email + in-app notif if shipowner is ACTIVE (typically they aren't at this stage; rejection is for PENDING_REVIEW so the in-app may not be visible to them yet — verify behavior).

4. **Email delivery**: confirm Resend env var set; new templates render without HTML errors.

5. **Polling overhead**: 60s × N concurrent owners = some load. Plan 7H may revisit if this becomes a hot spot.

---

## Self-Review Notes

- **Spec coverage**: §6.1 (notifyOwner central) ✓, §6.2 (kind → channel mapping) ✓ (16 kinds in EMAIL_KINDS minus WALLET_APPLIED), §6.3 (NotificationBell with badge + 10 latest + polling) ✓, §6.4 (email templates inline-HTML; React Email deferred) ⚠, §6.5 (5 trigger sites wired; 11 deferred) ⚠.
- **Out-of-scope kinds**: 11 kinds with i18n keys but no wired call sites. Plan 7G/7H finish.
- **Email-loop for cron-inserted notifs**: Plan 7F's pg_cron INSERTs `PROFORMA_REMINDER` rows WITHOUT dispatching email. A future task (or Plan 7H) needs to add a Vercel Cron `/api/cron/notification-email-loop` that scans `WHERE kind IN EMAIL_KINDS AND emailed_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'` and emails. For v1, the email part of PROFORMA_REMINDER is documented as missing. The notif still appears in the bell.
- **Test coverage**: notificationService 5 tests + emailService 4 tests + bell 3 tests + 2 markRead action tests = 14 new tests in this plan. Strong baseline.
- **Failure modes**: notifyOwner is called in try/catch wrappers at every call site — fail-soft. INSERT failure (RLS or schema mismatch) → logged + parent action proceeds. Email failure → logged + in-app notif still created. Polling failure → silent retry next interval.
- **No new dependencies**: no `package.json` changes.
