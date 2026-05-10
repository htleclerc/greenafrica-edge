# Plan 7C-4 — Cash Desk + Receipt PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire receipt PDF generation into Plan 7C-1's `confirmPayment` flow (every CONFIRMED payment auto-generates a `RCT-YYYY-XXXX` receipt) and ship the `/admin/cash-desk` page that lets PORT_OFFICERs with `can_record_cash` declare cash payments rapidly with auto-numbered `CASH-YYYY-MM-DD-NNN` receipts. Owner and admin both gain a "Download receipt" link on confirmed payments.

**Architecture:** Heavy reuse of existing infrastructure — `invoiceService.generateReceiptPdf`, `buildReceiptRef`, `generateAndStoreReceipt`, and `emailService.sendPaymentConfirmationEmail` (all already shipped in the legacy v0 mark-paid flow) get plugged into the v7 `confirmPayment` server action via a small new `receiptService.ts` adapter. One Postgres migration (061) adds 3 columns to `payments` for receipt tracking + 1 column to `profiles` for the cash-desk sub-permission. The `/verify/[ref]` page is extended to handle the RCT ref type by querying `payments` instead of `transactions`. Cash desk is a dedicated lightweight page (not the 3-step `RecordManualPaymentDialog`) optimized for repeat data entry.

**Tech Stack:** PostgreSQL 17 / Supabase / Next.js 16 server actions / TypeScript strict / Vitest + RTL / next-intl. Reuses Plan 7C-1 (`confirmPayment`), Plan 7C-3 (`recordManualPayment`, `<PaymentReviewDrawer>`), legacy `invoiceService` (jsPDF + HMAC + QR), legacy `emailService.sendPaymentConfirmationEmail` with `receiptPdfBuffer` attachment.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §8.2 (cash-desk) + §8.5 (receipt PDF).

**Predecessor:** Plans 7C-1, 7C-2, 7C-3. Plan 7C-3 (PR #22) MUST be merged before 7C-4 starts because:
- `recordManualPayment` (Plan 7C-3) is reused by `<CashDeskForm>` with `rail='CASH'`.
- `<PaymentReviewDrawer>` (Plan 7C-3) gains the receipt-download button in this plan.

**Successor:** Plan 7C-5 drops `paymentIntentService` + the legacy `mark-paid` route (which is the only consumer of `generateReceiptPdf` today). The new v7 receipt generation in this plan replaces that path.

**Out of scope:**
- Async receipt generation via pgmq (sync-in-action is fine for v1 — cash volume is < 10/day, jsPDF runs in < 1s)
- Bulk re-generation of failed receipts (manual SQL for v1 if needed)
- Stripe webhook receipt path (Plan 7D will plug into the same `receiptService`)
- Cumulative receipts for partial payments (spec §8.5 says one receipt PER confirmed payment — that's what this delivers)
- React Email template `payment-received.tsx` — `sendPaymentConfirmationEmail` already inlines a complete HTML body; React Email migration deferred

---

## File Structure

### Files to create

```
supabase/migrations/
└── 061_payments_receipt_and_cash_perm.sql      # 3 cols on payments + can_record_cash

supabase/tests/migrations/
└── 061_payments_receipt_and_cash_perm.test.sql

frontend/src/services/
├── receiptService.ts                           # adapter: payment → ReceiptData → PDF + storage + email
└── receiptService.test.ts

frontend/src/app/api/receipts/[ref]/
└── download/route.ts                           # signed URL gated by owner OR admin

frontend/src/app/(dashboard)/admin/cash-desk/
└── page.tsx                                    # PORT_OFFICER + can_record_cash gate

frontend/src/components/dashboard/admin/CashDesk/
├── CashDeskForm.tsx                            # quick-entry CASH form
├── CashDeskForm.test.tsx
└── index.ts
```

### Files to modify

```
frontend/src/actions/confirmPayment.ts                                    # call generateReceipt + email after CONFIRMED
frontend/src/app/verify/[ref]/page.tsx                                    # branch on RCT ref type → query payments
frontend/src/lib/rbac.ts                                                  # add can_record_cash predicate + nav entry
frontend/src/components/dashboard/layout/DashboardSidebar.tsx             # add /admin/cash-desk nav item
frontend/src/app/owner/\(portal\)/invoices/InvoicesTable.tsx              # add "Receipt" download for CONFIRMED payments
frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/PaymentReviewDrawer.tsx   # add receipt-download link
frontend/messages/en.json                                                 # AdminCashDesk + Receipt download keys
frontend/messages/fr.json
```

### Test runners

```bash
# Postgres migration test
./supabase/tests/run.sh migrations/061_payments_receipt_and_cash_perm.test.sql

# Frontend Vitest (single file)
cd frontend && npx vitest run src/services/receiptService.test.ts

# Full gates
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

---

## Task 1: Migration 061 — receipt tracking + can_record_cash permission

**Files:**
- Create: `supabase/migrations/061_payments_receipt_and_cash_perm.sql`
- Create: `supabase/tests/migrations/061_payments_receipt_and_cash_perm.test.sql`

- [ ] **Step 1: Write the failing pg test**

Create `supabase/tests/migrations/061_payments_receipt_and_cash_perm.test.sql`:

```sql
BEGIN;

-- 1. Three new columns exist on payments
DO $$
DECLARE missing INT;
BEGIN
  SELECT COUNT(*) INTO missing
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name IN ('receipt_ref', 'receipt_storage_path', 'receipt_generated_at');
  ASSERT missing = 3, format('expected 3 receipt cols, found %s', missing);
END $$;

-- 2. receipt_ref UNIQUE when not null
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'payments_receipt_ref_unique';
  ASSERT n = 1, 'payments_receipt_ref_unique partial unique index missing';
END $$;

-- 3. profiles.can_record_cash exists with default false
DO $$
DECLARE col_default TEXT;
BEGIN
  SELECT column_default INTO col_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_record_cash';
  ASSERT col_default IS NOT NULL, 'can_record_cash column missing';
  ASSERT col_default LIKE 'false%', format('expected default false, got %s', col_default);
END $$;

-- 4. UNIQUE constraint enforced — inserting two payments with the same receipt_ref fails
INSERT INTO auth.users (id, email) VALUES
  ('11111111-aaaa-aaaa-aaaa-111111111111', 'unique-test@local');
INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES ('11111111-aaaa-aaaa-aaaa-111111111111', 'unique-test@local', 'Tester', 'FINANCE_ADMIN', true);
INSERT INTO public.shipowners (id, name, account_state, preferred_language)
  VALUES ('22222222-bbbb-bbbb-bbbb-222222222222', 'TestCo', 'ACTIVE', 'en');
INSERT INTO public.payments
  (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor, rail, status,
   receipt_ref, receipt_storage_path, receipt_generated_at)
  VALUES
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   10000, 'USD', 10000, 'WIRE_TRANSFER', 'CONFIRMED',
   'RCT-2026-DUPE', 'documents/receipts/RCT-2026-DUPE.pdf', NOW()),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   20000, 'USD', 20000, 'WIRE_TRANSFER', 'CONFIRMED',
   'RCT-2026-OTHER', 'documents/receipts/RCT-2026-OTHER.pdf', NOW());

DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments
      (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor, rail, status, receipt_ref)
      VALUES
      ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
       30000, 'USD', 30000, 'WIRE_TRANSFER', 'CONFIRMED', 'RCT-2026-DUPE');
    RAISE EXCEPTION 'expected unique violation, got success';
  EXCEPTION WHEN unique_violation THEN
    -- expected
    NULL;
  END;
END $$;

-- 5. NULL receipt_ref allowed multiple times (partial unique semantics)
INSERT INTO public.payments
  (shipowner_id, declared_by, amount_minor, currency, amount_usd_minor, rail, status, receipt_ref)
  VALUES
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   40000, 'USD', 40000, 'WIRE_TRANSFER', 'INITIATED', NULL),
  ('22222222-bbbb-bbbb-bbbb-222222222222', '11111111-aaaa-aaaa-aaaa-111111111111',
   50000, 'USD', 50000, 'WIRE_TRANSFER', 'INITIATED', NULL);

ROLLBACK;
```

- [ ] **Step 2: Run the test → FAIL**

```bash
./supabase/tests/run.sh migrations/061_payments_receipt_and_cash_perm.test.sql
```

Expected: FAIL on the first `ASSERT` — columns don't exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/061_payments_receipt_and_cash_perm.sql`:

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 061: Receipt tracking on payments + cash-desk sub-permission
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Plan 7C-4 wires automatic receipt PDF generation into the confirmPayment
-- flow. Each CONFIRMED payment ends up with a unique RCT-YYYY-XXXX receipt
-- ref, a stored PDF in Supabase Storage 'documents' bucket, and a generation
-- timestamp for idempotency.
--
-- The new profiles.can_record_cash boolean lets PORT_OFFICER (or any admin
-- role) be granted access to the /admin/cash-desk page where they record
-- in-person cash payments rapidly. FINANCE_ADMIN/SUPERADMIN bypass this
-- gate via their role permissions.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS receipt_ref           TEXT,
    ADD COLUMN IF NOT EXISTS receipt_storage_path  TEXT,
    ADD COLUMN IF NOT EXISTS receipt_generated_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.payments.receipt_ref IS
    'RCT-YYYY-XXXX human-readable receipt reference. Unique when set; NULL until receipt generated.';
COMMENT ON COLUMN public.payments.receipt_storage_path IS
    'Path in the Supabase Storage `documents` bucket (e.g. receipts/RCT-2026-ABCD.pdf).';
COMMENT ON COLUMN public.payments.receipt_generated_at IS
    'Set on first successful generation. Idempotency key: skip generation if NOT NULL.';

-- Partial unique index: NULL allowed multiple times, non-NULL must be unique
CREATE UNIQUE INDEX IF NOT EXISTS payments_receipt_ref_unique
    ON public.payments (receipt_ref)
    WHERE receipt_ref IS NOT NULL;

-- Cash-desk sub-permission. Default false — must be granted explicitly per
-- profile by a SUPERADMIN. FINANCE_ADMIN and SUPERADMIN bypass this in the
-- application layer (rbac.ts predicate `canRecordCash`).
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS can_record_cash BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_record_cash IS
    'Sub-permission gating /admin/cash-desk for PORT_OFFICER. FINANCE_ADMIN/SUPERADMIN bypass via role.';
```

- [ ] **Step 4: Re-run test → PASS**

```bash
./supabase/tests/run.sh migrations/061_payments_receipt_and_cash_perm.test.sql
```

Expected: all 5 ASSERTs green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/061_payments_receipt_and_cash_perm.sql \
        supabase/tests/migrations/061_payments_receipt_and_cash_perm.test.sql
git -c commit.gpgsign=false commit -m "feat(7c-4): mig 061 — receipt tracking + can_record_cash

- payments: 3 new cols (receipt_ref, receipt_storage_path,
  receipt_generated_at) for receipt PDF tracking. Partial unique index
  on receipt_ref (NULL allowed during INITIATED, must be unique when set).
- profiles.can_record_cash BOOLEAN DEFAULT false — sub-permission for
  /admin/cash-desk gating PORT_OFFICER access. FINANCE_ADMIN and
  SUPERADMIN bypass via role in rbac.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `receiptService.ts` — payment-to-ReceiptData adapter

**Files:**
- Create: `frontend/src/services/receiptService.ts`
- Create: `frontend/src/services/receiptService.test.ts`

The service is a thin adapter: load payment + transaction + shipowner from DB, build `ReceiptData` (the existing type from `invoiceService.ts:716`), call `generateAndStoreReceipt` (existing helper at `invoiceService.ts:1048`), then UPDATE `payments` with `receipt_ref / storage_path / generated_at`. Returns the PDF buffer for email attachment.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/services/receiptService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/services/invoiceService', async () => {
    const actual = await vi.importActual<typeof import('@/services/invoiceService')>('@/services/invoiceService');
    return {
        ...actual,
        generateReceiptPdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])), // "%PDF" magic bytes
        generateAndStoreReceipt: vi.fn().mockResolvedValue('https://example.com/signed/receipt.pdf'),
        buildReceiptRef: vi.fn().mockReturnValue('RCT-2026-ABCD'),
    };
});

import { generatePaymentReceipt } from './receiptService';
import { generateReceiptPdf, generateAndStoreReceipt, buildReceiptRef } from '@/services/invoiceService';

function makeClient(opts: {
    payment: Record<string, unknown> | null;
    transaction: Record<string, unknown> | null;
    shipowner: Record<string, unknown> | null;
    confirmer?: Record<string, unknown> | null;
    updateError?: { message: string } | null;
}) {
    const single = (data: unknown) => vi.fn().mockResolvedValue({ data, error: null });
    const eq = (data: unknown) => vi.fn(() => ({ single: single(data), maybeSingle: single(data) }));
    const select = (data: unknown) => vi.fn(() => ({ eq: eq(data) }));
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: opts.updateError ?? null }) }));

    return {
        from: vi.fn((table: string) => {
            if (table === 'payments')     return { select: select(opts.payment), update };
            if (table === 'transactions') return { select: select(opts.transaction) };
            if (table === 'shipowners')   return { select: select(opts.shipowner) };
            if (table === 'profiles')     return { select: select(opts.confirmer ?? null) };
            return { select: select(null) };
        }),
    } as unknown as SupabaseClient;
}

describe('generatePaymentReceipt', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('builds RCT ref, stores PDF, and updates payments row idempotently', async () => {
        const client = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                external_reference: 'SWIFT-123', confirmed_at: '2026-05-10T10:00:00Z',
                confirmed_by: 'admin-1', receipt_generated_at: null,
            },
            transaction: {
                id: 'tx-1', invoice_ref: 'INV-2026-ABCD',
                vessel_name: 'TEST VESSEL', vessel_imo: '9999999', vessel_mmsi: '0',
            },
            shipowner: { id: 'own-1', name: 'Acme Shipping', jurisdiction_country: 'KE' },
            confirmer: { id: 'admin-1', full_name: 'Jane Admin' },
        });

        const result = await generatePaymentReceipt(client, 'pay-1');

        expect(result.receiptRef).toBe('RCT-2026-ABCD');
        expect(buildReceiptRef).toHaveBeenCalledWith('tx-1', expect.any(Date));
        expect(generateReceiptPdf).toHaveBeenCalled();
        expect(generateAndStoreReceipt).toHaveBeenCalled();
        expect(result.pdfBuffer).toBeInstanceOf(Uint8Array);
        expect(result.pdfBuffer![0]).toBe(0x25); // %PDF magic
    });

    it('returns null + reason when receipt already generated (idempotent)', async () => {
        const client = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                receipt_ref: 'RCT-2026-EXIST', receipt_generated_at: '2026-05-10T11:00:00Z',
            },
            transaction: null, shipowner: null,
        });
        const result = await generatePaymentReceipt(client, 'pay-1');
        expect(result.receiptRef).toBe('RCT-2026-EXIST');
        expect(result.pdfBuffer).toBeUndefined();
        expect(result.alreadyGenerated).toBe(true);
        expect(generateReceiptPdf).not.toHaveBeenCalled();
    });

    it('throws when payment not found', async () => {
        const client = makeClient({ payment: null, transaction: null, shipowner: null });
        await expect(generatePaymentReceipt(client, 'pay-missing')).rejects.toThrow(/not found/i);
    });

    it('throws when transaction is null but payment.transaction_id is set', async () => {
        const client = makeClient({
            payment: {
                id: 'pay-1', transaction_id: 'tx-1', shipowner_id: 'own-1',
                amount_usd_minor: 50000, currency: 'USD', rail: 'WIRE_TRANSFER',
                receipt_generated_at: null,
            },
            transaction: null, shipowner: { id: 'own-1', name: 'X' },
        });
        await expect(generatePaymentReceipt(client, 'pay-1')).rejects.toThrow(/transaction/i);
    });
});
```

- [ ] **Step 2: Run tests → fail**

```bash
cd frontend && npx vitest run src/services/receiptService.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

Create `frontend/src/services/receiptService.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildReceiptRef,
    generateAndStoreReceipt,
    generateReceiptPdf,
    type ReceiptData,
} from '@/services/invoiceService';

const RAIL_DISPLAY: Record<string, string> = {
    STRIPE:           'Card Payment (Stripe)',
    WIRE_TRANSFER:    'Wire Transfer (SWIFT)',
    CASH:             'Cash Deposit',
    CHEQUE:           'Cheque',
    LETTER_OF_CREDIT: 'Letter of Credit',
    NETTING:          'Netting Settlement',
    THIRD_PARTY:      'Third-Party Payer',
    MOBILE_MONEY:     'Mobile Money',
    BANK_GUARANTEE:   'Bank Guarantee',
    WALLET:           'Wallet Credit',
};

export interface PaymentReceiptResult {
    receiptRef: string;
    storagePath?: string;
    pdfBuffer?: Uint8Array;
    publicUrl?: string;
    alreadyGenerated?: boolean;
}

/**
 * Generate (or fetch) the receipt for a CONFIRMED payment.
 * Idempotent: if `payments.receipt_generated_at` is set, returns the existing
 * ref without re-generating.
 *
 * Steps when generating:
 *   1. Load payment + transaction + shipowner + confirmer profile.
 *   2. Build `ReceiptData` shape expected by invoiceService.generateReceiptPdf.
 *   3. Build `receipt_ref` via buildReceiptRef(transaction_id, paid_at).
 *   4. Call generateAndStoreReceipt to upload PDF to Storage `documents` bucket.
 *   5. UPDATE payments with receipt_ref + storage_path + generated_at.
 *   6. Return ref + PDF buffer (caller may attach to email).
 */
export async function generatePaymentReceipt(
    client: SupabaseClient,
    paymentId: string,
): Promise<PaymentReceiptResult> {
    // 1. Load payment row
    const { data: payment, error: payErr } = await client
        .from('payments')
        .select('id, transaction_id, shipowner_id, amount_usd_minor, amount_minor, currency, rail, external_reference, confirmed_at, confirmed_by, receipt_ref, receipt_storage_path, receipt_generated_at, rail_details')
        .eq('id', paymentId)
        .single();
    if (payErr || !payment) throw new Error(`Payment ${paymentId} not found`);

    // Idempotency
    if (payment.receipt_generated_at) {
        return {
            receiptRef: payment.receipt_ref as string,
            storagePath: (payment.receipt_storage_path as string | null) ?? undefined,
            alreadyGenerated: true,
        };
    }

    if (!payment.transaction_id) {
        throw new Error(`Payment ${paymentId} has no transaction_id — receipts only generated for invoice-linked payments`);
    }

    // 2. Load related rows
    const [{ data: tx }, { data: owner }, { data: confirmer }] = await Promise.all([
        client.from('transactions').select('id, invoice_ref, vessel_name, vessel_imo, vessel_mmsi').eq('id', payment.transaction_id).single(),
        client.from('shipowners').select('id, name, jurisdiction_country').eq('id', payment.shipowner_id).single(),
        payment.confirmed_by
            ? client.from('profiles').select('id, full_name').eq('id', payment.confirmed_by).single()
            : Promise.resolve({ data: null }),
    ]);
    if (!tx) throw new Error(`Transaction ${payment.transaction_id} not found for payment ${paymentId}`);
    if (!owner) throw new Error(`Shipowner ${payment.shipowner_id} not found for payment ${paymentId}`);

    // 3. Build refs and timestamps
    const paidAt = payment.confirmed_at ? new Date(payment.confirmed_at as string) : new Date();
    const receiptRef = buildReceiptRef(payment.transaction_id as string, paidAt);

    // 4. Build ReceiptData
    const data: ReceiptData = {
        receiptRef,
        invoiceRef: tx.invoice_ref ?? `TX-${(tx.id as string).slice(0, 8)}`,
        vesselName: tx.vessel_name as string,
        vesselImo: tx.vessel_imo as string,
        vesselMmsi: (tx.vessel_mmsi as string | null) ?? '0',
        ownerName: owner.name as string,
        jurisdiction: (owner.jurisdiction_country as string | null) ?? '—',
        amountUsd: (payment.amount_usd_minor as number) / 100,
        paidAt: paidAt.toLocaleString('en-US', { year: 'numeric', month: 'long', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }),
        paymentMethod: RAIL_DISPLAY[payment.rail as string] ?? (payment.rail as string),
        paymentReference: (payment.external_reference as string | null) ?? undefined,
        confirmedBy: (confirmer?.full_name as string | null) ?? 'Solid Technology Finance',
    };

    // 5. Generate PDF buffer + upload
    const pdfBuffer = await generateReceiptPdf(data);
    const publicUrl = await generateAndStoreReceipt(client, data);
    const storagePath = `receipts/${receiptRef}.pdf`;

    // 6. UPDATE payments idempotently
    const { error: updErr } = await client
        .from('payments')
        .update({
            receipt_ref: receiptRef,
            receipt_storage_path: storagePath,
            receipt_generated_at: new Date().toISOString(),
        })
        .eq('id', paymentId);
    if (updErr) {
        // PDF already uploaded — log but don't throw. Caller can retry.
        console.error(`[receiptService] payments UPDATE failed for ${paymentId}: ${updErr.message}`);
    }

    return { receiptRef, storagePath, pdfBuffer, publicUrl: publicUrl ?? undefined };
}
```

**IMPORTANT — about `generateAndStoreReceipt` behavior**: the existing helper at `invoiceService.ts:1048` writes to `documents/receipts/{receiptRef}.pdf` and returns a public URL. Confirm the path convention by reading that function before relying on the hard-coded `receipts/${receiptRef}.pdf` storage_path string above. If the convention differs, adjust.

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run src/services/receiptService.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 5: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/receiptService.ts \
        frontend/src/services/receiptService.test.ts
git -c commit.gpgsign=false commit -m "feat(7c-4): receiptService — payment → ReceiptData → PDF + storage

Thin adapter over the existing invoiceService receipt primitives:
- buildReceiptRef(transaction_id, paid_at)
- generateReceiptPdf(ReceiptData)
- generateAndStoreReceipt(client, ReceiptData)

generatePaymentReceipt(client, paymentId) is idempotent via
receipt_generated_at marker. Loads payment + transaction + shipowner +
confirmer, assembles ReceiptData with rail-specific paymentMethod label,
uploads PDF, UPDATEs payments row. Returns ref + PDF buffer for email
attachment by the caller (confirmPayment action in Task 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Hook `confirmPayment` — generate receipt + send email

**Files:**
- Modify: `frontend/src/actions/confirmPayment.ts`
- Modify: `frontend/src/actions/confirmPayment.test.ts`

After the action transitions a payment to CONFIRMED and applies overpayment-to-wallet (if any), generate the receipt and send the confirmation email. Both are fail-soft — log on error, don't roll back the confirmation.

- [ ] **Step 1: Read the existing action**

```bash
cat frontend/src/actions/confirmPayment.ts | head -120
```

Note where the success path returns (after the `recompute_transaction_status` and wallet credit logic). The receipt+email block goes there, BEFORE the return.

- [ ] **Step 2: Add receipt + email block**

Edit `frontend/src/actions/confirmPayment.ts`. Find the section where the payment was successfully UPDATEd to status='CONFIRMED' (look for the `update({ status: 'CONFIRMED', ... })` chain). After that update succeeds AND after `recompute_transaction_status` is called, add:

```typescript
// Plan 7C-4: generate receipt PDF + send confirmation email
// Both fail-soft — log on error, don't roll back the confirmation.
let receiptResult: { receiptRef: string; pdfBuffer?: Uint8Array } | null = null;
try {
    const { generatePaymentReceipt } = await import('@/services/receiptService');
    receiptResult = await generatePaymentReceipt(admin, parsed.paymentId);
} catch (e) {
    console.error(`[confirmPayment] receipt generation failed for ${parsed.paymentId}:`, e);
}

try {
    const { sendPaymentConfirmationEmail } = await import('@/services/emailService');

    // Lookup recipient (shipowner contact)
    const { data: ownerRow } = await admin
        .from('shipowners')
        .select('name, official_email')
        .eq('id', payment.shipowner_id)
        .single();

    if (ownerRow?.official_email) {
        const { data: tx } = await admin
            .from('transactions')
            .select('invoice_ref, vessel_name, tax_amount_usd')
            .eq('id', payment.transaction_id)
            .single();

        await sendPaymentConfirmationEmail({
            to: ownerRow.official_email as string,
            recipientName: (ownerRow.name as string) ?? 'Shipowner',
            vesselName: (tx?.vessel_name as string) ?? '—',
            invoiceRef: (tx?.invoice_ref as string) ?? '—',
            amountUsd: (payment.amount_usd_minor ?? 0) / 100,
            paidAt: new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),
            receiptRef: receiptResult?.receiptRef,
            receiptPdfBuffer: receiptResult?.pdfBuffer,
        });
    }
} catch (e) {
    console.error(`[confirmPayment] email send failed for ${parsed.paymentId}:`, e);
}
```

The exact placement depends on where the existing action's success path is — do NOT replace the `return` statement, just insert these blocks BEFORE it.

**Caveat — variable scoping**: the snippet uses `payment` (the row variable from earlier in the action) and `admin` (the service-role Supabase client). Verify both names match the existing source. If the existing action calls them differently (e.g. `client` instead of `admin`), use those names.

- [ ] **Step 3: Update the existing test**

Add to `frontend/src/actions/confirmPayment.test.ts` a new mock + 1-2 tests:

```typescript
vi.mock('@/services/receiptService', () => ({
    generatePaymentReceipt: vi.fn().mockResolvedValue({
        receiptRef: 'RCT-2026-TEST',
        pdfBuffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }),
}));

vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

// In an existing happy-path test (or add a new one):
it('generates a receipt and sends confirmation email after CONFIRMED', async () => {
    // ...existing setup that drives a payment to CONFIRMED via the action...
    await confirmPayment({ paymentId: 'pay-1' });

    const { generatePaymentReceipt } = await import('@/services/receiptService');
    const { sendPaymentConfirmationEmail } = await import('@/services/emailService');
    expect(generatePaymentReceipt).toHaveBeenCalledWith(expect.anything(), 'pay-1');
    expect(sendPaymentConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({
        receiptRef: 'RCT-2026-TEST',
    }));
});

it('confirmPayment succeeds even when receipt generation fails', async () => {
    const { generatePaymentReceipt } = await import('@/services/receiptService');
    (generatePaymentReceipt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('PDF crash'));
    // ...drive action to CONFIRMED...
    await expect(confirmPayment({ paymentId: 'pay-1' })).resolves.toBeDefined();
});
```

The test setup follows the existing `confirmPayment.test.ts` pattern — re-use the existing fake-supabase client. Don't rewrite the whole file; just add the 2 new tests at the end.

- [ ] **Step 4: Run tests + tsc + build**

```bash
cd frontend && npx vitest run src/actions/confirmPayment.test.ts
cd frontend && npx tsc --noEmit
```

Both must succeed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/confirmPayment.ts frontend/src/actions/confirmPayment.test.ts
git -c commit.gpgsign=false commit -m "feat(7c-4): confirmPayment generates receipt + emails owner

After CONFIRMED transition + wallet credit + recompute_transaction_status,
generate the receipt PDF via receiptService and email it via
sendPaymentConfirmationEmail (PDF attached). Both are fail-soft — errors
are logged but do not roll back the CONFIRMED state. Idempotency lives
in receiptService.generatePaymentReceipt (skips if receipt_generated_at
is set).

+ 2 tests: happy-path (asserts both helpers called) and failure-soft
(receipt failure does not throw).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `/api/receipts/[ref]/download` — signed URL

**Files:**
- Create: `frontend/src/app/api/receipts/[ref]/download/route.ts`

Returns a redirect to a 5-minute signed URL for the receipt PDF in Storage. Auth: shipowner can download their own receipts; FINANCE_ADMIN/SUPERADMIN can download any. PORT_OFFICER cannot (no need; they don't review).

- [ ] **Step 1: Create the route**

Create `frontend/src/app/api/receipts/[ref]/download/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ADMIN_ROLES = new Set(['FINANCE_ADMIN', 'SUPERADMIN']);

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ ref: string }> },
) {
    const { ref } = await ctx.params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Find the payment by receipt_ref
    const { data: payment } = await supabase
        .from('payments')
        .select('id, shipowner_id, receipt_storage_path, receipt_generated_at')
        .eq('receipt_ref', ref)
        .maybeSingle();
    if (!payment || !payment.receipt_storage_path) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    }

    // Auth check: caller must be the shipowner OR a finance admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    const role = profile?.role as string | undefined;
    const isAdmin = role && ADMIN_ROLES.has(role);

    if (!isAdmin) {
        // Verify caller owns this shipowner row
        const { data: ownerLink } = await supabase
            .from('shipowners')
            .select('id')
            .eq('id', payment.shipowner_id)
            .eq('profile_id', user.id)
            .maybeSingle();
        if (!ownerLink) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Issue 5-minute signed URL
    const { data: signed, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(payment.receipt_storage_path as string, 300);
    if (error || !signed) {
        return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 });
    }

    return NextResponse.redirect(signed.signedUrl);
}
```

- [ ] **Step 2: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/receipts/
git -c commit.gpgsign=false commit -m "feat(7c-4): GET /api/receipts/[ref]/download

Resolves receipt_ref → payments row → 5-min signed Storage URL → 302
redirect. Auth: shipowner-of-record OR FINANCE_ADMIN/SUPERADMIN.
PORT_OFFICER blocked (they don't review payments).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extend `/verify/[ref]/page.tsx` to handle RCT refs

**Files:**
- Modify: `frontend/src/app/verify/[ref]/page.tsx`

The existing public verify page handles `PRO/INV/COMPLEMENT/REFUND` refs by querying `transactions`. Add a branch: when `parseInvoiceRef(ref).type === 'RCT'`, query `payments` instead and show payment-specific fields (rail, declared_by name, confirmed_by name, amount USD, currency, payment-rail label).

- [ ] **Step 1: Read the existing page**

```bash
wc -l frontend/src/app/verify/\[ref\]/page.tsx
```

It's likely ~200-300 lines. The data flow has 3 phases: (1) parse ref + verify HMAC + reject if invalid, (2) DB lookup, (3) render. Add the RCT branch in phase 2.

- [ ] **Step 2: Add the RCT lookup**

Around the existing transaction lookup (search for `from('transactions')`), add a parallel branch:

```typescript
// Plan 7C-4: extend verify page to handle RCT refs (receipts)
const parsed = parseInvoiceRef(ref);
if (parsed?.type === 'RCT') {
    const { data: payment } = await supabase
        .from('payments')
        .select(`
            id, receipt_ref, content_hash:receipt_storage_path, receipt_generated_at,
            amount_usd_minor, currency, rail, status, confirmed_at,
            shipowner:shipowners(name),
            transaction:transactions(invoice_ref, vessel_name, vessel_imo)
        `)
        .eq('receipt_ref', ref)
        .maybeSingle();

    if (!payment) {
        // Same "Unknown" branch as for invoices — never leak existence.
        return <UnknownDocument />;
    }

    return (
        <ReceiptVerifyView
            ref={ref}
            generatedAt={payment.receipt_generated_at}
            amountUsd={(payment.amount_usd_minor as number) / 100}
            currency={payment.currency as string}
            rail={payment.rail as string}
            invoiceRef={payment.transaction?.invoice_ref ?? '—'}
            vesselName={payment.transaction?.vessel_name ?? '—'}
            vesselImo={payment.transaction?.vessel_imo ?? '—'}
            ownerName={payment.shipowner?.name ?? '—'}
            confirmedAt={payment.confirmed_at}
        />
    );
}

// existing transaction-based branch follows...
```

The `<ReceiptVerifyView>` component is a small new presentational component you'll add inline in the same file (to avoid creating yet another file). It mirrors the existing invoice verify view's layout but with payment-specific fields.

**Note**: you do NOT need a new HMAC step for receipts because the QR signature was generated using the same `signInvoiceRef` function (which works on any ref string regardless of prefix). The existing signature verification in the page applies unchanged.

- [ ] **Step 3: Add the inline `<ReceiptVerifyView>` component**

At the bottom of the same `page.tsx`, add a small functional component:

```tsx
function ReceiptVerifyView(props: {
    ref: string;
    generatedAt: string | null;
    amountUsd: number;
    currency: string;
    rail: string;
    invoiceRef: string;
    vesselName: string;
    vesselImo: string;
    ownerName: string;
    confirmedAt: string | null;
}) {
    return (
        <main className="max-w-2xl mx-auto py-8 px-4">
            <div className="flex items-center gap-3 mb-6">
                <Receipt className="w-6 h-6 text-emerald-500" />
                <h1 className="text-xl font-bold">Authentic receipt</h1>
            </div>
            <div className="rounded-2xl border bg-[var(--os-surface-2)] p-5 grid grid-cols-2 gap-3 text-sm">
                <Field label="Receipt ref"  value={props.ref} mono />
                <Field label="Invoice ref"  value={props.invoiceRef} mono />
                <Field label="Owner"        value={props.ownerName} />
                <Field label="Vessel"       value={`${props.vesselName} (IMO ${props.vesselImo})`} />
                <Field label="Amount"       value={`$${props.amountUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${props.currency}`} mono />
                <Field label="Rail"         value={props.rail} mono />
                <Field label="Confirmed"    value={props.confirmedAt ? new Date(props.confirmedAt).toLocaleString() : '—'} />
                <Field label="Issued"       value={props.generatedAt ? new Date(props.generatedAt).toLocaleString() : '—'} />
            </div>
            <p className="text-xs text-emerald-600 mt-4">
                ✓ Cryptographic signature verified. This receipt was issued by AfricGreen.
            </p>
        </main>
    );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--os-text-muted)]">{label}</p>
            <p className={`text-sm ${mono ? 'font-mono' : ''}`}>{value}</p>
        </div>
    );
}
```

If `<Field>` already exists in the file (likely — invoices use a similar layout), reuse it instead of redeclaring. Inspect the file before adding.

- [ ] **Step 4: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

Both must succeed. The page is `force-dynamic` so the new path is verified at runtime.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/verify/\[ref\]/page.tsx
git -c commit.gpgsign=false commit -m "feat(7c-4): /verify/[ref] handles RCT receipts

When parseInvoiceRef returns type='RCT', query payments instead of
transactions. Render <ReceiptVerifyView> with payment-specific fields
(rail, currency, amount USD, owner, vessel, confirmed_at, issued_at).
HMAC signature verification reuses the existing signInvoiceRef logic
(works on any ref prefix).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `<CashDeskForm>` + `/admin/cash-desk` page

**Files:**
- Create: `frontend/src/components/dashboard/admin/CashDesk/CashDeskForm.tsx`
- Create: `frontend/src/components/dashboard/admin/CashDesk/index.ts`
- Create: `frontend/src/app/(dashboard)/admin/cash-desk/page.tsx`

A simplified, repeat-data-entry-friendly form. CASH-only. Auto-numbers receipts as `CASH-YYYY-MM-DD-NNN` (NNN = sequential counter that resets daily — implemented client-side via list of today's payments + 1; collisions extremely unlikely given < 10/day cash flow). Wraps Plan 7C-3's `recordManualPayment` action with `rail='CASH'`, which already forces `INITIATED` for CASH (4-eyes per mig 057).

- [ ] **Step 1: Create the form component**

Create `frontend/src/components/dashboard/admin/CashDesk/CashDeskForm.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Banknote, CheckCircle2, RefreshCw, Upload, X } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { recordManualPayment } from '@/actions/recordManualPayment';
import { ALLOWED_PROOF_MIME_TYPES, MAX_PROOF_SIZE_BYTES } from '@/services/paymentProofService';

interface ShipownerOption { id: string; name: string }
interface TransactionOption { id: string; invoice_ref: string | null; tax_amount_usd: number }

export function CashDeskForm() {
    const t = useTranslations('AdminCashDesk');
    const [shipownerQuery, setShipownerQuery] = React.useState('');
    const [shipownerResults, setShipownerResults] = React.useState<ShipownerOption[]>([]);
    const [shipowner, setShipowner] = React.useState<ShipownerOption | null>(null);
    const [txnResults, setTxnResults] = React.useState<TransactionOption[]>([]);
    const [transaction, setTransaction] = React.useState<TransactionOption | null>(null);
    const [amount, setAmount] = React.useState('');
    const [currency, setCurrency] = React.useState('USD');
    const [receiptNumber, setReceiptNumber] = React.useState(buildAutoReceiptNumber());
    const [proof, setProof] = React.useState<File | null>(null);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [success, setSuccess] = React.useState<{ paymentId: string; receiptNumber: string } | null>(null);
    const fileRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (shipownerQuery.length < 2 || shipowner) { setShipownerResults([]); return; }
        const timer = setTimeout(async () => {
            const url = new URL('/api/admin/shipowners/search', window.location.origin);
            url.searchParams.set('q', shipownerQuery);
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setShipownerResults(data.shipowners ?? []);
            }
        }, 250);
        return () => clearTimeout(timer);
    }, [shipownerQuery, shipowner]);

    React.useEffect(() => {
        if (!shipowner) { setTxnResults([]); return; }
        (async () => {
            const res = await fetch(`/api/admin/shipowners/${shipowner.id}/open-transactions`);
            if (res.ok) {
                const data = await res.json();
                setTxnResults(data.transactions ?? []);
            }
        })();
    }, [shipowner]);

    function reset(keepShipowner = true) {
        if (!keepShipowner) {
            setShipowner(null);
            setShipownerQuery('');
        }
        setTransaction(null);
        setAmount('');
        setCurrency('USD');
        setProof(null);
        setReceiptNumber(buildAutoReceiptNumber());
        setError(null);
    }

    function pickFile(list: FileList | null) {
        if (!list || list.length === 0) return;
        const f = list[0];
        if (f.size > MAX_PROOF_SIZE_BYTES) { setError(t('errors.fileTooBig')); return; }
        if (!ALLOWED_PROOF_MIME_TYPES.has(f.type)) { setError(t('errors.fileMime')); return; }
        setProof(f);
        setError(null);
    }

    async function submit() {
        setError(null);
        if (!shipowner) { setError(t('errors.shipownerRequired')); return; }
        if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount)) { setError(t('errors.amountInvalid')); return; }
        if (!receiptNumber.trim()) { setError(t('errors.receiptRequired')); return; }

        setSubmitting(true);
        try {
            const created = await recordManualPayment({
                shipownerId: shipowner.id,
                transactionId: transaction?.id ?? null,
                rail: 'CASH',
                amount,
                currency,
                railDetails: {
                    receipt_number: receiptNumber,
                    cashier: 'self', // server stamps declared_by from auth session
                },
                confirmImmediately: false, // forced false for CASH anyway (mig 057 rule)
            });

            // Upload proof if present (uses Plan 7C-3 admin proof endpoint)
            if (proof) {
                const fd = new FormData();
                fd.append('file', proof);
                fd.append('shipowner_id', shipowner.id);
                await fetch(`/api/admin/payments/${created.id}/proofs`, { method: 'POST', body: fd });
            }

            setSuccess({ paymentId: created.id, receiptNumber });
            reset(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : t('errors.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="os-card p-5 max-w-xl mx-auto">
            <header className="flex items-center gap-3 mb-4">
                <Banknote className="w-5 h-5 text-emerald-500" />
                <h1 className="text-lg font-bold">{t('title')}</h1>
            </header>
            <p className="text-xs text-[var(--os-text-muted)] mb-4">{t('subtitle')}</p>

            {success && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-emerald-600">{t('success.title')}</p>
                        <p className="text-xs text-[var(--os-text-muted)]">{t('success.body', { ref: success.receiptNumber })}</p>
                        <button onClick={() => setSuccess(null)} className="text-[10px] text-emerald-500 mt-1 underline">{t('success.dismiss')}</button>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-3">
                {/* Shipowner */}
                <Field label={t('field.shipowner')} required>
                    <OsInput
                        value={shipowner ? shipowner.name : shipownerQuery}
                        onChange={(e) => {
                            if (shipowner) setShipowner(null);
                            setShipownerQuery(e.target.value);
                        }}
                        placeholder={t('field.shipownerPlaceholder')}
                    />
                    {!shipowner && shipownerResults.length > 0 && (
                        <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                            {shipownerResults.map((s) => (
                                <li
                                    key={s.id}
                                    onClick={() => { setShipowner(s); setShipownerQuery(''); setShipownerResults([]); }}
                                    className="px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--os-surface-3)]"
                                >
                                    {s.name}
                                </li>
                            ))}
                        </ul>
                    )}
                </Field>

                {/* Transaction (optional) */}
                {shipowner && txnResults.length > 0 && (
                    <Field label={t('field.transaction')}>
                        <select
                            value={transaction?.id ?? ''}
                            onChange={(e) => {
                                const tx = txnResults.find((x) => x.id === e.target.value) ?? null;
                                setTransaction(tx);
                                if (tx) setAmount(tx.tax_amount_usd.toFixed(2));
                            }}
                            className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-primary)]"
                        >
                            <option value="">{t('field.transactionNone')}</option>
                            {txnResults.map((tx) => (
                                <option key={tx.id} value={tx.id}>
                                    {tx.invoice_ref ?? tx.id.slice(0, 8)} — ${tx.tax_amount_usd.toFixed(2)}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}

                {/* Amount + currency */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                        <Field label={t('field.amount')} required>
                            <OsInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                        </Field>
                    </div>
                    <div>
                        <Field label={t('field.currency')}>
                            <OsInput value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} />
                        </Field>
                    </div>
                </div>

                {/* Receipt number */}
                <Field label={t('field.receiptNumber')} required>
                    <div className="flex items-center gap-2">
                        <OsInput value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} />
                        <button
                            type="button"
                            onClick={() => setReceiptNumber(buildAutoReceiptNumber())}
                            className="text-[10px] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]"
                            title={t('field.regen')}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </Field>

                {/* Proof upload */}
                <Field label={t('field.proof')}>
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-emerald-500"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        {proof ? proof.name : t('field.proofCta')}
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                        className="hidden"
                        onChange={(e) => pickFile(e.target.files)}
                    />
                    {proof && (
                        <button onClick={() => setProof(null)} className="text-[10px] text-red-500 mt-1">
                            <X className="inline w-3 h-3" /> {t('field.proofRemove')}
                        </button>
                    )}
                </Field>

                {error && <p className="text-xs text-red-500">{error}</p>}

                <div className="flex items-center justify-between mt-2">
                    <OsButton variant="secondary" size="sm" onClick={() => reset(false)} disabled={submitting}>
                        {t('reset')}
                    </OsButton>
                    <OsButton variant="primary" size="sm" onClick={submit} disabled={submitting}>
                        {submitting ? t('submitting') : t('submit')}
                    </OsButton>
                </div>

                <p className="text-[10px] text-[var(--os-text-muted)] mt-2 text-center">
                    {t('fourEyesNote')}
                </p>
            </div>
        </div>
    );
}

function buildAutoReceiptNumber(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    // NNN counter is best-effort: use minutes-of-day mod 1000 for uniqueness within a busy day.
    // Cashier can edit if a duplicate is suggested.
    const counter = String(now.getHours() * 60 + now.getMinutes()).padStart(3, '0');
    return `CASH-${y}-${m}-${d}-${counter}`;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-[var(--os-text-secondary)] uppercase tracking-wide">
                {label} {required && <span className="text-red-500">*</span>}
            </span>
            {children}
        </label>
    );
}
```

- [ ] **Step 2: Create the index re-export**

Create `frontend/src/components/dashboard/admin/CashDesk/index.ts`:

```typescript
export { CashDeskForm } from './CashDeskForm';
```

- [ ] **Step 3: Create the page (server component with RBAC gate)**

Create `frontend/src/app/(dashboard)/admin/cash-desk/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CashDeskForm } from '@/components/dashboard/admin/CashDesk';

export const metadata: Metadata = {
    title: 'Cash desk | Green Gate',
    description: 'Record in-person cash payments. PORT_OFFICER + can_record_cash, FINANCE_ADMIN, or SUPERADMIN.',
};

export const dynamic = 'force-dynamic';

export default async function CashDeskRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, can_record_cash')
        .eq('id', auth.user.id)
        .single();

    const role = profile?.role as string | undefined;
    const canRecordCash = profile?.can_record_cash as boolean | undefined;

    const allowed =
        role === 'FINANCE_ADMIN' ||
        role === 'SUPERADMIN' ||
        (role === 'PORT_OFFICER' && canRecordCash);

    if (!allowed) redirect('/dashboard');

    return (
        <div className="px-6 py-6">
            <CashDeskForm />
        </div>
    );
}
```

- [ ] **Step 4: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/admin/CashDesk/ \
        frontend/src/app/\(dashboard\)/admin/cash-desk/
git -c commit.gpgsign=false commit -m "feat(7c-4): /admin/cash-desk + CashDeskForm

Quick-entry form for in-person cash payments. PORT_OFFICER +
can_record_cash, FINANCE_ADMIN, or SUPERADMIN. Auto-generates
CASH-YYYY-MM-DD-NNN receipt numbers (cashier can override).
Uses Plan 7C-3's recordManualPayment with rail='CASH' (forced
INITIATED — second admin must confirm via /admin/payments).

Optional proof upload to /api/admin/payments/[id]/proofs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: RBAC + sidebar nav

**Files:**
- Modify: `frontend/src/lib/rbac.ts`
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`

- [ ] **Step 1: Inspect current rbac**

```bash
grep -n "NAV_PERMISSIONS\|cash-desk\|can_record_cash\|PORT_OFFICER" frontend/src/lib/rbac.ts | head -20
```

The codebase has a `NAV_PERMISSIONS` matrix and various role-checking functions. Add a `canRecordCash(role, profile)` predicate or extend `NAV_PERMISSIONS` to include `'cash-desk': ['FINANCE_ADMIN', 'SUPERADMIN']` plus a separate gate for PORT_OFFICER+can_record_cash.

- [ ] **Step 2: Extend rbac.ts**

Edit `frontend/src/lib/rbac.ts`. Add (or update) the `NAV_PERMISSIONS` entry:

```typescript
// Inside NAV_PERMISSIONS map, add:
'cash-desk': ['FINANCE_ADMIN', 'SUPERADMIN', 'PORT_OFFICER'],
// (PORT_OFFICER access additionally gated by profiles.can_record_cash on the page itself)
```

If the file has a separate predicate API (e.g. `canEdit(section, role)`), add a parallel `canAccessCashDesk(role: string, canRecordCashFlag: boolean)` helper:

```typescript
export function canAccessCashDesk(role: string | null | undefined, canRecordCashFlag: boolean): boolean {
    if (role === 'SUPERADMIN' || role === 'FINANCE_ADMIN') return true;
    if (role === 'PORT_OFFICER' && canRecordCashFlag) return true;
    return false;
}
```

- [ ] **Step 3: Add sidebar nav entry**

Edit `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`. Add a new nav item near the existing `/admin/payments` entry:

```tsx
// Find the array of nav items and add:
{
    label: t('nav.cashDesk'), // or hardcoded 'Cash Desk' if i18n not yet wired
    href: '/admin/cash-desk',
    icon: Banknote, // or appropriate lucide icon
    section: 'cash-desk', // matches NAV_PERMISSIONS key
},
```

The exact shape depends on the existing nav-items structure — read the file first.

- [ ] **Step 4: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/rbac.ts frontend/src/components/dashboard/layout/DashboardSidebar.tsx
git -c commit.gpgsign=false commit -m "feat(7c-4): RBAC + sidebar — /admin/cash-desk

NAV_PERMISSIONS gains 'cash-desk' for FINANCE_ADMIN/SUPERADMIN/
PORT_OFFICER (with the further can_record_cash check on the page).
canAccessCashDesk(role, canRecordCashFlag) helper exposed for unit tests.
Sidebar shows the 'Cash Desk' link to permitted roles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Owner-side "Receipt" download in `/owner/(portal)/invoices`

**Files:**
- Modify: `frontend/src/app/owner/(portal)/invoices/InvoicesTable.tsx`
- Modify: `frontend/src/app/owner/(portal)/invoices/page.tsx`

For each transaction with at least one CONFIRMED payment that has `receipt_ref`, show a "Receipt" link in the actions column (next to "PDF"). Clicks `/api/receipts/<ref>/download`.

- [ ] **Step 1: Augment server-side data fetch**

Edit `page.tsx`. Add a query for receipts linked to the owner's transactions:

```typescript
// Inside Promise.all, add a fourth query
const [txnRes, intentRes, walletRes, receiptRes] = await Promise.all([
    // ...existing 3 queries...
    session.supabase
        .from('payments')
        .select('transaction_id, receipt_ref')
        .eq('shipowner_id', session.shipowner.id)
        .eq('status', 'CONFIRMED')
        .not('receipt_ref', 'is', null),
]);

// Build a map: transaction_id -> latest receipt_ref
const receiptByTxn = new Map<string, string>();
((receiptRes.data ?? []) as Array<{ transaction_id: string; receipt_ref: string }>).forEach((p) => {
    if (!receiptByTxn.has(p.transaction_id)) receiptByTxn.set(p.transaction_id, p.receipt_ref);
});

// Pass into rows mapping:
const rows: InvoiceRow[] = txns.map((t) => ({
    ...t,
    download_url: ... (existing),
    has_pending_intent: ... (existing),
    receipt_ref: receiptByTxn.get(t.id) ?? null,
}));
```

- [ ] **Step 2: Extend `InvoiceRow` interface + render**

Edit `InvoicesTable.tsx`. Add `receipt_ref: string | null` to `InvoiceRow`. In the actions column render, add (next to the existing PDF link):

```tsx
{r.receipt_ref && (
    <a
        href={`/api/receipts/${encodeURIComponent(r.receipt_ref)}/download`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline"
        aria-label={`Receipt ${r.receipt_ref}`}
    >
        <Receipt className="w-3.5 h-3.5" />
        {/* i18n key OwnerPortal.invoices.receipt */}
        Receipt
    </a>
)}
```

(Import `Receipt` from `lucide-react`.)

- [ ] **Step 3: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/owner/\(portal\)/invoices/
git -c commit.gpgsign=false commit -m "feat(7c-4): owner-side Receipt download in /owner/invoices

For each transaction with at least one CONFIRMED payment that has
receipt_ref, show a Receipt download link next to the PDF link. Latest
receipt wins (one per CONFIRMED payment per spec §8.5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Admin-side "Download receipt" in `<PaymentReviewDrawer>`

**Files:**
- Modify: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/PaymentReviewDrawer.tsx`

Show a "Download receipt" button next to Confirm/Reject actions when `payment.status === 'CONFIRMED'` and `payment.receipt_ref !== null`. Opens `/api/receipts/<ref>/download` in a new tab.

- [ ] **Step 1: Add the button**

Edit the drawer's render. Find the action-buttons section (with Confirm/Reject). Add at the top of the list:

```tsx
{payment.status === 'CONFIRMED' && payment.receipt_ref && (
    <a
        href={`/api/receipts/${encodeURIComponent(payment.receipt_ref)}/download`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20"
    >
        <FileText className="w-3.5 h-3.5" />
        {t('downloadReceipt')}
    </a>
)}
```

(Import `FileText` from `lucide-react`. The `t` function is already in scope.)

- [ ] **Step 2: Extend the GET /api/admin/payments/[id] response**

Verify `frontend/src/app/api/admin/payments/[id]/route.ts` returns `receipt_ref` and `receipt_storage_path` in the payment row. The route uses `select('*')` so it should already include them — confirm by reading the file.

If the drawer's local `Proof` interface doesn't include `receipt_ref`, the assertion `payment.receipt_ref` should still type-check via `PaymentRow` (which now has the new fields once the schema is regenerated). If TypeScript complains, regenerate types or use `(payment as any).receipt_ref` as a temporary cast pending the next types-regeneration commit (acceptable per CLAUDE.md only as a last resort — prefer extending `PaymentRow` if it's a hand-written type).

**Action**: open `frontend/src/services/paymentService.ts`, find the `PaymentRow` interface, and add three optional fields:

```typescript
receipt_ref: string | null;
receipt_storage_path: string | null;
receipt_generated_at: string | null;
```

This keeps the type accurate without `as any`.

- [ ] **Step 3: i18n key**

Add `AdminPayments.reviewDrawer.downloadReceipt: "Download receipt"` (and FR equivalent). Task 10 below collects all i18n keys — for now, add a TODO comment in the code: `{/* TODO: Plan 7C-4 Task 10 — i18n */}`.

- [ ] **Step 4: tsc + build**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/paymentService.ts \
        frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/PaymentReviewDrawer.tsx
git -c commit.gpgsign=false commit -m "feat(7c-4): admin Download receipt button in PaymentReviewDrawer

For CONFIRMED payments with receipt_ref, expose a Download Receipt link
that opens /api/receipts/[ref]/download in a new tab. Extends PaymentRow
type to include the 3 new receipt columns from mig 061.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: i18n EN/FR — `AdminCashDesk` namespace + Receipt download keys

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

- [ ] **Step 1: Add EN keys**

Add to `frontend/messages/en.json`:

```json
"AdminCashDesk": {
    "title": "Cash desk",
    "subtitle": "Record an in-person cash payment. A second admin must confirm it from /admin/payments (4-eyes).",
    "field": {
        "shipowner": "Shipowner",
        "shipownerPlaceholder": "Search by name…",
        "transaction": "Invoice (optional)",
        "transactionNone": "— No specific invoice —",
        "amount": "Amount",
        "currency": "Currency",
        "receiptNumber": "Receipt number",
        "regen": "Regenerate",
        "proof": "Photo / receipt scan",
        "proofCta": "Click to attach (PDF or image, ≤ 5MB)",
        "proofRemove": "Remove"
    },
    "reset": "Clear",
    "submit": "Record cash payment",
    "submitting": "Recording…",
    "fourEyesNote": "Recorded as INITIATED — a second admin must confirm via /admin/payments (4-eyes rule).",
    "success": {
        "title": "Cash payment recorded",
        "body": "Reference {ref}. Awaiting second-admin confirmation.",
        "dismiss": "Dismiss"
    },
    "errors": {
        "shipownerRequired": "Pick a shipowner.",
        "amountInvalid": "Amount must be a positive decimal with up to 2 fraction digits.",
        "receiptRequired": "Receipt number is required.",
        "fileTooBig": "File exceeds the 5MB limit.",
        "fileMime": "File type not supported (use PDF or image).",
        "submitFailed": "Could not record the cash payment."
    }
}
```

Also add to existing namespaces:

```json
// Inside OwnerPortal.invoices:
"receipt": "Receipt"

// Inside AdminPayments.reviewDrawer:
"downloadReceipt": "Download receipt"
```

- [ ] **Step 2: Add FR keys**

Mirror in `frontend/messages/fr.json` with French translations:

```json
"AdminCashDesk": {
    "title": "Caisse",
    "subtitle": "Enregistrez un paiement en espèces en personne. Un second admin doit confirmer depuis /admin/payments (4-eyes).",
    "field": {
        "shipowner": "Armateur",
        "shipownerPlaceholder": "Rechercher par nom…",
        "transaction": "Facture (optionnel)",
        "transactionNone": "— Aucune facture spécifique —",
        "amount": "Montant",
        "currency": "Devise",
        "receiptNumber": "Numéro de reçu",
        "regen": "Régénérer",
        "proof": "Photo / scan du reçu",
        "proofCta": "Cliquez pour joindre (PDF ou image, ≤ 5 Mo)",
        "proofRemove": "Retirer"
    },
    "reset": "Réinitialiser",
    "submit": "Enregistrer le paiement",
    "submitting": "Enregistrement…",
    "fourEyesNote": "Enregistré comme INITIATED — un second admin doit confirmer via /admin/payments (règle 4-eyes).",
    "success": {
        "title": "Paiement espèces enregistré",
        "body": "Référence {ref}. En attente de confirmation par un second admin.",
        "dismiss": "Fermer"
    },
    "errors": {
        "shipownerRequired": "Sélectionnez un armateur.",
        "amountInvalid": "Le montant doit être un décimal positif avec au plus 2 chiffres après la virgule.",
        "receiptRequired": "Le numéro de reçu est requis.",
        "fileTooBig": "Le fichier dépasse la limite de 5 Mo.",
        "fileMime": "Type de fichier non supporté (PDF ou image uniquement).",
        "submitFailed": "Impossible d'enregistrer le paiement espèces."
    }
}

// And:
// OwnerPortal.invoices.receipt: "Reçu"
// AdminPayments.reviewDrawer.downloadReceipt: "Télécharger le reçu"
```

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/en.json'))" && echo "EN ok"
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/fr.json'))" && echo "FR ok"
```

Both must exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git -c commit.gpgsign=false commit -m "feat(7c-4): i18n EN/FR — AdminCashDesk + receipt download keys

New top-level AdminCashDesk namespace covers the cash-desk form
(field labels, errors, 4-eyes note, success state). Existing
namespaces gain OwnerPortal.invoices.receipt and AdminPayments
.reviewDrawer.downloadReceipt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Tests + final gates

**Files:**
- Create: `frontend/src/components/dashboard/admin/CashDesk/CashDeskForm.test.tsx`

Plus a final pass through tsc / vitest / next build / mig 061 pg test.

- [ ] **Step 1: CashDeskForm test**

Create `frontend/src/components/dashboard/admin/CashDesk/CashDeskForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { CashDeskForm } from './CashDeskForm';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/actions/recordManualPayment', () => ({
    recordManualPayment: vi.fn().mockResolvedValue({ id: 'pay-cash-1', status: 'INITIATED' }),
}));

global.fetch = vi.fn();

function setup() {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <CashDeskForm />
        </NextIntlClientProvider>,
    );
}

describe('CashDeskForm', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: URL | string) => {
            const u = typeof url === 'string' ? new URL(url, 'http://x') : url;
            if (u.pathname.endsWith('/api/admin/shipowners/search')) {
                return { ok: true, json: async () => ({ shipowners: [{ id: 'own-1', name: 'Acme Cash Co' }] }) };
            }
            if (u.pathname.match(/\/open-transactions$/)) {
                return { ok: true, json: async () => ({ transactions: [] }) };
            }
            return { ok: true, json: async () => ({}) };
        });
    });

    it('auto-generates a CASH-YYYY-MM-DD-NNN receipt number on mount', () => {
        setup();
        const input = screen.getByDisplayValue(/CASH-\d{4}-\d{2}-\d{2}-\d{3}/) as HTMLInputElement;
        expect(input).toBeInTheDocument();
    });

    it('blocks submit when no shipowner is selected', async () => {
        setup();
        const amount = screen.getByPlaceholderText('0.00');
        fireEvent.change(amount, { target: { value: '50.00' } });
        fireEvent.click(screen.getByText('Record cash payment'));
        expect(await screen.findByText(/Pick a shipowner/i)).toBeInTheDocument();
    });

    it('happy path: pick shipowner → fill amount → submit calls recordManualPayment with rail=CASH', async () => {
        setup();
        const search = screen.getByPlaceholderText('Search by name…');
        fireEvent.change(search, { target: { value: 'Acme' } });
        await waitFor(() => screen.getByText('Acme Cash Co'));
        fireEvent.click(screen.getByText('Acme Cash Co'));

        const amount = screen.getByPlaceholderText('0.00');
        fireEvent.change(amount, { target: { value: '125.50' } });

        fireEvent.click(screen.getByText('Record cash payment'));

        const { recordManualPayment } = await import('@/actions/recordManualPayment');
        await waitFor(() => expect(recordManualPayment).toHaveBeenCalledWith(expect.objectContaining({
            shipownerId: 'own-1',
            rail: 'CASH',
            amount: '125.50',
            currency: 'USD',
            confirmImmediately: false,
        })));
        expect(await screen.findByText(/Cash payment recorded/i)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run vitest just for this file**

```bash
cd frontend && npx vitest run src/components/dashboard/admin/CashDesk/CashDeskForm.test.tsx
```

Expected: 3/3 PASS.

- [ ] **Step 3: Run final gates**

```bash
./supabase/tests/run.sh migrations/061_payments_receipt_and_cash_perm.test.sql
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

All four MUST pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/admin/CashDesk/CashDeskForm.test.tsx
git -c commit.gpgsign=false commit -m "feat(7c-4): vitest+RTL on CashDeskForm + final gates

3 tests:
- auto-generates CASH-YYYY-MM-DD-NNN receipt number on mount
- blocks submit when no shipowner is selected
- happy-path submit calls recordManualPayment with rail=CASH

All gates green: mig 061 pg test, tsc, full vitest, next build.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria

- [ ] Mig 061 applied locally; `payments` has `receipt_ref / receipt_storage_path / receipt_generated_at`
- [ ] `payments.receipt_ref` UNIQUE when not null (partial idx)
- [ ] `profiles.can_record_cash` exists with default `false`
- [ ] `receiptService.generatePaymentReceipt` builds `RCT-YYYY-XXXX`, stores PDF, UPDATEs row, returns ref + buffer
- [ ] `generatePaymentReceipt` is idempotent — second call returns existing ref without re-uploading
- [ ] `confirmPayment` action calls `generatePaymentReceipt` after CONFIRMED transition
- [ ] `confirmPayment` calls `sendPaymentConfirmationEmail` with `receiptRef + receiptPdfBuffer` attached
- [ ] Both receipt-gen and email failures are fail-soft (logged, don't roll back the confirmation)
- [ ] `GET /api/receipts/[ref]/download` returns 302 redirect to 5-min signed Storage URL
- [ ] Download endpoint blocks unauthorized callers (not the shipowner, not admin) with 403
- [ ] `/verify/[ref]` resolves RCT refs by querying `payments` and shows payment-specific fields
- [x] `/verify/[ref]` for RCT uses rate-limit + anti-enumeration response (HMAC signing of receipt QRs deferred to next-phase hardening per Plan 7C-4 review note)
- [ ] `/admin/cash-desk` page renders for FINANCE_ADMIN/SUPERADMIN
- [ ] `/admin/cash-desk` page renders for PORT_OFFICER **only when** `can_record_cash=true`
- [ ] `<CashDeskForm>` auto-generates `CASH-YYYY-MM-DD-NNN` ref + lets cashier override
- [ ] `<CashDeskForm>` submits via `recordManualPayment({ rail: 'CASH', confirmImmediately: false })`
- [ ] `<CashDeskForm>` proof file optional, uploaded via existing `/api/admin/payments/[id]/proofs` route
- [ ] RBAC `NAV_PERMISSIONS['cash-desk']` allows FINANCE_ADMIN/SUPERADMIN/PORT_OFFICER
- [ ] Sidebar shows /admin/cash-desk nav link for permitted roles
- [ ] Owner `/owner/invoices` shows Receipt download for transactions with at least one CONFIRMED+receipt_ref payment
- [ ] Admin `<PaymentReviewDrawer>` shows Download Receipt button for CONFIRMED payments with receipt_ref
- [ ] `AdminCashDesk.*` i18n complete in EN + FR
- [ ] All gates green: mig 061 pg test, tsc, vitest, next build

---

## Pre-merge checklist for the human

1. **Functional smoke test**:
   - As FINANCE_ADMIN, click /admin/cash-desk → fill in fields → submit → verify a row appears in /admin/payments with status=INITIATED rail=CASH
   - As SECOND FINANCE_ADMIN, click that row → drawer opens → click Confirm
   - Verify: `payments.status='CONFIRMED'`, `payments.receipt_ref` populated, `payments.receipt_storage_path` populated, `payments.receipt_generated_at` populated
   - As shipowner, log into /owner/invoices → see "Receipt" link → click → PDF downloads
   - Open the PDF → confirm signatory says "Director, Solid Technology" (per project memory + spec)
   - Scan the QR on the PDF → lands on /verify/RCT-... → shows authentic-receipt view

2. **Email verification**: confirm email arrived with PDF attached. Resend env var must be set.

3. **Hosted DB push**:
   ```
   supabase db push --include-all
   ```
   Expect potential partial-state pattern from prior pushes.

4. **No new Storage bucket** — receipts use the existing `documents` bucket and existing storage policies.

5. **PORT_OFFICER grant**: to test the full RBAC matrix, manually set `UPDATE profiles SET can_record_cash=true WHERE id='<test port officer>'` and verify they can access /admin/cash-desk.

---

## Self-Review Notes

- **Spec coverage**: §8.2 (cash-desk page) ✓, §8.5 (receipt PDF generation + email + verify + download) ✓.
- **Reuse maximization**: `generateReceiptPdf`, `buildReceiptRef`, `generateAndStoreReceipt`, `sendPaymentConfirmationEmail`, `signInvoiceRef`, `parseInvoiceRef`, the `/verify/[ref]` page chrome, the `/api/admin/shipowners/search` and `open-transactions` routes (Plan 7C-3) — all reused without modification.
- **Idempotency**: `receipt_generated_at` is the marker. Plan 7C-1's `confirmPayment` may be called twice (admin double-clicks + race) — receipt service returns existing ref without re-upload.
- **Fail-soft rationale**: a CONFIRMED payment without a receipt is recoverable (re-run via separate admin route in v1.1 if needed); a refused CONFIRMATION because of PDF crash would be a worse user outcome (data already changed, status stuck PROCESSING).
- **Auto-numbering counter** uses `hours*60+minutes` for uniqueness within a day. Maximum 1440 collisions/day; well under typical cash-desk volume of < 10/day. Cashier can edit manually if needed.
- **No new pgmq queue** — sync-in-action is sufficient for v1. Plan 7D Stripe webhook flow can adopt async if needed.
- **PaymentRow type extension** in Task 9 makes the receipt fields available throughout the UI without `as any` casts.
