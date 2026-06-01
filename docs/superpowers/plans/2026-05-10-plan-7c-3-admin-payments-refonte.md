# Plan 7C-3 — Admin Payments Refonte + RecordManualPaymentDialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a v7-native UI for recording manual payments on the 6 admin-only rails (CASH/CHEQUE/LC/NETTING/THIRD_PARTY/BANK_GUARANTEE) and reviewing/confirming any owner-initiated payment in `INITIATED` state — using Plan 7C-1's `recordManualPayment`/`confirmPayment`/`rejectPayment` actions and the `payment_proofs` upload pipeline. Adds (does not replace) the legacy `PendingIntentsPanel` — that's dropped in Plan 7C-5.

**Architecture:** One new server action (`recordManualPayment`) parallels Plan 7C-1's owner-side `initiatePayment`. One new TS service (`paymentProofService`) wraps Supabase Storage uploads against the existing `payment-proofs` bucket (mig 049 + storage rules from mig 059). Two API routes expose admin payment lists (`GET /api/admin/payments`, `GET /api/admin/payments/[id]`). Three new client components: `<PaymentsAdminPanel>` (list + filters), `<RecordManualPaymentDialog>` (create wizard for the 6 rails), `<PaymentReviewDrawer>` (confirm/reject/cancel with proof preview). The existing `/admin/payments` page gains the new panel above the legacy one — no removals.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / Zod / Vitest + RTL / Radix UI Dialog + shadcn-style drawer / Supabase Storage / next-intl (PascalCase namespaces). Reuses Plan 7C-1's `confirmPayment`, `rejectPayment`, `cancelPayment`, `paymentService` v7 typed reads, `can_confirm_payment` SQL fn (mig 057), and Plan 7C-2's rail-rejection i18n pattern.

**Spec source:** [`docs/superpowers/specs/2026-05-01-shipowner-portal-v1-design.md`](../specs/2026-05-01-shipowner-portal-v1-design.md) §7.2.

**Predecessor:** Plan 7C-1 (PR #20, merged) and Plan 7C-2 (PR #21, in review). Mig 060 from 7C-2 is a HARD prerequisite because admin payment review reads the active providers via `getActiveProviders()` for some informational display. If 7C-2 isn't merged when 7C-3 starts, the worktree must rebase on 7C-2's branch.

**Successor:** Plan 7C-4 (cash desk + receipt PDF) consumes `recordManualPayment` for the in-person cash flow. Plan 7C-5 drops `paymentIntentService.ts`, the legacy `PendingIntentsPanel.tsx`, and the legacy intent server actions (`declarePaymentIntent`, `resolvePaymentIntent`).

**Out of scope:**
- WIRE_TRANSFER and MOBILE_MONEY admin-initiation (rare; can be added as v1.1 by extending the dialog's rail enum)
- STRIPE webhook tooling (Plan 7D)
- Receipt PDF generation (Plan 7C-4 — this plan only marks `CONFIRMED`; PDF is a downstream sub-plan)
- Dropping the legacy `PendingIntentsPanel` (Plan 7C-5)
- 4-eyes second-confirmer notification email (covered by Plan 7F)

---

## File Structure

### Files to create

```
frontend/src/services/
├── paymentProofService.ts                       # uploadProof / listProofs / signedUrl
└── paymentProofService.test.ts

frontend/src/actions/
├── recordManualPayment.ts                       # admin INSERT into payments
└── recordManualPayment.test.ts

frontend/src/app/api/admin/payments/
├── route.ts                                     # GET list with filters
└── [id]/route.ts                                # GET single + proofs

frontend/src/components/dashboard/admin/PaymentsAdmin/
├── PaymentsAdminPanel.tsx                       # list + filters (top of page)
├── PaymentRow.tsx                               # one row in the list table
├── RecordManualPaymentDialog/
│   ├── RecordManualPaymentDialog.tsx            # 3-step wizard root
│   ├── StepRailAndShipowner.tsx                 # Step 1: rail + shipowner + transaction picker
│   ├── StepRailParams.tsx                       # Step 2: rail-specific fields + proof upload
│   ├── StepConfirm.tsx                          # Step 3: summary + immediate-confirm toggle + submit
│   ├── useRecordPaymentContext.tsx              # shared wizard context
│   └── index.ts
├── PaymentReviewDrawer/
│   ├── PaymentReviewDrawer.tsx                  # side drawer: payment + proofs + actions
│   ├── ProofPreview.tsx                         # image inline / PDF embed / download fallback
│   └── index.ts
├── PaymentsAdminPanel.test.tsx                  # vitest + RTL
├── RecordManualPaymentDialog.test.tsx           # vitest + RTL (CASH 4-eyes block scenario)
└── PaymentReviewDrawer.test.tsx                 # vitest + RTL (confirm + reject flows)
```

### Files to modify

```
frontend/src/app/(dashboard)/admin/payments/page.tsx     # mount new PaymentsAdminPanel above legacy
frontend/messages/en.json                                # AdminPayments.* namespace
frontend/messages/fr.json                                # AdminPayments.* namespace
frontend/src/services/paymentService.ts                  # add listAdminPayments(filters)
frontend/src/services/__tests__/paymentService.test.ts   # +1 test for filter parsing
```

### Test runners

```bash
# Frontend Vitest (single file)
cd frontend && npx vitest run src/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel.test.tsx

# Full gates
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

No new SQL migration. The schema is fully delivered by mig 048 (`payments`), 049 (`payment_proofs`), 057 (`can_confirm_payment`), 058 (RLS), 059 (storage bucket).

---

## Task 1: paymentProofService — upload + list + signed URL

**Files:**
- Create: `frontend/src/services/paymentProofService.ts`
- Create: `frontend/src/services/paymentProofService.test.ts`

The service wraps Supabase Storage for the `payment-proofs` bucket. Upload paths follow the convention `{shipowner_id}/{payment_id}/{timestamp}-{filename}`. Storage RLS (already in mig 059) gates owner reads. Admins read all via service role.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/services/paymentProofService.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadProof, listProofs, signedProofUrl, MAX_PROOF_SIZE_BYTES } from './paymentProofService';

function makeStorageClient(opts: {
    uploadError?: { message: string } | null;
    listData?: Array<{ id: string; storage_path: string; mime_type: string; size_bytes: number; uploaded_at: string; description: string | null }>;
    signedUrl?: string;
} = {}) {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'p/path' }, error: opts.uploadError ?? null });
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: opts.signedUrl ?? 'https://signed/url' }, error: null });
    const insert = vi.fn().mockResolvedValue({ data: [{ id: 'proof-1' }], error: null });
    const select = vi.fn(() => ({
        eq: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: opts.listData ?? [], error: null }),
        })),
    }));

    return {
        storage: { from: vi.fn(() => ({ upload, createSignedUrl })) },
        from: vi.fn(() => ({ insert, select })),
    } as unknown as SupabaseClient;
}

describe('uploadProof', () => {
    it('rejects files over MAX_PROOF_SIZE_BYTES', async () => {
        const client = makeStorageClient();
        const big = new File([new Uint8Array(MAX_PROOF_SIZE_BYTES + 1)], 'x.pdf', { type: 'application/pdf' });
        await expect(uploadProof(client, {
            paymentId: 'pay-1',
            shipownerId: 'own-1',
            uploadedBy: 'user-1',
            file: big,
        })).rejects.toThrow(/exceeds/i);
    });

    it('rejects unsupported mime types', async () => {
        const client = makeStorageClient();
        const file = new File(['x'], 'x.exe', { type: 'application/x-msdownload' });
        await expect(uploadProof(client, {
            paymentId: 'pay-1',
            shipownerId: 'own-1',
            uploadedBy: 'user-1',
            file,
        })).rejects.toThrow(/mime/i);
    });

    it('uploads under shipowner/payment path then inserts row', async () => {
        const client = makeStorageClient();
        const file = new File(['x'], 'wire.pdf', { type: 'application/pdf' });
        const result = await uploadProof(client, {
            paymentId: 'pay-1',
            shipownerId: 'own-1',
            uploadedBy: 'user-1',
            file,
            description: 'SWIFT receipt',
        });
        expect(result.id).toBe('proof-1');
        const storageFrom = (client.storage.from as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(storageFrom).toBe('payment-proofs');
    });
});

describe('listProofs', () => {
    it('returns proofs ordered by uploaded_at ascending', async () => {
        const client = makeStorageClient({
            listData: [
                { id: 'a', storage_path: 'own-1/pay-1/1.pdf', mime_type: 'application/pdf', size_bytes: 100, uploaded_at: '2026-05-10T10:00:00Z', description: null },
            ],
        });
        const proofs = await listProofs(client, 'pay-1');
        expect(proofs).toHaveLength(1);
        expect(proofs[0].id).toBe('a');
    });
});

describe('signedProofUrl', () => {
    it('returns a 60-second signed URL by default', async () => {
        const client = makeStorageClient({ signedUrl: 'https://example/signed' });
        const url = await signedProofUrl(client, 'own-1/pay-1/1.pdf');
        expect(url).toBe('https://example/signed');
    });
});
```

- [ ] **Step 2: Run tests → fail**

```bash
cd frontend && npx vitest run src/services/paymentProofService.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the service**

Create `frontend/src/services/paymentProofService.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_PROOF_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, matches mig 049 CHECK
export const ALLOWED_PROOF_MIME_TYPES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
]);

const STORAGE_BUCKET = 'payment-proofs';

export interface PaymentProofRow {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    description: string | null;
}

export interface UploadProofInput {
    paymentId: string;
    shipownerId: string;
    uploadedBy: string;
    file: File;
    description?: string;
}

/**
 * Upload a proof file to Supabase Storage and insert the metadata row.
 * Path convention: <shipownerId>/<paymentId>/<timestamp>-<sanitized-name>
 * Throws on size violation, mime rejection, or storage error.
 */
export async function uploadProof(
    client: SupabaseClient,
    input: UploadProofInput,
): Promise<{ id: string; storage_path: string }> {
    if (input.file.size > MAX_PROOF_SIZE_BYTES) {
        throw new Error(`File ${input.file.name} (${input.file.size} bytes) exceeds limit ${MAX_PROOF_SIZE_BYTES}`);
    }
    if (!ALLOWED_PROOF_MIME_TYPES.has(input.file.type)) {
        throw new Error(`Unsupported mime type: ${input.file.type}`);
    }

    const sanitized = input.file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const storagePath = `${input.shipownerId}/${input.paymentId}/${Date.now()}-${sanitized}`;

    const { error: storageError } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, input.file, {
            contentType: input.file.type,
            upsert: false,
        });
    if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

    const { data, error } = await client
        .from('payment_proofs')
        .insert({
            payment_id: input.paymentId,
            storage_path: storagePath,
            mime_type: input.file.type,
            size_bytes: input.file.size,
            uploaded_by: input.uploadedBy,
            description: input.description ?? null,
        })
        .select('id, storage_path')
        .single();

    if (error || !data) throw new Error(`payment_proofs insert failed: ${error?.message ?? 'no row'}`);
    return data as { id: string; storage_path: string };
}

/**
 * List proofs for a payment, oldest first (chronological audit trail).
 */
export async function listProofs(
    client: SupabaseClient,
    paymentId: string,
): Promise<PaymentProofRow[]> {
    const { data, error } = await client
        .from('payment_proofs')
        .select('id, storage_path, mime_type, size_bytes, uploaded_at, description')
        .eq('payment_id', paymentId)
        .order('uploaded_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PaymentProofRow[];
}

/**
 * Return a short-lived signed URL for in-browser preview/download.
 */
export async function signedProofUrl(
    client: SupabaseClient,
    storagePath: string,
    ttlSeconds = 60,
): Promise<string> {
    const { data, error } = await client.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data) throw new Error(`signed URL failed: ${error?.message ?? 'no url'}`);
    return data.signedUrl;
}
```

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run src/services/paymentProofService.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/paymentProofService.ts \
        frontend/src/services/paymentProofService.test.ts
git commit -m "feat(7c-3): paymentProofService — upload + list + signed URL

5MB cap (matches mig 049 CHECK), allow-list mime types (PDF + common
images). Storage path convention <shipowner>/<payment>/<ts>-<name>.
Insert payment_proofs row after successful Storage upload. listProofs
ordered oldest-first for chronological audit trail. signedProofUrl
returns 60s URL by default for in-browser preview.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `recordManualPayment` server action

**Files:**
- Create: `frontend/src/actions/recordManualPayment.ts`
- Create: `frontend/src/actions/recordManualPayment.test.ts`

The admin counterpart to Plan 7C-1's `initiatePayment`. Same FX-locking flow. Inserts into `payments` with `declared_by = current_admin_user_id`. Optionally takes a flag `confirmImmediately: boolean` — when true and rail allows it (NOT for CASH), the row is inserted as `CONFIRMED` with `confirmed_by = same admin`. CASH is forced to INITIATED to satisfy the 4-eyes rule encoded in `can_confirm_payment` (mig 057).

- [ ] **Step 1: Write failing tests**

Create `frontend/src/actions/recordManualPayment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(),
}));
vi.mock('@/services/fxRateService', () => ({
    lockRate: vi.fn(async () => ({ rate: 1, source: 'TEST', lockedAt: '2026-05-10T00:00:00Z' })),
}));

import { recordManualPayment } from './recordManualPayment';
import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

function makeAdminCtx(role: 'FINANCE_ADMIN' | 'SUPERADMIN' = 'FINANCE_ADMIN', userId = 'admin-1') {
    const insertCall = vi.fn().mockResolvedValue({ data: [{ id: 'pay-new', status: 'INITIATED' }], error: null });
    const select = vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: 'pay-new', status: 'INITIATED' }, error: null }) }));
    const insert = vi.fn(() => ({ select }));
    const supabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
        from: vi.fn(() => ({ insert })),
    };
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({ supabase, profile: { role, id: userId }, error: null });
    return { supabase, insert, insertCall };
}

describe('recordManualPayment', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('inserts INITIATED for CHEQUE when confirmImmediately=false', async () => {
        const { insert } = makeAdminCtx();
        const result = await recordManualPayment({
            shipownerId: 'own-1',
            transactionId: 'tx-1',
            rail: 'CHEQUE',
            amount: '500.00',
            currency: 'USD',
            railDetails: { cheque_number: '12345', bank_name: 'BoA' },
            confirmImmediately: false,
        });
        expect(result.id).toBe('pay-new');
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('INITIATED');
        expect(row.confirmed_by).toBeNull();
    });

    it('inserts CONFIRMED for CHEQUE when confirmImmediately=true', async () => {
        const { insert } = makeAdminCtx();
        await recordManualPayment({
            shipownerId: 'own-1',
            transactionId: 'tx-1',
            rail: 'CHEQUE',
            amount: '500.00',
            currency: 'USD',
            railDetails: { cheque_number: '12345' },
            confirmImmediately: true,
        });
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('CONFIRMED');
        expect(row.confirmed_by).toBe('admin-1');
        expect(row.confirmed_at).toBeTruthy();
    });

    it('FORCES INITIATED for CASH even when confirmImmediately=true (4-eyes)', async () => {
        const { insert } = makeAdminCtx();
        await recordManualPayment({
            shipownerId: 'own-1',
            transactionId: 'tx-1',
            rail: 'CASH',
            amount: '100.00',
            currency: 'USD',
            railDetails: { receipt_number: 'R-001' },
            confirmImmediately: true, // ignored for CASH
        });
        const row = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(row.status).toBe('INITIATED');
        expect(row.confirmed_by).toBeNull();
    });

    it('rejects unknown rail', async () => {
        makeAdminCtx();
        await expect(recordManualPayment({
            shipownerId: 'own-1',
            transactionId: 'tx-1',
            rail: 'INVALID' as never,
            amount: '100',
            currency: 'USD',
            railDetails: {},
            confirmImmediately: false,
        })).rejects.toThrow();
    });

    it('rejects when caller is not FINANCE_ADMIN/SUPERADMIN', async () => {
        (requireRole as ReturnType<typeof vi.fn>).mockResolvedValue({
            error: new Response('forbidden', { status: 403 }),
        });
        await expect(recordManualPayment({
            shipownerId: 'own-1',
            transactionId: 'tx-1',
            rail: 'CHEQUE',
            amount: '100',
            currency: 'USD',
            railDetails: {},
            confirmImmediately: false,
        })).rejects.toThrow(/forbidden|unauthorized/i);
    });
});
```

- [ ] **Step 2: Run tests → fail**

```bash
cd frontend && npx vitest run src/actions/recordManualPayment.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the action**

Create `frontend/src/actions/recordManualPayment.ts`:

```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { lockRate } from '@/services/fxRateService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { z } from 'zod';

const ADMIN_ONLY_RAILS = [
    'CASH',
    'CHEQUE',
    'LETTER_OF_CREDIT',
    'NETTING',
    'THIRD_PARTY',
    'BANK_GUARANTEE',
] as const;
type AdminRail = typeof ADMIN_ONLY_RAILS[number];

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

const schema = z.object({
    shipownerId: z.string().uuid(),
    transactionId: z.string().uuid().nullable(),
    rail: z.enum(ADMIN_ONLY_RAILS),
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Decimal with up to 2 fraction digits'),
    currency: z.string().length(3),
    railDetails: z.record(z.string(), z.unknown()),
    confirmImmediately: z.boolean(),
});

export interface RecordManualPaymentInput {
    shipownerId: string;
    transactionId: string | null;
    rail: AdminRail;
    amount: string;
    currency: string;
    railDetails: Record<string, unknown>;
    confirmImmediately: boolean;
}

/**
 * Admin-side INSERT into `payments` for the 6 admin-only rails.
 * - declared_by = current admin user id
 * - status = INITIATED unless `confirmImmediately` AND rail !== CASH
 * - CASH is FORCED to INITIATED regardless of the flag (4-eyes per mig 057)
 *   The second admin must call confirmPayment() to flip to CONFIRMED.
 */
export async function recordManualPayment(input: RecordManualPaymentInput) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) throw new Error('forbidden');

    const parsed = schema.parse(input);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const fx = await lockRate(supabase, parsed.currency);
    const amountMinor = Math.round(parseFloat(parsed.amount) * 100);
    const amountUsdMinor = parsed.currency === 'USD' ? amountMinor : Math.round(amountMinor / fx.rate);

    // Force INITIATED for CASH (4-eyes rule)
    const status = (parsed.rail === 'CASH' || !parsed.confirmImmediately) ? 'INITIATED' : 'CONFIRMED';

    const row = {
        transaction_id: parsed.transactionId,
        shipowner_id: parsed.shipownerId,
        declared_by: user.id,
        amount_minor: amountMinor,
        currency: parsed.currency,
        amount_usd_minor: amountUsdMinor,
        fx_rate: parsed.currency === 'USD' ? null : fx.rate,
        fx_rate_source: parsed.currency === 'USD' ? null : fx.source,
        fx_rate_locked_at: parsed.currency === 'USD' ? null : fx.lockedAt,
        rail: parsed.rail,
        rail_details: parsed.railDetails,
        status,
        confirmed_by: status === 'CONFIRMED' ? user.id : null,
        confirmed_at: status === 'CONFIRMED' ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
        .from('payments')
        .insert(row)
        .select('id, status, transaction_id, amount_usd_minor')
        .single();

    if (error) throw error;
    return data;
}
```

- [ ] **Step 4: Tests pass**

```bash
cd frontend && npx vitest run src/actions/recordManualPayment.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/recordManualPayment.ts \
        frontend/src/actions/recordManualPayment.test.ts
git commit -m "feat(7c-3): recordManualPayment server action

Admin counterpart to initiatePayment (7C-1). Inserts into payments with
declared_by=admin user id. Optional confirmImmediately flag flips status
to CONFIRMED + confirmed_by/at = same admin — except CASH which is FORCED
to INITIATED regardless (4-eyes per can_confirm_payment in mig 057).
FX-locked via lockRate (same flow as initiatePayment).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `paymentService.listAdminPayments` + filters

**Files:**
- Modify: `frontend/src/services/paymentService.ts` (append at EOF)
- Modify: `frontend/src/services/__tests__/paymentService.test.ts` (append)

Add a typed query helper for the admin list. Filters: `status` (multi), `rail` (multi), date range, free-text search (matches `external_reference` ILIKE). Returns at most 200 rows ordered by `created_at` DESC.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/services/__tests__/paymentService.test.ts` (after the existing `setProviderActive` describe):

```typescript
import { listAdminPayments, type AdminPaymentFilters } from '../paymentService';

describe('listAdminPayments', () => {
    function makeFilterClient(rows: Array<Record<string, unknown>>) {
        const range = vi.fn().mockResolvedValue({ data: rows, error: null });
        const order = vi.fn(() => ({ range }));
        const limit = vi.fn(() => ({ order }));
        const ilike = vi.fn(() => ({ limit, order }));
        const lte = vi.fn(() => ({ ilike, limit, order }));
        const gte = vi.fn(() => ({ lte, ilike, limit, order }));
        const inFn = vi.fn(() => ({ gte, lte, ilike, limit, order }));
        const eq = vi.fn(() => ({ in: inFn, gte, lte, ilike, limit, order }));
        const select = vi.fn(() => ({ in: inFn, eq, gte, lte, ilike, limit, order }));
        return { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient;
    }

    it('returns rows mapped to PaymentRow[]', async () => {
        const client = makeFilterClient([
            { id: 'p1', status: 'INITIATED', rail: 'CHEQUE', amount_usd_minor: 50000, currency: 'USD',
              shipowner_id: 's1', transaction_id: 't1', declared_by: 'a1',
              amount_minor: 50000, fx_rate: null, fx_rate_source: null, fx_rate_locked_at: null,
              rail_details: {}, external_reference: null, rejected_reason: null,
              confirmed_by: null, confirmed_at: null,
              created_at: '2026-05-10T00:00:00Z', updated_at: '2026-05-10T00:00:00Z' },
        ]);
        const filters: AdminPaymentFilters = { status: ['INITIATED'], rail: [], from: null, to: null, q: null };
        const rows = await listAdminPayments(client, filters);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('p1');
        expect(rows[0].rail).toBe('CHEQUE');
    });

    it('handles empty filter gracefully', async () => {
        const client = makeFilterClient([]);
        const rows = await listAdminPayments(client, { status: [], rail: [], from: null, to: null, q: null });
        expect(rows).toEqual([]);
    });
});
```

- [ ] **Step 2: Tests fail**

```bash
cd frontend && npx vitest run src/services/__tests__/paymentService.test.ts
```

Expected: FAIL — `listAdminPayments` not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/services/paymentService.ts` (after the Plan 7C-2 section added in 7C-2 Task 2):

```typescript
// ── Plan 7C-3: Admin payment list with filters ─────────────────────────────

export interface AdminPaymentFilters {
    status: PaymentStatusV7[];
    rail: PaymentRail[];
    from: string | null;     // ISO date inclusive
    to: string | null;       // ISO date inclusive
    q: string | null;        // ILIKE on external_reference
}

/**
 * List up to 200 payments matching the filters, newest first.
 * Used by /admin/payments PaymentsAdminPanel.
 */
export async function listAdminPayments(
    client: SupabaseClient,
    filters: AdminPaymentFilters,
    limit = 200,
): Promise<PaymentRow[]> {
    let query = client
        .from('payments')
        .select('*');

    if (filters.status.length > 0) query = query.in('status', filters.status);
    if (filters.rail.length > 0)   query = query.in('rail', filters.rail);
    if (filters.from)              query = query.gte('created_at', filters.from);
    if (filters.to)                query = query.lte('created_at', filters.to);
    if (filters.q)                 query = query.ilike('external_reference', `%${filters.q}%`);

    const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw new Error(error.message);
    return (data ?? []) as PaymentRow[];
}
```

- [ ] **Step 4: Tests pass + tsc**

```bash
cd frontend && npx vitest run src/services/__tests__/paymentService.test.ts
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/paymentService.ts \
        frontend/src/services/__tests__/paymentService.test.ts
git commit -m "feat(7c-3): paymentService.listAdminPayments + AdminPaymentFilters

Filtered list helper for /admin/payments. Filters: status[], rail[],
date range (from/to inclusive), q (ILIKE external_reference). Limit 200,
ordered newest-first. 2 unit tests cover happy path + empty filters.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: API routes — `/api/admin/payments` list + detail

**Files:**
- Create: `frontend/src/app/api/admin/payments/route.ts`
- Create: `frontend/src/app/api/admin/payments/[id]/route.ts`

- [ ] **Step 1: List route**

Create `frontend/src/app/api/admin/payments/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { listAdminPayments, type AdminPaymentFilters } from '@/services/paymentService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];
const VALID_STATUSES = new Set(['INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);
const VALID_RAILS = new Set(['STRIPE','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT','NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET']);

function parseList(raw: string | null, allowed: Set<string>): string[] {
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => allowed.has(s));
}

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const filters: AdminPaymentFilters = {
        status: parseList(url.searchParams.get('status'), VALID_STATUSES) as AdminPaymentFilters['status'],
        rail:   parseList(url.searchParams.get('rail'),   VALID_RAILS)    as AdminPaymentFilters['rail'],
        from:   url.searchParams.get('from'),
        to:     url.searchParams.get('to'),
        q:      url.searchParams.get('q'),
    };

    try {
        const payments = await listAdminPayments(auth.supabase, filters);
        return NextResponse.json({ payments });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
```

- [ ] **Step 2: Detail route**

Create `frontend/src/app/api/admin/payments/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { listProofs, signedProofUrl, type PaymentProofRow } from '@/services/paymentProofService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    try {
        const { data: payment, error } = await auth.supabase
            .from('payments')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const proofs = await listProofs(auth.supabase, id);
        const proofsWithUrls = await Promise.all(
            proofs.map(async (p: PaymentProofRow) => ({
                ...p,
                signed_url: await signedProofUrl(auth.supabase, p.storage_path, 300),
            })),
        );

        return NextResponse.json({ payment, proofs: proofsWithUrls });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
```

- [ ] **Step 3: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/admin/payments/
git commit -m "feat(7c-3): API /api/admin/payments — list + detail

GET /api/admin/payments: filtered list (status, rail, date range, q).
GET /api/admin/payments/[id]: single payment + payment_proofs with
5-min signed URLs for in-browser preview. Both gated by FINANCE_ADMIN
or SUPERADMIN.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `<PaymentsAdminPanel>` — list + filters

**Files:**
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentRow.tsx`

- [ ] **Step 1: PaymentRow (presentational)**

Create `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentRow.tsx`:

```tsx
'use client';

import * as React from 'react';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import type { PaymentRow as PaymentRowType } from '@/services/paymentService';

const STATUS_VARIANT: Record<PaymentRowType['status'], BadgeVariant> = {
    INITIATED:  'warning',
    PROCESSING: 'info',
    CONFIRMED:  'active',
    REJECTED:   'critical',
    CANCELLED:  'archived',
    REFUNDED:   'archived',
};

interface Props {
    payment: PaymentRowType;
    onOpen: (id: string) => void;
}

export function PaymentRow({ payment, onOpen }: Props) {
    const amountUsd = payment.amount_usd_minor / 100;
    return (
        <tr
            onClick={() => onOpen(payment.id)}
            className="cursor-pointer hover:bg-[var(--os-surface-3)] transition-colors"
        >
            <td className="px-3 py-2 text-xs font-mono text-[var(--os-text-muted)]">
                {payment.id.slice(0, 8)}
            </td>
            <td className="px-3 py-2 text-xs">{payment.rail}</td>
            <td className="px-3 py-2 text-xs font-mono tabular-nums">
                {amountUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                {payment.currency !== 'USD' && (
                    <span className="ml-1 text-[10px] text-[var(--os-text-muted)]">
                        ({(payment.amount_minor / 100).toFixed(2)} {payment.currency})
                    </span>
                )}
            </td>
            <td className="px-3 py-2">
                <OsBadge variant={STATUS_VARIANT[payment.status]} label={payment.status} />
            </td>
            <td className="px-3 py-2 text-xs text-[var(--os-text-muted)] tabular-nums">
                {new Date(payment.created_at).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-xs font-mono text-[var(--os-text-muted)]">
                {payment.external_reference ?? '—'}
            </td>
        </tr>
    );
}
```

- [ ] **Step 2: PaymentsAdminPanel (list + filters + dialog/drawer triggers)**

Create `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel.tsx`:

```tsx
'use client';

import * as React from 'react';
import { Plus, RefreshCw, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { useRole } from '@/lib/RoleContext';
import { canEdit } from '@/lib/rbac';
import { PaymentRow } from './PaymentRow';
import { RecordManualPaymentDialog } from './RecordManualPaymentDialog';
import { PaymentReviewDrawer } from './PaymentReviewDrawer';
import type { PaymentRow as PaymentRowType, PaymentStatusV7, PaymentRail } from '@/services/paymentService';

const ALL_STATUSES: PaymentStatusV7[] = ['INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED'];
const ALL_RAILS: PaymentRail[] = ['STRIPE','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT','NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET'];

export function PaymentsAdminPanel() {
    const t = useTranslations('AdminPayments');
    const { role } = useRole();
    const canRecord = canEdit('tax-settings', role); // same gate as PaymentProvidersPanel

    const [rows, setRows] = React.useState<PaymentRowType[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [statusFilter, setStatusFilter] = React.useState<Set<PaymentStatusV7>>(new Set(['INITIATED', 'PROCESSING']));
    const [railFilter, setRailFilter] = React.useState<Set<PaymentRail>>(new Set());
    const [openDialog, setOpenDialog] = React.useState(false);
    const [reviewId, setReviewId] = React.useState<string | null>(null);
    const [refreshKey, setRefreshKey] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const url = new URL('/api/admin/payments', window.location.origin);
                if (statusFilter.size > 0) url.searchParams.set('status', Array.from(statusFilter).join(','));
                if (railFilter.size > 0)   url.searchParams.set('rail', Array.from(railFilter).join(','));
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (!cancelled) setRows(data.payments ?? []);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [statusFilter, railFilter, refreshKey]);

    function toggleSetMember<T>(set: Set<T>, member: T): Set<T> {
        const next = new Set(set);
        if (next.has(member)) next.delete(member); else next.add(member);
        return next;
    }

    return (
        <section className="os-card p-5 mb-5">
            <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h2 className="text-lg font-bold text-[var(--os-text-primary)]">{t('title')}</h2>
                    <p className="text-xs text-[var(--os-text-muted)]">{t('subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                    <OsButton
                        variant="secondary"
                        size="sm"
                        icon={<RefreshCw className="w-3.5 h-3.5" />}
                        onClick={() => setRefreshKey((k) => k + 1)}
                    >
                        {t('refresh')}
                    </OsButton>
                    {canRecord && (
                        <OsButton
                            variant="primary"
                            size="sm"
                            icon={<Plus className="w-3.5 h-3.5" />}
                            onClick={() => setOpenDialog(true)}
                        >
                            {t('recordManual')}
                        </OsButton>
                    )}
                </div>
            </header>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mr-1">
                        {t('filterStatus')}
                    </span>
                    {ALL_STATUSES.map((s) => {
                        const active = statusFilter.has(s);
                        return (
                            <button
                                key={s}
                                onClick={() => setStatusFilter((set) => toggleSetMember(set, s))}
                                className="text-[10px] px-2 py-0.5 rounded-md border transition-colors"
                                style={{
                                    borderColor: active ? '#10B981' : 'var(--os-border)',
                                    backgroundColor: active ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                    color: active ? '#10B981' : 'var(--os-text-muted)',
                                }}
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mr-1">
                        {t('filterRail')}
                    </span>
                    {ALL_RAILS.map((r) => {
                        const active = railFilter.has(r);
                        return (
                            <button
                                key={r}
                                onClick={() => setRailFilter((set) => toggleSetMember(set, r))}
                                className="text-[9px] font-mono px-2 py-0.5 rounded-md border transition-colors"
                                style={{
                                    borderColor: active ? '#38BDF8' : 'var(--os-border)',
                                    backgroundColor: active ? 'rgba(56,189,248,0.12)' : 'var(--os-surface-2)',
                                    color: active ? '#38BDF8' : 'var(--os-text-muted)',
                                }}
                            >
                                {r}
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20 mb-3">
                    <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                    <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
            )}

            {loading ? (
                <p className="text-xs text-[var(--os-text-muted)] py-4">{t('loading')}</p>
            ) : rows.length === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)] py-4">{t('empty')}</p>
            ) : (
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--os-text-muted)] border-b border-[var(--os-border)]">
                            <th className="px-3 py-2">{t('col.id')}</th>
                            <th className="px-3 py-2">{t('col.rail')}</th>
                            <th className="px-3 py-2">{t('col.amount')}</th>
                            <th className="px-3 py-2">{t('col.status')}</th>
                            <th className="px-3 py-2">{t('col.created')}</th>
                            <th className="px-3 py-2">{t('col.ref')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((p) => (
                            <PaymentRow key={p.id} payment={p} onOpen={(id) => setReviewId(id)} />
                        ))}
                    </tbody>
                </table>
            )}

            {openDialog && (
                <RecordManualPaymentDialog
                    open={openDialog}
                    onOpenChange={(o) => {
                        setOpenDialog(o);
                        if (!o) setRefreshKey((k) => k + 1);
                    }}
                />
            )}
            {reviewId && (
                <PaymentReviewDrawer
                    paymentId={reviewId}
                    onClose={() => {
                        setReviewId(null);
                        setRefreshKey((k) => k + 1);
                    }}
                />
            )}
        </section>
    );
}
```

- [ ] **Step 3: tsc check (will fail until Tasks 6-7 land)**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -10
```

Expected: 2 errors — `Cannot find module './RecordManualPaymentDialog'` and `'./PaymentReviewDrawer'`. That's fine — Tasks 6 and 7 fix them.

- [ ] **Step 4: Commit (allow tsc temporary failure)**

```bash
git add frontend/src/components/dashboard/admin/PaymentsAdmin/
git commit -m "feat(7c-3): PaymentsAdminPanel + PaymentRow

List with status/rail multi-toggle filters. Default filter shows
INITIATED + PROCESSING (admin's todo queue). Click row → review drawer;
click 'Record manual' → dialog. Manual refresh button. Two child
components imported but not yet implemented; tsc will fail until
Tasks 6-7 land them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `<RecordManualPaymentDialog>` — wizard for 6 admin-only rails

**Files:**
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/useRecordPaymentContext.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/StepRailAndShipowner.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/StepRailParams.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/StepConfirm.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/RecordManualPaymentDialog.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/index.ts`

Mirrors Plan 7C-2's `<PayDialog>` structure: a context + 3 steps + a Radix Dialog shell.

- [ ] **Step 1: Context**

Create `useRecordPaymentContext.tsx`:

```tsx
'use client';

import * as React from 'react';

export type AdminRail = 'CASH' | 'CHEQUE' | 'LETTER_OF_CREDIT' | 'NETTING' | 'THIRD_PARTY' | 'BANK_GUARANTEE';
export type Step = 'who' | 'params' | 'confirm';

export interface ShipownerOption { id: string; name: string; }
export interface TransactionOption { id: string; invoice_ref: string | null; tax_amount_usd: number; }

export interface RecordPaymentState {
    step: Step;
    rail: AdminRail | null;
    shipowner: ShipownerOption | null;
    transaction: TransactionOption | null;
    amount: string;       // decimal string e.g. "1234.56"
    currency: string;     // default USD
    railDetails: Record<string, unknown>;
    proofs: File[];
    confirmImmediately: boolean;
    submitting: boolean;
    error: string | null;
}

export interface RecordPaymentContextValue extends RecordPaymentState {
    setStep: (s: Step) => void;
    setRail: (r: AdminRail | null) => void;
    setShipowner: (s: ShipownerOption | null) => void;
    setTransaction: (t: TransactionOption | null) => void;
    setAmount: (a: string) => void;
    setCurrency: (c: string) => void;
    setRailDetails: (d: Record<string, unknown>) => void;
    setProofs: (p: File[]) => void;
    setConfirmImmediately: (b: boolean) => void;
    setSubmitting: (b: boolean) => void;
    setError: (e: string | null) => void;
    reset: () => void;
}

const Ctx = React.createContext<RecordPaymentContextValue | null>(null);

export function RecordPaymentProvider({ children }: { children: React.ReactNode }) {
    const [step, setStep] = React.useState<Step>('who');
    const [rail, setRail] = React.useState<AdminRail | null>(null);
    const [shipowner, setShipowner] = React.useState<ShipownerOption | null>(null);
    const [transaction, setTransaction] = React.useState<TransactionOption | null>(null);
    const [amount, setAmount] = React.useState('');
    const [currency, setCurrency] = React.useState('USD');
    const [railDetails, setRailDetails] = React.useState<Record<string, unknown>>({});
    const [proofs, setProofs] = React.useState<File[]>([]);
    const [confirmImmediately, setConfirmImmediately] = React.useState(false);
    const [submitting, setSubmitting] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const reset = React.useCallback(() => {
        setStep('who');
        setRail(null);
        setShipowner(null);
        setTransaction(null);
        setAmount('');
        setCurrency('USD');
        setRailDetails({});
        setProofs([]);
        setConfirmImmediately(false);
        setSubmitting(false);
        setError(null);
    }, []);

    const value: RecordPaymentContextValue = {
        step, rail, shipowner, transaction, amount, currency, railDetails, proofs, confirmImmediately, submitting, error,
        setStep, setRail, setShipowner, setTransaction, setAmount, setCurrency,
        setRailDetails, setProofs, setConfirmImmediately, setSubmitting, setError, reset,
    };

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecordPayment(): RecordPaymentContextValue {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('useRecordPayment must be used inside RecordPaymentProvider');
    return v;
}
```

- [ ] **Step 2: Step 1 — rail + shipowner + transaction**

Create `StepRailAndShipowner.tsx`:

```tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { useRecordPayment, type AdminRail, type ShipownerOption, type TransactionOption } from './useRecordPaymentContext';

const RAILS: AdminRail[] = ['CASH', 'CHEQUE', 'LETTER_OF_CREDIT', 'NETTING', 'THIRD_PARTY', 'BANK_GUARANTEE'];

export function StepRailAndShipowner() {
    const t = useTranslations('AdminPayments.recordDialog');
    const ctx = useRecordPayment();
    const [shipownerQuery, setShipownerQuery] = React.useState('');
    const [shipownerResults, setShipownerResults] = React.useState<ShipownerOption[]>([]);
    const [txnResults, setTxnResults] = React.useState<TransactionOption[]>([]);

    // Search shipowners by name (debounced)
    React.useEffect(() => {
        if (shipownerQuery.length < 2) { setShipownerResults([]); return; }
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
    }, [shipownerQuery]);

    // Load shipowner's open transactions when selected
    React.useEffect(() => {
        if (!ctx.shipowner) { setTxnResults([]); return; }
        (async () => {
            const url = new URL('/api/admin/shipowners/' + ctx.shipowner!.id + '/open-transactions', window.location.origin);
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setTxnResults(data.transactions ?? []);
            }
        })();
    }, [ctx.shipowner]);

    function next() {
        if (!ctx.rail)        { ctx.setError(t('errors.railRequired')); return; }
        if (!ctx.shipowner)   { ctx.setError(t('errors.shipownerRequired')); return; }
        // Transaction is optional (e.g. wallet top-up not tied to invoice — but admin-only rails generally do tie)
        ctx.setError(null);
        ctx.setStep('params');
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--os-text-muted)]">{t('step1.intro')}</p>

            {/* Rail picker */}
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('step1.rail')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {RAILS.map((r) => {
                        const selected = ctx.rail === r;
                        return (
                            <button
                                key={r}
                                onClick={() => ctx.setRail(r)}
                                className="text-xs font-mono p-2 rounded-lg border transition-colors text-left"
                                style={{
                                    borderColor: selected ? '#38BDF8' : 'var(--os-border)',
                                    backgroundColor: selected ? 'rgba(56,189,248,0.10)' : 'var(--os-surface-2)',
                                    color: selected ? '#38BDF8' : 'var(--os-text-primary)',
                                }}
                            >
                                {r}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Shipowner autocomplete */}
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('step1.shipowner')}
                </p>
                <OsInput
                    value={ctx.shipowner ? ctx.shipowner.name : shipownerQuery}
                    onChange={(e) => {
                        if (ctx.shipowner) ctx.setShipowner(null);
                        setShipownerQuery(e.target.value);
                    }}
                    placeholder={t('step1.shipownerPlaceholder')}
                />
                {!ctx.shipowner && shipownerResults.length > 0 && (
                    <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        {shipownerResults.map((s) => (
                            <li
                                key={s.id}
                                onClick={() => { ctx.setShipowner(s); setShipownerQuery(''); setShipownerResults([]); }}
                                className="px-3 py-1.5 text-xs cursor-pointer hover:bg-[var(--os-surface-3)]"
                            >
                                {s.name}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Transaction picker (optional) */}
            {ctx.shipowner && txnResults.length > 0 && (
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                        {t('step1.transaction')}
                    </p>
                    <select
                        value={ctx.transaction?.id ?? ''}
                        onChange={(e) => {
                            const tx = txnResults.find((x) => x.id === e.target.value) ?? null;
                            ctx.setTransaction(tx);
                            if (tx) {
                                ctx.setAmount(tx.tax_amount_usd.toFixed(2));
                                ctx.setCurrency('USD');
                            }
                        }}
                        className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] text-[var(--os-text-primary)]"
                    >
                        <option value="">{t('step1.transactionNone')}</option>
                        {txnResults.map((tx) => (
                            <option key={tx.id} value={tx.id}>
                                {tx.invoice_ref ?? tx.id.slice(0, 8)} — ${tx.tax_amount_usd.toFixed(2)}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex justify-end">
                <OsButton variant="primary" size="sm" onClick={next}>{t('next')}</OsButton>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Step 2 — rail-specific params + proofs**

Create `StepRailParams.tsx`:

```tsx
'use client';

import * as React from 'react';
import { ArrowLeft, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { useRecordPayment } from './useRecordPaymentContext';
import { ALLOWED_PROOF_MIME_TYPES, MAX_PROOF_SIZE_BYTES } from '@/services/paymentProofService';

export function StepRailParams() {
    const t = useTranslations('AdminPayments.recordDialog');
    const ctx = useRecordPayment();
    const [local, setLocal] = React.useState<Record<string, string>>({});
    const fileRef = React.useRef<HTMLInputElement>(null);

    function set(k: string, v: string) {
        setLocal((s) => ({ ...s, [k]: v }));
    }

    function handleFiles(list: FileList | null) {
        if (!list) return;
        const next: File[] = [...ctx.proofs];
        for (const f of Array.from(list)) {
            if (f.size > MAX_PROOF_SIZE_BYTES) { ctx.setError(t('errors.fileTooBig', { name: f.name })); continue; }
            if (!ALLOWED_PROOF_MIME_TYPES.has(f.type)) { ctx.setError(t('errors.fileMime', { name: f.name })); continue; }
            next.push(f);
        }
        ctx.setProofs(next);
    }

    function removeFile(i: number) {
        ctx.setProofs(ctx.proofs.filter((_, idx) => idx !== i));
    }

    function next() {
        if (!ctx.amount || !/^\d+(\.\d{1,2})?$/.test(ctx.amount)) {
            ctx.setError(t('errors.amountInvalid')); return;
        }
        // Rail-specific required fields
        const required = REQUIRED_FIELDS[ctx.rail!];
        for (const k of required) {
            if (!local[k]) {
                ctx.setError(t(`errors.required.${k}`));
                return;
            }
        }
        ctx.setRailDetails(buildRailDetails(ctx.rail!, local));
        ctx.setError(null);
        ctx.setStep('confirm');
    }

    function back() { ctx.setError(null); ctx.setStep('who'); }

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--os-text-muted)]">
                {t(`step2.hint.${ctx.rail!.toLowerCase()}`)}
            </p>

            {/* Amount + currency */}
            <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                    <Field label={t('step2.amount')} required>
                        <OsInput value={ctx.amount} onChange={(e) => ctx.setAmount(e.target.value)} placeholder="0.00" />
                    </Field>
                </div>
                <div>
                    <Field label={t('step2.currency')}>
                        <OsInput value={ctx.currency} onChange={(e) => ctx.setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" />
                    </Field>
                </div>
            </div>

            {/* Rail-specific fields */}
            {ctx.rail === 'CASH' && (
                <>
                    <Field label={t('step2.field.receiptNumber')} required>
                        <OsInput value={local.receipt_number ?? ''} onChange={(e) => set('receipt_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.cashier')} required>
                        <OsInput value={local.cashier ?? ''} onChange={(e) => set('cashier', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'CHEQUE' && (
                <>
                    <Field label={t('step2.field.chequeNumber')} required>
                        <OsInput value={local.cheque_number ?? ''} onChange={(e) => set('cheque_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.bankName')} required>
                        <OsInput value={local.bank_name ?? ''} onChange={(e) => set('bank_name', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.chequeDate')}>
                        <OsInput type="date" value={local.cheque_date ?? ''} onChange={(e) => set('cheque_date', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'LETTER_OF_CREDIT' && (
                <>
                    <Field label={t('step2.field.lcNumber')} required>
                        <OsInput value={local.lc_number ?? ''} onChange={(e) => set('lc_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.issuingBank')} required>
                        <OsInput value={local.issuing_bank ?? ''} onChange={(e) => set('issuing_bank', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.expiryDate')}>
                        <OsInput type="date" value={local.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'NETTING' && (
                <>
                    <Field label={t('step2.field.counterparty')} required>
                        <OsInput value={local.counterparty ?? ''} onChange={(e) => set('counterparty', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.netSettlementRef')} required>
                        <OsInput value={local.net_settlement_ref ?? ''} onChange={(e) => set('net_settlement_ref', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'THIRD_PARTY' && (
                <>
                    <Field label={t('step2.field.payerName')} required>
                        <OsInput value={local.payer_name ?? ''} onChange={(e) => set('payer_name', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.payerRelationship')}>
                        <OsInput value={local.payer_relationship ?? ''} onChange={(e) => set('payer_relationship', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.externalReference')}>
                        <OsInput value={local.external_reference ?? ''} onChange={(e) => set('external_reference', e.target.value)} />
                    </Field>
                </>
            )}
            {ctx.rail === 'BANK_GUARANTEE' && (
                <>
                    <Field label={t('step2.field.guaranteeNumber')} required>
                        <OsInput value={local.guarantee_number ?? ''} onChange={(e) => set('guarantee_number', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.issuingBank')} required>
                        <OsInput value={local.issuing_bank ?? ''} onChange={(e) => set('issuing_bank', e.target.value)} />
                    </Field>
                    <Field label={t('step2.field.expiryDate')}>
                        <OsInput type="date" value={local.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value)} />
                    </Field>
                </>
            )}

            {/* Proofs */}
            <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('step2.proofs')}
                </p>
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-[var(--os-border)] text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[#38BDF8]"
                >
                    <Upload className="w-3.5 h-3.5" />
                    {t('step2.proofsCta')}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                    className="hidden"
                    onChange={(e) => handleFiles(e.target.files)}
                />
                {ctx.proofs.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                        {ctx.proofs.map((f, i) => (
                            <li key={i} className="flex items-center gap-2 px-2 py-1 rounded-md bg-[var(--os-surface-2)] text-[11px]">
                                <span className="flex-1 truncate font-mono">{f.name}</span>
                                <span className="text-[var(--os-text-muted)]">{(f.size / 1024).toFixed(0)} KB</span>
                                <button onClick={() => removeFile(i)}><X className="w-3 h-3 text-[#EF4444]" /></button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {ctx.error && <p className="text-xs text-[#EF4444]">{ctx.error}</p>}

            <div className="flex items-center justify-between mt-2">
                <OsButton variant="secondary" size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={back}>
                    {t('back')}
                </OsButton>
                <OsButton variant="primary" size="sm" onClick={next}>{t('next')}</OsButton>
            </div>
        </div>
    );
}

const REQUIRED_FIELDS: Record<string, string[]> = {
    CASH:             ['receipt_number', 'cashier'],
    CHEQUE:           ['cheque_number', 'bank_name'],
    LETTER_OF_CREDIT: ['lc_number', 'issuing_bank'],
    NETTING:          ['counterparty', 'net_settlement_ref'],
    THIRD_PARTY:      ['payer_name'],
    BANK_GUARANTEE:   ['guarantee_number', 'issuing_bank'],
};

function buildRailDetails(rail: string, local: Record<string, string>): Record<string, unknown> {
    // Strip empty strings, return clean snake_case object.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(local)) {
        if (v && v.trim() !== '') out[k] = v.trim();
    }
    return out;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-[var(--os-text-secondary)] uppercase tracking-wide">
                {label} {required && <span className="text-[#EF4444]">*</span>}
            </span>
            {children}
        </label>
    );
}
```

- [ ] **Step 4: Step 3 — confirm + immediate-confirm toggle**

Create `StepConfirm.tsx`:

```tsx
'use client';

import * as React from 'react';
import { ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { recordManualPayment } from '@/actions/recordManualPayment';
import { uploadProof } from '@/services/paymentProofService';
import { useRecordPayment } from './useRecordPaymentContext';

export function StepConfirm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('AdminPayments.recordDialog');
    const ctx = useRecordPayment();

    const isCash = ctx.rail === 'CASH';

    function back() { ctx.setError(null); ctx.setStep('params'); }

    async function submit() {
        if (!ctx.rail || !ctx.shipowner) { ctx.setError(t('errors.invalidState')); return; }
        ctx.setSubmitting(true); ctx.setError(null);
        try {
            const created = await recordManualPayment({
                shipownerId: ctx.shipowner.id,
                transactionId: ctx.transaction?.id ?? null,
                rail: ctx.rail,
                amount: ctx.amount,
                currency: ctx.currency,
                railDetails: ctx.railDetails,
                confirmImmediately: ctx.confirmImmediately, // server will FORCE false for CASH
            });

            // Upload proofs after successful insert
            if (ctx.proofs.length > 0) {
                // Use a client-side Supabase fetch — proofs upload uses the service from inside the client.
                // The browser-safe pattern: POST to /api/admin/payments/[id]/proofs with form-data,
                // OR the server action returns the id and we issue uploads with the user's RLS scope.
                // Spec keeps this simple: a separate POST per file to a small route.
                for (const file of ctx.proofs) {
                    const fd = new FormData();
                    fd.append('file', file);
                    if (ctx.shipowner) fd.append('shipowner_id', ctx.shipowner.id);
                    const res = await fetch(`/api/admin/payments/${created.id}/proofs`, { method: 'POST', body: fd });
                    if (!res.ok) throw new Error(`proof upload failed: ${await res.text()}`);
                }
            }

            ctx.reset();
            onClose();
        } catch (e) {
            ctx.setError(e instanceof Error ? e.message : 'Submission failed');
        } finally {
            ctx.setSubmitting(false);
        }
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-[var(--os-border)] p-4 bg-[var(--os-surface-2)]">
                <SummaryRow label={t('summary.rail')}      value={ctx.rail ?? '—'} mono />
                <SummaryRow label={t('summary.shipowner')} value={ctx.shipowner?.name ?? '—'} />
                <SummaryRow label={t('summary.transaction')} value={ctx.transaction?.invoice_ref ?? ctx.transaction?.id.slice(0, 8) ?? t('summary.noTransaction')} mono />
                <SummaryRow label={t('summary.amount')}    value={`${ctx.amount} ${ctx.currency}`} mono />
                <SummaryRow label={t('summary.proofs')}    value={`${ctx.proofs.length}`} />
                {Object.keys(ctx.railDetails).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--os-border)]">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                            {t('summary.details')}
                        </p>
                        <pre className="text-[11px] text-[var(--os-text-secondary)] whitespace-pre-wrap font-mono">
                            {JSON.stringify(ctx.railDetails, null, 2)}
                        </pre>
                    </div>
                )}
            </div>

            {/* Confirm-immediately toggle */}
            <div
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--os-border)]"
                style={{ backgroundColor: isCash ? 'rgba(234,179,8,0.05)' : undefined }}
            >
                <input
                    id="confirm-immediately"
                    type="checkbox"
                    checked={ctx.confirmImmediately && !isCash}
                    onChange={(e) => ctx.setConfirmImmediately(e.target.checked)}
                    disabled={isCash}
                    className="w-4 h-4"
                />
                <label htmlFor="confirm-immediately" className="text-xs text-[var(--os-text-primary)] flex-1">
                    {t('summary.confirmImmediately')}
                </label>
                {isCash && (
                    <span className="flex items-center gap-1 text-[10px] text-[#EAB308]">
                        <AlertTriangle className="w-3 h-3" />
                        {t('summary.fourEyesRequired')}
                    </span>
                )}
            </div>

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

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1 first:pt-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                {label}
            </span>
            <span className={`text-xs ${mono ? 'font-mono' : ''} text-[var(--os-text-primary)]`}>
                {value}
            </span>
        </div>
    );
}
```

- [ ] **Step 5: Dialog shell + index**

Create `RecordManualPaymentDialog.tsx`:

```tsx
'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { RecordPaymentProvider, useRecordPayment } from './useRecordPaymentContext';
import { StepRailAndShipowner } from './StepRailAndShipowner';
import { StepRailParams } from './StepRailParams';
import { StepConfirm } from './StepConfirm';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function StepIndicator() {
    const { step } = useRecordPayment();
    const idx = ['who', 'params', 'confirm'].indexOf(step);
    return (
        <div className="flex items-center gap-1.5 mb-3">
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="flex-1 h-1 rounded-full"
                    style={{ backgroundColor: i <= idx ? '#10B981' : 'var(--os-surface-2)' }}
                />
            ))}
        </div>
    );
}

function Body({ onClose }: { onClose: () => void }) {
    const { step } = useRecordPayment();
    const t = useTranslations('AdminPayments.recordDialog');
    return (
        <>
            <Dialog.Title className="text-base font-semibold mb-1">{t('title')}</Dialog.Title>
            <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-4">
                {t('subtitle')}
            </Dialog.Description>
            <StepIndicator />
            {step === 'who'     && <StepRailAndShipowner />}
            {step === 'params'  && <StepRailParams />}
            {step === 'confirm' && <StepConfirm onClose={onClose} />}
        </>
    );
}

export function RecordManualPaymentDialog(props: Props) {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                <Dialog.Content
                    className="fixed left-1/2 top-1/2 z-50 w-[600px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                    style={{
                        backgroundColor: 'var(--os-surface-2)',
                        border: '1px solid var(--os-border)',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                    }}
                >
                    <RecordPaymentProvider>
                        <Body onClose={() => props.onOpenChange(false)} />
                    </RecordPaymentProvider>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
```

Create `index.ts`:

```typescript
export { RecordManualPaymentDialog } from './RecordManualPaymentDialog';
```

- [ ] **Step 6: Side route — proof upload**

Create `frontend/src/app/api/admin/payments/[id]/proofs/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { uploadProof } from '@/services/paymentProofService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id: paymentId } = await ctx.params;
    const form = await req.formData();
    const file = form.get('file');
    const shipownerId = form.get('shipowner_id');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (typeof shipownerId !== 'string') return NextResponse.json({ error: 'shipowner_id required' }, { status: 400 });

    const { data: { user } } = await auth.supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    try {
        const result = await uploadProof(auth.supabase, {
            paymentId,
            shipownerId,
            uploadedBy: user.id,
            file,
        });
        return NextResponse.json({ proof: result });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'upload failed' }, { status: 400 });
    }
}
```

- [ ] **Step 7: Side routes — shipowner search + open transactions**

Create `frontend/src/app/api/admin/shipowners/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    if (q.length < 2) return NextResponse.json({ shipowners: [] });

    const { data, error } = await auth.supabase
        .from('shipowners')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .eq('account_state', 'ACTIVE')
        .order('name')
        .limit(20);

    if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 });
    return NextResponse.json({ shipowners: data ?? [] });
}
```

Create `frontend/src/app/api/admin/shipowners/[id]/open-transactions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    const { data: shipowner, error: ownerErr } = await auth.supabase
        .from('shipowners')
        .select('id')
        .eq('id', id)
        .maybeSingle();
    if (ownerErr || !shipowner) return NextResponse.json({ transactions: [] });

    // Transactions linked to vessels of this shipowner with PROFORMA / FINAL / COMPLEMENT not yet PAID.
    // Project pattern: vessels.shipowner_id; transactions.vessel_id.
    const { data, error } = await auth.supabase
        .from('transactions')
        .select('id, invoice_ref, tax_amount_usd, document_type, status, vessel:vessels!inner(shipowner_id)')
        .eq('vessel.shipowner_id', id)
        .in('document_type', ['PROFORMA', 'FINAL', 'COMPLEMENT'])
        .not('status', 'eq', 'PAID')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 });

    const transactions = (data ?? []).map((t: { id: string; invoice_ref: string | null; tax_amount_usd: number }) => ({
        id: t.id,
        invoice_ref: t.invoice_ref,
        tax_amount_usd: Number(t.tax_amount_usd),
    }));

    return NextResponse.json({ transactions });
}
```

- [ ] **Step 8: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

Expected: only `Cannot find module './PaymentReviewDrawer'` should remain — that's Task 7. Everything else clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog/ \
        frontend/src/app/api/admin/payments/\[id\]/proofs/ \
        frontend/src/app/api/admin/shipowners/
git commit -m "feat(7c-3): RecordManualPaymentDialog + side APIs

3-step wizard for the 6 admin-only rails (CASH/CHEQUE/LC/NETTING/
THIRD_PARTY/BANK_GUARANTEE). Step 1 picks rail + autocompletes
shipowner + suggests open transactions. Step 2 collects rail-specific
fields and proof file uploads (5MB cap, mime allow-list). Step 3
shows summary + confirm-immediately toggle (DISABLED for CASH —
4-eyes per mig 057). Submit calls recordManualPayment + uploads
proofs to /api/admin/payments/[id]/proofs.

Side APIs added: shipowner search + open-transactions list.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `<PaymentReviewDrawer>` — confirm/reject/cancel + proof preview

**Files:**
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/PaymentReviewDrawer.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/ProofPreview.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/index.ts`

The drawer slides in from the right edge. Loads payment + proofs by id. Three primary actions: Confirm, Reject (requires reason), Cancel.

- [ ] **Step 1: ProofPreview**

Create `ProofPreview.tsx`:

```tsx
'use client';

import * as React from 'react';
import { FileText, Image as ImageIcon, ExternalLink } from 'lucide-react';

interface Proof {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    signed_url: string;
}

export function ProofPreview({ proof }: { proof: Proof }) {
    const isImage = proof.mime_type.startsWith('image/');
    const isPdf = proof.mime_type === 'application/pdf';
    const filename = proof.storage_path.split('/').pop() ?? proof.id;

    return (
        <div className="rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--os-border)]">
                {isImage ? <ImageIcon className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                         : <FileText className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />}
                <span className="flex-1 truncate text-[11px] font-mono">{filename}</span>
                <span className="text-[10px] text-[var(--os-text-muted)]">{(proof.size_bytes / 1024).toFixed(0)} KB</span>
                <a
                    href={proof.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--os-text-muted)] hover:text-[#10B981]"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            </div>
            {isImage && (
                <img src={proof.signed_url} alt={filename} className="w-full max-h-64 object-contain bg-black/40" />
            )}
            {isPdf && (
                <iframe src={proof.signed_url} className="w-full h-64" title={filename} />
            )}
            {!isImage && !isPdf && (
                <a
                    href={proof.signed_url}
                    download
                    className="block px-3 py-2 text-xs text-[#10B981] hover:underline"
                >
                    Download
                </a>
            )}
        </div>
    );
}
```

- [ ] **Step 2: PaymentReviewDrawer**

Create `PaymentReviewDrawer.tsx`:

```tsx
'use client';

import * as React from 'react';
import { X, CheckCircle2, XCircle, Ban, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { confirmPayment } from '@/actions/confirmPayment';
import { rejectPayment } from '@/actions/rejectPayment';
import { cancelPayment } from '@/actions/cancelPayment';
import { ProofPreview } from './ProofPreview';
import type { PaymentRow } from '@/services/paymentService';

interface Props {
    paymentId: string;
    onClose: () => void;
}

interface Proof {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    signed_url: string;
}

export function PaymentReviewDrawer({ paymentId, onClose }: Props) {
    const t = useTranslations('AdminPayments.reviewDrawer');
    const [payment, setPayment] = React.useState<PaymentRow | null>(null);
    const [proofs, setProofs] = React.useState<Proof[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [busyAction, setBusyAction] = React.useState<'confirm' | 'reject' | 'cancel' | null>(null);
    const [showRejectReason, setShowRejectReason] = React.useState(false);
    const [rejectReason, setRejectReason] = React.useState('');

    React.useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const res = await fetch(`/api/admin/payments/${paymentId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (cancelled) return;
                setPayment(data.payment as PaymentRow);
                setProofs(data.proofs ?? []);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [paymentId]);

    async function doConfirm() {
        if (!payment) return;
        setBusyAction('confirm'); setError(null);
        try {
            await confirmPayment({ paymentId: payment.id });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Confirm failed');
        } finally {
            setBusyAction(null);
        }
    }

    async function doReject() {
        if (!payment) return;
        if (!rejectReason || rejectReason.trim().length < 3) {
            setError(t('errors.reasonRequired'));
            return;
        }
        setBusyAction('reject'); setError(null);
        try {
            await rejectPayment({ paymentId: payment.id, reason: rejectReason.trim() });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Reject failed');
        } finally {
            setBusyAction(null);
        }
    }

    async function doCancel() {
        if (!payment) return;
        setBusyAction('cancel'); setError(null);
        try {
            await cancelPayment({ paymentId: payment.id });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Cancel failed');
        } finally {
            setBusyAction(null);
        }
    }

    const canConfirm = payment?.status === 'INITIATED' || payment?.status === 'PROCESSING';
    const canReject  = payment?.status === 'INITIATED' || payment?.status === 'PROCESSING';
    const canCancel  = payment?.status === 'INITIATED';

    return (
        <>
            {/* Overlay */}
            <div
                className="fixed inset-0 z-40 bg-black/60 transition-opacity"
                onClick={onClose}
            />
            {/* Drawer */}
            <aside
                className="fixed top-0 right-0 z-50 h-screen w-[480px] max-w-full overflow-y-auto p-5"
                style={{
                    backgroundColor: 'var(--os-surface-1)',
                    borderLeft: '1px solid var(--os-border)',
                }}
            >
                <header className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-base font-semibold">{t('title')}</h2>
                        {payment && (
                            <p className="text-[10px] font-mono text-[var(--os-text-muted)] mt-0.5">{payment.id}</p>
                        )}
                    </div>
                    <button onClick={onClose}>
                        <X className="w-4 h-4 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]" />
                    </button>
                </header>

                {loading && (
                    <div className="flex items-center gap-2 text-xs text-[var(--os-text-muted)]">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        {t('loading')}
                    </div>
                )}

                {error && (
                    <p className="text-xs text-[#EF4444] mb-3">{error}</p>
                )}

                {payment && (
                    <>
                        <Section label={t('status')}>
                            <span className="text-sm font-mono">{payment.status}</span>
                        </Section>
                        <Section label={t('rail')}>
                            <span className="text-sm font-mono">{payment.rail}</span>
                        </Section>
                        <Section label={t('amount')}>
                            <span className="text-sm font-mono tabular-nums">
                                ${(payment.amount_usd_minor / 100).toFixed(2)}
                                {payment.currency !== 'USD' && (
                                    <span className="ml-2 text-[10px] text-[var(--os-text-muted)]">
                                        ({(payment.amount_minor / 100).toFixed(2)} {payment.currency})
                                    </span>
                                )}
                            </span>
                        </Section>
                        {payment.transaction_id && (
                            <Section label={t('transaction')}>
                                <span className="text-xs font-mono">{payment.transaction_id.slice(0, 8)}</span>
                            </Section>
                        )}
                        <Section label={t('declaredBy')}>
                            <span className="text-xs font-mono">{payment.declared_by ?? '—'}</span>
                        </Section>
                        <Section label={t('createdAt')}>
                            <span className="text-xs">{new Date(payment.created_at).toLocaleString()}</span>
                        </Section>
                        {Object.keys(payment.rail_details).length > 0 && (
                            <Section label={t('details')}>
                                <pre className="text-[10px] font-mono text-[var(--os-text-secondary)] whitespace-pre-wrap">
                                    {JSON.stringify(payment.rail_details, null, 2)}
                                </pre>
                            </Section>
                        )}

                        {proofs.length > 0 && (
                            <div className="mt-4">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                                    {t('proofs')} ({proofs.length})
                                </p>
                                <div className="flex flex-col gap-2">
                                    {proofs.map((p) => <ProofPreview key={p.id} proof={p} />)}
                                </div>
                            </div>
                        )}

                        {/* Reject reason */}
                        {showRejectReason && (
                            <div className="mt-4">
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#EF4444] mb-1.5">
                                    {t('rejectReason')}
                                </p>
                                <OsInput value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t('rejectReasonPlaceholder')} />
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="mt-5 flex flex-col gap-2">
                            {canConfirm && !showRejectReason && (
                                <OsButton
                                    variant="primary"
                                    size="sm"
                                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                                    onClick={doConfirm}
                                    disabled={busyAction !== null}
                                >
                                    {busyAction === 'confirm' ? t('confirming') : t('confirm')}
                                </OsButton>
                            )}
                            {canReject && !showRejectReason && (
                                <OsButton
                                    variant="secondary"
                                    size="sm"
                                    icon={<XCircle className="w-3.5 h-3.5" />}
                                    onClick={() => setShowRejectReason(true)}
                                    disabled={busyAction !== null}
                                >
                                    {t('reject')}
                                </OsButton>
                            )}
                            {showRejectReason && (
                                <>
                                    <OsButton
                                        variant="primary"
                                        size="sm"
                                        icon={<XCircle className="w-3.5 h-3.5" />}
                                        onClick={doReject}
                                        disabled={busyAction !== null}
                                    >
                                        {busyAction === 'reject' ? t('rejecting') : t('confirmReject')}
                                    </OsButton>
                                    <OsButton
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => { setShowRejectReason(false); setRejectReason(''); setError(null); }}
                                        disabled={busyAction !== null}
                                    >
                                        {t('cancelReject')}
                                    </OsButton>
                                </>
                            )}
                            {canCancel && !showRejectReason && (
                                <OsButton
                                    variant="secondary"
                                    size="sm"
                                    icon={<Ban className="w-3.5 h-3.5" />}
                                    onClick={doCancel}
                                    disabled={busyAction !== null}
                                >
                                    {busyAction === 'cancel' ? t('cancelling') : t('cancel')}
                                </OsButton>
                            )}
                        </div>
                    </>
                )}
            </aside>
        </>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-[var(--os-border)] last:border-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                {label}
            </span>
            <div>{children}</div>
        </div>
    );
}
```

Create `index.ts`:

```typescript
export { PaymentReviewDrawer } from './PaymentReviewDrawer';
```

- [ ] **Step 3: tsc clean**

```bash
cd frontend && npx tsc --noEmit
```

Expected: ZERO errors. All `PaymentsAdmin` imports now resolve.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer/
git commit -m "feat(7c-3): PaymentReviewDrawer + ProofPreview

Right-side drawer (480px) loads /api/admin/payments/[id] including
signed proof URLs (5-min TTL). Inline image preview, embedded PDF,
download fallback for other types. Three actions: Confirm (calls
confirmPayment from 7C-1), Reject (requires reason ≥3 chars, calls
rejectPayment), Cancel (only on INITIATED, calls cancelPayment).
Action gating reflects payment.status.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire `<PaymentsAdminPanel>` into the page (additive, above legacy)

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/payments/page.tsx`

- [ ] **Step 1: Add the new panel above the legacy one**

Read the existing file first, then patch:

```typescript
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PaymentProvidersPanel } from '@/components/dashboard/admin/PaymentProvidersPanel';
import { PendingIntentsPanel } from '@/components/dashboard/admin/PendingIntentsPanel';
import { PaymentsAdminPanel } from '@/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel';
import { listPendingPaymentIntents } from '@/services/paymentIntentService';

export const metadata: Metadata = {
    title: 'Payments | Green Gate',
    description: 'Resolve payments (v7) and legacy intents; configure the active payment provider.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN']);

export default async function PaymentsAdminRoute() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) {
        redirect('/dashboard');
    }

    const intents = await listPendingPaymentIntents(supabase);

    return (
        <div className="px-6 py-4">
            {/* Plan 7C-3: v7 payments table — primary admin surface */}
            <PaymentsAdminPanel />

            {/* Legacy v0 intents — kept until Plan 7C-5 cutover */}
            {intents.length > 0 && (
                <details className="mb-5">
                    <summary className="text-xs text-[var(--os-text-muted)] cursor-pointer mb-2">
                        Legacy intents ({intents.length})
                    </summary>
                    <PendingIntentsPanel intents={intents} />
                </details>
            )}

            <PaymentProvidersPanel />
        </div>
    );
}
```

- [ ] **Step 2: Build + verify**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx next build
```

Both must succeed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/payments/page.tsx
git commit -m "feat(7c-3): mount PaymentsAdminPanel on /admin/payments

PaymentsAdminPanel rendered first (primary admin surface for v7 payments).
Legacy PendingIntentsPanel collapsed inside <details> when intents > 0
(disappears entirely when none remain). PaymentProvidersPanel unchanged.
Plan 7C-5 will drop the legacy intents block entirely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: i18n EN/FR — `AdminPayments` namespace

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

- [ ] **Step 1: Add EN keys**

Add to `frontend/messages/en.json` as a new sibling top-level namespace `AdminPayments`:

```json
"AdminPayments": {
    "title": "Payments",
    "subtitle": "Review owner-initiated payments and record manual entries.",
    "refresh": "Refresh",
    "recordManual": "Record manual",
    "filterStatus": "Status",
    "filterRail": "Rail",
    "loading": "Loading payments…",
    "empty": "No payments match the current filters.",
    "col": {
        "id": "ID",
        "rail": "Rail",
        "amount": "Amount",
        "status": "Status",
        "created": "Created",
        "ref": "Ext. ref"
    },
    "recordDialog": {
        "title": "Record manual payment",
        "subtitle": "Insert a payment row on behalf of a shipowner. CASH always requires a second admin to confirm (4-eyes).",
        "back": "Back",
        "next": "Next",
        "submit": "Record payment",
        "submitting": "Recording…",
        "step1": {
            "intro": "Choose the rail and identify the shipowner + transaction.",
            "rail": "Rail",
            "shipowner": "Shipowner",
            "shipownerPlaceholder": "Search by name…",
            "transaction": "Transaction (optional)",
            "transactionNone": "— No specific transaction —"
        },
        "step2": {
            "amount": "Amount",
            "currency": "Currency",
            "proofs": "Proof files",
            "proofsCta": "Click to upload (PDF / image, ≤ 5MB)",
            "hint": {
                "cash":             "Issue the cash receipt and record the cashier's name.",
                "cheque":           "Capture the cheque number, bank, and date.",
                "letter_of_credit": "Record the LC reference and issuing bank.",
                "netting":          "Identify the counterparty and the net settlement reference.",
                "third_party":      "Identify the third-party payer.",
                "bank_guarantee":   "Record the guarantee number and issuing bank."
            },
            "field": {
                "receiptNumber":      "Receipt number",
                "cashier":            "Cashier name",
                "chequeNumber":       "Cheque number",
                "bankName":           "Bank name",
                "chequeDate":         "Cheque date",
                "lcNumber":           "LC number",
                "issuingBank":        "Issuing bank",
                "expiryDate":         "Expiry date",
                "counterparty":       "Counterparty",
                "netSettlementRef":   "Net settlement ref",
                "payerName":          "Payer name",
                "payerRelationship":  "Relationship",
                "externalReference":  "External reference",
                "guaranteeNumber":    "Guarantee number"
            }
        },
        "summary": {
            "rail":               "Rail",
            "shipowner":          "Shipowner",
            "transaction":        "Transaction",
            "noTransaction":      "(none)",
            "amount":             "Amount",
            "proofs":              "Proofs",
            "details":            "Details",
            "confirmImmediately": "Confirm immediately (mark as CONFIRMED — admin signs off as confirmer)",
            "fourEyesRequired":   "CASH requires 4-eyes — second admin must confirm"
        },
        "errors": {
            "railRequired":      "Pick a rail first.",
            "shipownerRequired": "Pick a shipowner.",
            "amountInvalid":     "Amount must be a positive decimal with up to 2 fraction digits.",
            "fileTooBig":        "{name} exceeds the 5MB limit.",
            "fileMime":          "{name} has an unsupported file type.",
            "invalidState":      "Wizard state is incomplete.",
            "required": {
                "receipt_number":     "Receipt number is required.",
                "cashier":            "Cashier name is required.",
                "cheque_number":      "Cheque number is required.",
                "bank_name":          "Bank name is required.",
                "lc_number":          "LC number is required.",
                "issuing_bank":       "Issuing bank is required.",
                "counterparty":       "Counterparty is required.",
                "net_settlement_ref": "Settlement reference is required.",
                "payer_name":         "Payer name is required.",
                "guarantee_number":   "Guarantee number is required."
            }
        }
    },
    "reviewDrawer": {
        "title": "Payment review",
        "loading": "Loading payment…",
        "status": "Status",
        "rail": "Rail",
        "amount": "Amount",
        "transaction": "Transaction",
        "declaredBy": "Declared by",
        "createdAt": "Created",
        "details": "Rail details",
        "proofs": "Proofs",
        "confirm": "Confirm",
        "confirming": "Confirming…",
        "reject": "Reject",
        "rejecting": "Rejecting…",
        "confirmReject": "Submit rejection",
        "cancelReject": "Back",
        "cancel": "Cancel payment",
        "cancelling": "Cancelling…",
        "rejectReason": "Reason for rejection",
        "rejectReasonPlaceholder": "Required — explain why this payment is rejected.",
        "errors": {
            "reasonRequired": "Reason must be at least 3 characters."
        }
    }
}
```

- [ ] **Step 2: Add FR keys**

Mirror in `frontend/messages/fr.json` with French translations (same structure).

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/en.json'))"
node -e "JSON.parse(require('fs').readFileSync('frontend/messages/fr.json'))"
```

Both must exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git commit -m "feat(7c-3): i18n EN/FR — AdminPayments namespace

Top-level namespace covering panel chrome, recordDialog wizard
(3 steps incl. errors), and reviewDrawer actions. Mirrored EN ⇄ FR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Tests + final gates

**Files:**
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel.test.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog.test.tsx`
- Create: `frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer.test.tsx`

3 RTL+vitest tests covering the most-likely-to-regress UX paths.

- [ ] **Step 1: PaymentsAdminPanel test**

Create `PaymentsAdminPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PaymentsAdminPanel } from './PaymentsAdminPanel';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/lib/RoleContext', () => ({
    useRole: () => ({ role: 'FINANCE_ADMIN' }),
}));
vi.mock('@/lib/rbac', () => ({
    canEdit: () => true,
}));

global.fetch = vi.fn();

function setup() {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <PaymentsAdminPanel />
        </NextIntlClientProvider>,
    );
}

describe('PaymentsAdminPanel', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('renders the table with rows from /api/admin/payments', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                payments: [
                    { id: 'p1', status: 'INITIATED', rail: 'CHEQUE', amount_usd_minor: 50000,
                      currency: 'USD', amount_minor: 50000, shipowner_id: 's1', transaction_id: 't1',
                      declared_by: 'a1', fx_rate: null, fx_rate_source: null, fx_rate_locked_at: null,
                      rail_details: {}, external_reference: 'CHK-1', rejected_reason: null,
                      confirmed_by: null, confirmed_at: null, created_at: '2026-05-10T00:00:00Z',
                      updated_at: '2026-05-10T00:00:00Z' },
                ],
            }),
        });
        setup();
        await waitFor(() => expect(screen.getByText('CHEQUE')).toBeInTheDocument());
        expect(screen.getByText('CHK-1')).toBeInTheDocument();
        expect(screen.getByText('INITIATED')).toBeInTheDocument();
    });

    it('toggling a status filter refetches with new query', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ payments: [] }) });
        setup();
        await waitFor(() => screen.getByText(/No payments/i));

        // Initial fetch had status filter (INITIATED, PROCESSING by default)
        const initialUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as URL;
        expect(initialUrl.searchParams.get('status')).toMatch(/INITIATED|PROCESSING/);

        // Click CONFIRMED filter button
        fireEvent.click(screen.getByText('CONFIRMED'));
        await waitFor(() => {
            const lastUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as URL;
            expect(lastUrl.searchParams.get('status')).toContain('CONFIRMED');
        });
    });
});
```

- [ ] **Step 2: RecordManualPaymentDialog test (CASH 4-eyes block)**

Create `RecordManualPaymentDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { RecordManualPaymentDialog } from './RecordManualPaymentDialog';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/actions/recordManualPayment', () => ({
    recordManualPayment: vi.fn().mockResolvedValue({ id: 'pay-new', status: 'INITIATED' }),
}));

global.fetch = vi.fn();

function setup() {
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <RecordManualPaymentDialog open={true} onOpenChange={() => {}} />
        </NextIntlClientProvider>,
    );
}

describe('RecordManualPaymentDialog', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
        (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: URL | string) => {
            const u = typeof url === 'string' ? new URL(url, 'http://x') : url;
            if (u.pathname.endsWith('/api/admin/shipowners/search')) {
                return { ok: true, json: async () => ({ shipowners: [{ id: 'own-1', name: 'Acme Shipping' }] }) };
            }
            if (u.pathname.match(/\/open-transactions$/)) {
                return { ok: true, json: async () => ({ transactions: [] }) };
            }
            return { ok: true, json: async () => ({}) };
        });
    });

    it('disables Confirm Immediately checkbox when CASH is selected', async () => {
        setup();
        // Step 1: pick CASH + a shipowner
        fireEvent.click(screen.getByText('CASH'));
        const input = screen.getByPlaceholderText('Search by name…');
        fireEvent.change(input, { target: { value: 'Acme' } });
        await waitFor(() => screen.getByText('Acme Shipping'));
        fireEvent.click(screen.getByText('Acme Shipping'));
        fireEvent.click(screen.getByText('Next'));

        // Step 2: amount + receipt + cashier
        const amountInput = screen.getAllByPlaceholderText('0.00')[0];
        fireEvent.change(amountInput, { target: { value: '100.00' } });
        const inputs = screen.getAllByDisplayValue('');
        // Receipt number + cashier are the 2 required text inputs in CASH branch.
        // We brute-force fill all empty inputs to satisfy the validator.
        for (const el of inputs) {
            if (el.tagName === 'INPUT' && el.getAttribute('type') !== 'date') {
                fireEvent.change(el, { target: { value: 'X' } });
            }
        }
        fireEvent.click(screen.getByText('Next'));

        // Step 3: 4-eyes warning shown, checkbox disabled
        await waitFor(() => screen.getByText(/4-eyes/));
        const checkbox = screen.getByLabelText(/Confirm immediately/) as HTMLInputElement;
        expect(checkbox.disabled).toBe(true);
    });
});
```

- [ ] **Step 3: PaymentReviewDrawer test (confirm + reject reason validation)**

Create `PaymentReviewDrawer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { PaymentReviewDrawer } from './PaymentReviewDrawer/PaymentReviewDrawer';
import enMessages from '../../../../../messages/en.json';

vi.mock('@/actions/confirmPayment', () => ({
    confirmPayment: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/actions/rejectPayment', () => ({
    rejectPayment: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/actions/cancelPayment', () => ({
    cancelPayment: vi.fn().mockResolvedValue({ ok: true }),
}));

global.fetch = vi.fn();

function setup(onClose = () => {}) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
            payment: {
                id: 'pay-1', status: 'INITIATED', rail: 'CHEQUE',
                amount_minor: 50000, amount_usd_minor: 50000, currency: 'USD',
                shipowner_id: 's1', transaction_id: 't1', declared_by: 'a1',
                fx_rate: null, fx_rate_source: null, fx_rate_locked_at: null,
                rail_details: { cheque_number: 'C1' }, external_reference: null,
                rejected_reason: null, confirmed_by: null, confirmed_at: null,
                created_at: '2026-05-10T00:00:00Z', updated_at: '2026-05-10T00:00:00Z',
            },
            proofs: [],
        }),
    });
    return render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
            <PaymentReviewDrawer paymentId="pay-1" onClose={onClose} />
        </NextIntlClientProvider>,
    );
}

describe('PaymentReviewDrawer', () => {
    beforeEach(() => {
        (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('confirm action calls confirmPayment and onClose', async () => {
        const onClose = vi.fn();
        setup(onClose);
        await waitFor(() => screen.getByText('CHEQUE'));
        fireEvent.click(screen.getByText('Confirm'));
        const { confirmPayment } = await import('@/actions/confirmPayment');
        await waitFor(() => {
            expect(confirmPayment).toHaveBeenCalledWith({ paymentId: 'pay-1' });
            expect(onClose).toHaveBeenCalled();
        });
    });

    it('reject without reason shows error; with reason calls rejectPayment', async () => {
        const onClose = vi.fn();
        setup(onClose);
        await waitFor(() => screen.getByText('CHEQUE'));
        fireEvent.click(screen.getByText('Reject'));
        // Now reason input is shown — submit with empty reason
        fireEvent.click(screen.getByText('Submit rejection'));
        expect(await screen.findByText(/Reason must be at least 3 characters/i)).toBeInTheDocument();

        // Type a reason and submit
        const reasonInput = screen.getByPlaceholderText(/explain why/i);
        fireEvent.change(reasonInput, { target: { value: 'duplicate' } });
        fireEvent.click(screen.getByText('Submit rejection'));

        const { rejectPayment } = await import('@/actions/rejectPayment');
        await waitFor(() => {
            expect(rejectPayment).toHaveBeenCalledWith({ paymentId: 'pay-1', reason: 'duplicate' });
            expect(onClose).toHaveBeenCalled();
        });
    });
});
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/components/dashboard/admin/PaymentsAdmin/
```

Expected: 5+ new tests pass (2 panel + 1 dialog + 2 drawer = 5 minimum).

- [ ] **Step 5: Final gates**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx next build
```

All three MUST pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentsAdminPanel.test.tsx \
        frontend/src/components/dashboard/admin/PaymentsAdmin/RecordManualPaymentDialog.test.tsx \
        frontend/src/components/dashboard/admin/PaymentsAdmin/PaymentReviewDrawer.test.tsx
git commit -m "feat(7c-3): vitest+RTL coverage on admin payments UI

5 tests:
- PaymentsAdminPanel: list renders from API + status filter toggle refetches
- RecordManualPaymentDialog: CASH selection disables 'Confirm immediately'
  checkbox (4-eyes UI gate)
- PaymentReviewDrawer: Confirm calls confirmPayment + onClose ;
  Reject validates reason ≥3 chars then calls rejectPayment

All gates green: tsc, vitest, next build.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria

- [ ] `paymentProofService.uploadProof` validates 5MB cap + mime allow-list
- [ ] `paymentProofService.listProofs` returns oldest-first
- [ ] `paymentProofService.signedProofUrl` returns a 60-second URL (default)
- [ ] `recordManualPayment` Zod-validates input, gates by FINANCE_ADMIN/SUPERADMIN
- [ ] `recordManualPayment` FORCES `status='INITIATED'` for CASH regardless of `confirmImmediately`
- [ ] `recordManualPayment` accepts `confirmImmediately=true` for the other 5 rails and writes `status='CONFIRMED' + confirmed_by + confirmed_at`
- [ ] `paymentService.listAdminPayments` filters by status, rail, date range, q (ILIKE)
- [ ] `GET /api/admin/payments` returns filtered list (admin-only)
- [ ] `GET /api/admin/payments/[id]` returns payment + proofs with signed URLs (admin-only)
- [ ] `POST /api/admin/payments/[id]/proofs` uploads form-data file → `payment_proofs` row (admin-only)
- [ ] `GET /api/admin/shipowners/search?q=` returns ACTIVE shipowners by name (admin-only)
- [ ] `GET /api/admin/shipowners/[id]/open-transactions` returns non-PAID PROFORMA/FINAL/COMPLEMENT for the owner
- [ ] `<PaymentsAdminPanel>` renders on `/admin/payments` above the legacy block
- [ ] Default filter shows INITIATED + PROCESSING (admin's todo queue)
- [ ] Toggling status/rail filter refetches the API
- [ ] Click row → `<PaymentReviewDrawer>` opens
- [ ] "Record manual" button → `<RecordManualPaymentDialog>` opens (gated by `canEdit('tax-settings')`)
- [ ] Dialog Step 1: rail picker (6 rails) + shipowner autocomplete + transaction picker
- [ ] Dialog Step 2: branched fields per rail + proof file upload (5MB / mime cap with localized errors)
- [ ] Dialog Step 3: summary + "Confirm immediately" toggle, DISABLED for CASH with 4-eyes warning
- [ ] Dialog submit: `recordManualPayment` then `POST /proofs` per file
- [ ] Drawer loads payment + proofs (signed URLs)
- [ ] Drawer image/PDF preview + download fallback for other types
- [ ] Drawer Confirm button → `confirmPayment`
- [ ] Drawer Reject → reason input (≥3 chars) → `rejectPayment`
- [ ] Drawer Cancel button → `cancelPayment` (only on INITIATED)
- [ ] Drawer action buttons gated by `payment.status`
- [ ] Legacy `PendingIntentsPanel.tsx` and `paymentIntentService.ts` files UNTOUCHED
- [ ] `AdminPayments.*` i18n complete in EN + FR
- [ ] Gates green: tsc, vitest, next build (no new pg migration)

---

## Pre-merge checklist for the human

1. **Functional smoke test**:
   - As FINANCE_ADMIN, open `/admin/payments`
   - Click "Record manual" → CASH → search a shipowner → fill receipt + cashier → upload a PDF → submit
   - Verify the new row appears in the list with `INITIATED` status
   - Click the row → drawer opens, proof preview visible
   - As a SECOND FINANCE_ADMIN, click Confirm → row → CONFIRMED. (1st admin clicking Confirm should fail at the DB layer per `can_confirm_payment` in mig 057.)

2. **Hosted DB**: no new migration needed. All required schema is already on develop (mig 048-059 + 060 from 7C-2).

3. **Backward compat verify**: legacy `PendingIntentsPanel` still renders intents declared via the old `<PayProformaDialog>` flow. Both panels coexist.

4. **Rollback**: revert the 10 commits of this plan; no schema changes to undo.

---

## Self-Review Notes

- **Spec coverage:** §7.2 lists 7 admin-only rails (incl. MOBILE_MONEY); we ship 6 (excluding MOBILE_MONEY) because Plan 7C-2 already made MOBILE_MONEY owner-initiable. If the admin needs to record an out-of-band MOBILE_MONEY payment (operator paid us directly, owner didn't initiate), they can use `THIRD_PARTY` as a workaround, or v1.1 adds MOBILE_MONEY to `ADMIN_ONLY_RAILS`. Trade-off documented.
- **Type consistency:** `AdminRail` (this plan) ⊂ `PaymentRail` (Plan 7C-1). `recordManualPayment` server action validates against `ADMIN_ONLY_RAILS` (6) — a separate Zod enum from owner-side `OWNER_RAILS` (4). No overlap risk.
- **4-eyes UX:** disabled in UI AND forced in server action AND enforced in DB (`can_confirm_payment` returns FALSE if `declared_by = profile_id` for CASH). Triple-defense.
- **Proof upload coupling:** frontend uploads proofs ONLY after `recordManualPayment` returns the new id, so a failed insert never orphans Storage objects. If a proof upload fails post-insert, the payment row exists in INITIATED state — admin can re-upload from the drawer in v1.1, or for now they reject and re-record. Note in pre-merge checklist.
- **Pre-existing dead code:** the `hasEnvKey` line in `paymentService.ts` is still unused — out of scope; Plan 7C-5 cleans it up.
- **i18n scope:** `AdminPayments` is a NEW top-level namespace (siblings: `OwnerPortal`, `Dashboard`, etc.). Mirror EN ⇄ FR; AR/PT/SW translations deferred to Plan 7H per project memory.
