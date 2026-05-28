# Payment Proof Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a shipowner upload one or more proofs of payment (SWIFT MT103) on both the v7 owner portal and the legacy invoices page, with the admin always validating before the payment is marked paid.

**Architecture:** Two thin paths (Approach A). v7 reuses the existing `payment_proofs` table + `paymentProofService` + `payment-proofs` bucket; only owner-side upload/delete routes and UI are new (the admin `PaymentReviewDrawer` already lists proofs). Legacy gains a `transactions.payment_proof_files` JSONB column, its own upload/delete route, and UI in `WireTransferModal`. A shared `<ProofUploader>` component drives both surfaces via adapter callbacks.

**Tech Stack:** Next.js App Router (route handlers + server actions), Supabase (Postgres + Storage), TypeScript, Vitest, next-intl.

---

## Key facts established during design (do not re-investigate)

- Bucket `payment-proofs` exists (mig 059), private, RLS owner-write only → all writes go through **service-role** server routes after an explicit ownership check.
- `payment_proofs` table (mig 049): `id, payment_id FK→payments, storage_path, mime_type, size_bytes (CHECK ≤5MB), uploaded_by FK→profiles, uploaded_at, description`. RLS enabled, **zero policies** → service-role only.
- `paymentProofService` (`frontend/src/services/paymentProofService.ts`) exports `uploadProof`, `listProofs`, `signedProofUrl`, `MAX_PROOF_SIZE_BYTES`, `ALLOWED_PROOF_MIME_TYPES`.
- `can_confirm_payment` (mig 057) allows confirming when status ∈ `{INITIATED, PROCESSING}` → flipping a WIRE payment to PROCESSING on proof upload is safe.
- `initiatePayment` (`frontend/src/actions/initiatePayment.ts`) for WIRE_TRANSFER inserts a `payments` row at `status='INITIATED'` and returns `{ id, status, transaction_id, amount_usd_minor }`.
- Owner API auth pattern (`frontend/src/app/api/owner/notifications/route.ts`): session client `auth.getUser()` → service-role client for reads/writes → resolve `shipowner_id` via `shipowners.profile_id = user.id`.
- Migration tip = 068 (repo + hosted). Next number = **069**.
- Hosted DB push (no `supabase link`): `supabase db push --db-url "postgresql://postgres:<SUPABASE_DB_PASSWORD>@db.dyjolepwxxsedwngkfox.supabase.co:5432/postgres"` (password in `frontend/.env.local`).
- Test runner: `cd frontend && npx vitest run <path>`. Typecheck: `cd frontend && npx tsc --noEmit`.

## Scope notes (deltas from spec, accepted)

- **Admin v7 side: NO work** — `PaymentReviewDrawer` + `ProofPreview` + `/api/admin/payments/[id]` already render proofs with signed URLs and confirm/reject PROCESSING.
- **`PROOF_SUBMITTED` notification: DEFERRED** — there is no admin-notification system (owner_notifications is owner-only), so "notify admin" is not feasible for v1. The admin signal is the payment surfacing in `/admin/payments` with proofs attached + PROCESSING status. An owner-facing reassurance notification is a deferred follow-up.

---

# PHASE 1 — v7 owner portal

### Task 1: Owner proofs route — GET (list) + POST (upload)

**Files:**
- Create: `frontend/src/app/api/owner/payments/[id]/proofs/route.ts`
- Test: `frontend/src/app/api/owner/payments/[id]/proofs/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/app/api/owner/payments/[id]/proofs/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the session client (auth gate)
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

// Mock the service-role client + paymentProofService
const svc = {
    from: vi.fn(),
};
vi.mock('@supabase/supabase-js', () => ({
    createClient: () => svc,
}));
const mockUpload = vi.fn();
const mockList = vi.fn();
vi.mock('@/services/paymentProofService', () => ({
    uploadProof: (...a: unknown[]) => mockUpload(...a),
    listProofs: (...a: unknown[]) => mockList(...a),
}));

import { GET, POST } from '../route';

function makeReqWithFile(): Request {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'mt103.pdf', { type: 'application/pdf' }));
    return new Request('http://x/api/owner/payments/p1/proofs', { method: 'POST', body: fd });
}

// Helper: stub a payment lookup + shipowner lookup chain on the service client.
function stubOwnership(opts: { shipownerId: string; paymentShipownerId: string; status: string }) {
    svc.from.mockImplementation((table: string) => {
        if (table === 'shipowners') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: opts.shipownerId }, error: null }) }) }) };
        }
        if (table === 'payments') {
            return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', shipowner_id: opts.paymentShipownerId, status: opts.status }, error: null }) }) }),
                update: () => ({ eq: () => ({ then: undefined }) }),
            };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    });
}

describe('POST /api/owner/payments/[id]/proofs', () => {
    beforeEach(() => { vi.clearAllMocks(); process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; });

    it('401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null } });
        const res = await POST(makeReqWithFile() as never, { params: Promise.resolve({ id: 'p1' }) });
        expect(res.status).toBe(401);
    });

    it('403 when the payment belongs to a different shipowner', async () => {
        mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
        stubOwnership({ shipownerId: 'own-A', paymentShipownerId: 'own-B', status: 'INITIATED' });
        const res = await POST(makeReqWithFile() as never, { params: Promise.resolve({ id: 'p1' }) });
        expect(res.status).toBe(403);
        expect(mockUpload).not.toHaveBeenCalled();
    });

    it('uploads and returns the proof for an owned INITIATED payment', async () => {
        mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
        stubOwnership({ shipownerId: 'own-A', paymentShipownerId: 'own-A', status: 'INITIATED' });
        mockUpload.mockResolvedValue({ id: 'pr1', storage_path: 'own-A/p1/123-mt103.pdf' });
        const res = await POST(makeReqWithFile() as never, { params: Promise.resolve({ id: 'p1' }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.proof.id).toBe('pr1');
        expect(mockUpload).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/api/owner/payments/[id]/proofs/__tests__/route.test.ts`
Expected: FAIL — cannot find module `../route`.

- [ ] **Step 3: Write the route**

```typescript
// frontend/src/app/api/owner/payments/[id]/proofs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { uploadProof, listProofs } from '@/services/paymentProofService';

const ATTACHABLE = new Set(['INITIATED', 'PROCESSING']);

interface OwnedPayment { id: string; shipowner_id: string; status: string }

// Resolve caller → shipowner_id, load the target payment, assert ownership.
// Returns { error: NextResponse } on any failure, else { admin, payment, shipownerId }.
async function authorize(paymentId: string) {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

    const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: shipowner } = await admin
        .from('shipowners').select('id').eq('profile_id', user.id).maybeSingle();
    if (!shipowner) return { error: NextResponse.json({ error: 'No shipowner record' }, { status: 403 }) };

    const { data: payment } = await admin
        .from('payments').select('id, shipowner_id, status').eq('id', paymentId).maybeSingle();
    if (!payment) return { error: NextResponse.json({ error: 'Payment not found' }, { status: 404 }) };
    if ((payment as OwnedPayment).shipowner_id !== shipowner.id) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { admin, payment: payment as OwnedPayment, shipownerId: shipowner.id, userId: user.id };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const a = await authorize(id);
    if ('error' in a) return a.error;
    const proofs = await listProofs(a.admin, id);
    return NextResponse.json({ proofs });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const a = await authorize(id);
    if ('error' in a) return a.error;
    if (!ATTACHABLE.has(a.payment.status)) {
        return NextResponse.json({ error: `Cannot attach proof to a ${a.payment.status} payment` }, { status: 409 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    const description = typeof form.get('description') === 'string' ? (form.get('description') as string) : undefined;

    try {
        const proof = await uploadProof(a.admin, {
            paymentId: id,
            shipownerId: a.shipownerId,
            uploadedBy: a.userId,
            file,
            description,
        });
        // First proof on an INITIATED wire payment → flip to PROCESSING ("awaiting verification").
        if (a.payment.status === 'INITIATED') {
            await a.admin.from('payments').update({ status: 'PROCESSING' }).eq('id', id);
        }
        return NextResponse.json({ proof });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'upload failed' }, { status: 400 });
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/app/api/owner/payments/[id]/proofs/__tests__/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/owner/payments/
git commit -m "feat(payments): owner route to list + upload payment proofs (v7)"
```

---

### Task 2: Owner proof DELETE route

**Files:**
- Create: `frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/route.ts`
- Test: `frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mockGetUser } }) }));

const storageRemove = vi.fn().mockResolvedValue({ error: null });
const svc: { from: ReturnType<typeof vi.fn>; storage: { from: () => { remove: typeof storageRemove } } } = {
    from: vi.fn(),
    storage: { from: () => ({ remove: storageRemove }) },
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => svc }));

import { DELETE } from '../route';

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

it('deletes an owned proof and reverts to INITIATED when it was the last one', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    let proofDeleted = false;
    svc.from.mockImplementation((table: string) => {
        if (table === 'shipowners') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'own-A' } }) }) }) };
        if (table === 'payments') return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'p1', shipowner_id: 'own-A', status: 'PROCESSING' } }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
        };
        if (table === 'payment_proofs') return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'pr1', payment_id: 'p1', storage_path: 'own-A/p1/x.pdf' } }) }) }) }),
            delete: () => ({ eq: async () => { proofDeleted = true; return { error: null }; } }),
        };
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    });
    // After delete, count remaining proofs = 0
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as never, { params: Promise.resolve({ id: 'p1', proofId: 'pr1' }) });
    expect(res.status).toBe(200);
    expect(proofDeleted).toBe(true);
    expect(storageRemove).toHaveBeenCalledWith(['own-A/p1/x.pdf']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run "src/app/api/owner/payments/[id]/proofs/[proofId]/__tests__/route.test.ts"`
Expected: FAIL — cannot find module `../route`.

- [ ] **Step 3: Write the route**

```typescript
// frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const ATTACHABLE = new Set(['INITIATED', 'PROCESSING']);

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; proofId: string }> }) {
    const { id: paymentId, proofId } = await ctx.params;

    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: shipowner } = await admin.from('shipowners').select('id').eq('profile_id', user.id).maybeSingle();
    if (!shipowner) return NextResponse.json({ error: 'No shipowner record' }, { status: 403 });

    const { data: payment } = await admin.from('payments').select('id, shipowner_id, status').eq('id', paymentId).maybeSingle();
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (payment.shipowner_id !== shipowner.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!ATTACHABLE.has(payment.status)) return NextResponse.json({ error: `Cannot modify proofs on a ${payment.status} payment` }, { status: 409 });

    const { data: proof } = await admin
        .from('payment_proofs').select('id, payment_id, storage_path').eq('id', proofId).eq('payment_id', paymentId).maybeSingle();
    if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });

    await admin.storage.from('payment-proofs').remove([proof.storage_path]);
    const { error: delErr } = await admin.from('payment_proofs').delete().eq('id', proofId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    // If no proofs remain, revert PROCESSING → INITIATED so the admin isn't asked to verify nothing.
    const { count } = await admin
        .from('payment_proofs').select('id', { count: 'exact', head: true }).eq('payment_id', paymentId);
    if ((count ?? 0) === 0 && payment.status === 'PROCESSING') {
        await admin.from('payments').update({ status: 'INITIATED' }).eq('id', paymentId);
    }

    return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run "src/app/api/owner/payments/[id]/proofs/[proofId]/__tests__/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/owner/payments/
git commit -m "feat(payments): owner route to delete a payment proof (reverts status if last)"
```

---

### Task 3: Shared `<ProofUploader>` component

A self-contained, surface-agnostic uploader. The two surfaces pass adapter callbacks; the component owns list/loading/error state.

**Files:**
- Create: `frontend/src/components/payments/ProofUploader.tsx`
- Test: `frontend/src/components/payments/__tests__/ProofUploader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/payments/__tests__/ProofUploader.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProofUploader, type UploadedProof } from '../ProofUploader';

function makeAdapter(initial: UploadedProof[]) {
    const proofs = [...initial];
    return {
        list: vi.fn(async () => [...proofs]),
        upload: vi.fn(async (f: File) => { proofs.push({ id: `id-${proofs.length}`, name: f.name, sizeBytes: f.size, mimeType: f.type }); }),
        remove: vi.fn(async (id: string) => { const i = proofs.findIndex((p) => p.id === id); if (i >= 0) proofs.splice(i, 1); }),
    };
}

describe('ProofUploader', () => {
    it('lists existing proofs on mount', async () => {
        const a = makeAdapter([{ id: 'pr1', name: 'mt103.pdf', sizeBytes: 2048, mimeType: 'application/pdf' }]);
        render(<ProofUploader list={a.list} upload={a.upload} remove={a.remove} />);
        expect(await screen.findByText('mt103.pdf')).toBeInTheDocument();
    });

    it('rejects an oversize file without calling upload', async () => {
        const a = makeAdapter([]);
        render(<ProofUploader list={a.list} upload={a.upload} remove={a.remove} maxSizeBytes={10} />);
        await screen.findByTestId('proof-input');
        const big = new File([new Uint8Array(20)], 'big.pdf', { type: 'application/pdf' });
        fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [big] } });
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(a.upload).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/payments/__tests__/ProofUploader.test.tsx`
Expected: FAIL — cannot find module `../ProofUploader`.

- [ ] **Step 3: Write the component**

```tsx
// frontend/src/components/payments/ProofUploader.tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Trash2, FileText, Loader2 } from 'lucide-react';

export interface UploadedProof {
    id: string;
    name: string;
    sizeBytes: number;
    mimeType: string;
}

interface Props {
    list: () => Promise<UploadedProof[]>;
    upload: (file: File) => Promise<void>;
    remove: (id: string) => Promise<void>;
    maxSizeBytes?: number;
    accept?: string;
    disabled?: boolean;
}

const DEFAULT_MAX = 5 * 1024 * 1024;
const DEFAULT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

export function ProofUploader({ list, upload, remove, maxSizeBytes = DEFAULT_MAX, accept = DEFAULT_ACCEPT, disabled }: Props) {
    const t = useTranslations('OwnerPortal.proofUpload');
    const [proofs, setProofs] = React.useState<UploadedProof[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const refresh = React.useCallback(async () => {
        try { setProofs(await list()); } catch (e) { setError(e instanceof Error ? e.message : 'load failed'); }
    }, [list]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError(null);
        if (file.size > maxSizeBytes) { setError(t('errors.tooLarge', { max: Math.round(maxSizeBytes / 1024 / 1024) })); return; }
        setBusy(true);
        try { await upload(file); await refresh(); }
        catch (err) { setError(err instanceof Error ? err.message : t('errors.uploadFailed')); }
        finally { setBusy(false); }
    }

    async function onRemove(id: string) {
        setBusy(true); setError(null);
        try { await remove(id); await refresh(); }
        catch (err) { setError(err instanceof Error ? err.message : t('errors.deleteFailed')); }
        finally { setBusy(false); }
    }

    return (
        <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-[#10B981] hover:underline">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {t('addButton')}
                <input
                    data-testid="proof-input"
                    type="file"
                    accept={accept}
                    className="hidden"
                    disabled={disabled || busy}
                    onChange={onPick}
                />
            </label>
            <p className="text-[11px] text-[var(--os-text-muted)]">{t('hint', { max: Math.round(maxSizeBytes / 1024 / 1024) })}</p>

            {error && <p role="alert" className="text-xs text-[#EF4444]">{error}</p>}

            <ul className="flex flex-col gap-1.5">
                {proofs.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 py-2">
                        <FileText className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                        <span className="flex-1 truncate text-xs font-mono">{p.name}</span>
                        <span className="text-[10px] text-[var(--os-text-muted)]">{(p.sizeBytes / 1024).toFixed(0)} KB</span>
                        {!disabled && (
                            <button type="button" onClick={() => onRemove(p.id)} disabled={busy} aria-label={t('removeAria', { name: p.name })} className="text-[var(--os-text-muted)] hover:text-[#EF4444]">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/payments/__tests__/ProofUploader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/payments/
git commit -m "feat(payments): shared ProofUploader component (list/add/remove)"
```

---

### Task 4: v7 owner adapter + wire ProofUploader into PayDialog post-confirm

After a WIRE_TRANSFER payment is created, keep the dialog open and show the uploader for the returned payment id.

**Files:**
- Create: `frontend/src/components/owner/ownerProofAdapter.ts`
- Modify: `frontend/src/components/owner/PayDialog/StepConfirm.tsx`

- [ ] **Step 1: Write the owner adapter**

```typescript
// frontend/src/components/owner/ownerProofAdapter.ts
import type { UploadedProof } from '@/components/payments/ProofUploader';

interface ApiProof { id: string; storage_path: string; mime_type: string; size_bytes: number }

const nameOf = (path: string) => path.split('/').pop() ?? path;

export function ownerProofAdapter(paymentId: string) {
    const base = `/api/owner/payments/${paymentId}/proofs`;
    return {
        list: async (): Promise<UploadedProof[]> => {
            const res = await fetch(base);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return (data.proofs as ApiProof[]).map((p) => ({ id: p.id, name: nameOf(p.storage_path), sizeBytes: p.size_bytes, mimeType: p.mime_type }));
        },
        upload: async (file: File): Promise<void> => {
            const fd = new FormData();
            fd.set('file', file);
            const res = await fetch(base, { method: 'POST', body: fd });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
        remove: async (id: string): Promise<void> => {
            const res = await fetch(`${base}/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
    };
}
```

- [ ] **Step 2: Modify StepConfirm to show the uploader after a WIRE initiate**

Replace the `submit()` success tail and the return JSX. After `initiatePayment` for a non-STRIPE rail, if the rail is `WIRE_TRANSFER`, capture the payment id and render the uploader instead of closing.

Add near the top of the component body (after `const router = useRouter();`):

```tsx
    const [wireProofPaymentId, setWireProofPaymentId] = React.useState<string | null>(null);
```

Add the import at the top:

```tsx
import { ProofUploader } from '@/components/payments/ProofUploader';
import { ownerProofAdapter } from '@/components/owner/ownerProofAdapter';
```

In `submit()`, replace the block after the STRIPE redirect check:

```tsx
                if (ctx.rail === 'STRIPE' && 'checkoutUrl' in result && result.checkoutUrl) {
                    window.location.href = result.checkoutUrl as string;
                    return;
                }

                // WIRE_TRANSFER: keep the dialog open and let the owner attach the MT103.
                if (ctx.rail === 'WIRE_TRANSFER' && 'id' in result && typeof result.id === 'string') {
                    setWireProofPaymentId(result.id);
                    ctx.setSubmitting(false);
                    return;
                }
            }
            ctx.reset();
            onClose();
            router.refresh();
```

Add this render branch at the START of the returned JSX (before the existing summary card), so once a wire payment exists, the dialog shows the proof step:

```tsx
    if (wireProofPaymentId) {
        const adapter = ownerProofAdapter(wireProofPaymentId);
        return (
            <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    {t('proofStep.created')}
                </div>
                <p className="text-[11px] text-[var(--os-text-muted)] leading-relaxed">{t('proofStep.intro')}</p>
                <ProofUploader list={adapter.list} upload={adapter.upload} remove={adapter.remove} />
                <div className="flex justify-end mt-2">
                    <OsButton variant="primary" size="sm" onClick={() => { ctx.reset(); onClose(); router.refresh(); }}>
                        {t('proofStep.done')}
                    </OsButton>
                </div>
            </div>
        );
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: EXIT 0 (the new i18n keys `proofStep.*` are added in Task 6; `useTranslations` is untyped at compile time so this passes).

- [ ] **Step 4: Run existing PayDialog test**

Run: `cd frontend && npx vitest run src/components/owner/PayDialog/PayDialog.test.tsx`
Expected: PASS (no regression — the new branch only triggers after a wire initiate).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/owner/
git commit -m "feat(payments): owner can attach MT103 proof after initiating a wire payment"
```

---

### Task 5: Attach-proof action on the owner invoices table

Surface an "Attach proof" action on invoice rows that already have a pending WIRE payment, so owners can add/replace proofs after closing the PayDialog.

**Files:**
- Modify: `frontend/src/app/owner/(portal)/invoices/page.tsx`
- Modify: `frontend/src/app/owner/(portal)/invoices/InvoicesTable.tsx`
- Create: `frontend/src/app/owner/(portal)/invoices/AttachProofDialog.tsx`

- [ ] **Step 1: Extend the page query to map transaction → pending wire payment**

In `page.tsx`, add a 4th parallel query inside the existing `Promise.all` and build a map. After the existing `payments` receipt query, add:

```typescript
        // Pending WIRE payments (owner can still attach/replace proofs).
        session.supabase
            .from('payments')
            .select('id, transaction_id')
            .eq('shipowner_id', session.shipowner.id)
            .eq('rail', 'WIRE_TRANSFER')
            .in('status', ['INITIATED', 'PROCESSING'])
            .not('transaction_id', 'is', null),
```

Destructure it: change `const [txnRes, walletRes, receiptRes] = await Promise.all([` to include `pendingWireRes`. After building `receiptByTxn`, add:

```typescript
    const pendingWireByTxn = new Map<string, string>(); // transaction_id → payment_id
    for (const p of (pendingWireRes.data ?? []) as { id: string; transaction_id: string }[]) {
        pendingWireByTxn.set(p.transaction_id, p.id);
    }
```

Add `pending_wire_payment_id` to each row build:

```typescript
    const rows: InvoiceRow[] = txns.map((t) => ({
        ...t,
        download_url: t.invoice_ref && t.content_hash ? buildDownloadUrl(t.invoice_ref, t.content_hash) : null,
        receipt_ref: receiptByTxn.get(t.id) ?? null,
        pending_wire_payment_id: pendingWireByTxn.get(t.id) ?? null,
    }));
```

- [ ] **Step 2: Extend InvoiceRow + add the action**

In `InvoicesTable.tsx`, add to the `InvoiceRow` interface:

```typescript
    /** Payment id of an INITIATED/PROCESSING wire payment for this invoice, or null. */
    pending_wire_payment_id: string | null;
```

Add state + import:

```tsx
import { Paperclip } from 'lucide-react';
import { AttachProofDialog } from './AttachProofDialog';
// ...
    const [proofTarget, setProofTarget] = React.useState<InvoiceRow | null>(null);
```

In the `actions` column render, before the `isPayable` block, add:

```tsx
                    {r.pending_wire_payment_id && (
                        <button
                            onClick={() => setProofTarget(r)}
                            className="inline-flex items-center gap-1 text-xs text-[var(--os-text-muted)] hover:text-[#10B981] transition-colors"
                            aria-label={`Attach proof for ${r.invoice_ref ?? r.id}`}
                            title="Attach proof of payment"
                        >
                            <Paperclip className="w-3.5 h-3.5" />
                            Proof
                        </button>
                    )}
```

At the end of the returned fragment (after `OpenDisputeDialog`), add:

```tsx
            {proofTarget?.pending_wire_payment_id && (
                <AttachProofDialog
                    open={true}
                    onOpenChange={(o) => !o && setProofTarget(null)}
                    paymentId={proofTarget.pending_wire_payment_id}
                    invoiceRef={proofTarget.invoice_ref ?? proofTarget.id.slice(0, 8)}
                />
            )}
```

- [ ] **Step 3: Create the dialog**

```tsx
// frontend/src/app/owner/(portal)/invoices/AttachProofDialog.tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ProofUploader } from '@/components/payments/ProofUploader';
import { ownerProofAdapter } from '@/components/owner/ownerProofAdapter';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paymentId: string;
    invoiceRef: string;
}

export function AttachProofDialog({ open, onOpenChange, paymentId, invoiceRef }: Props) {
    const t = useTranslations('OwnerPortal.proofUpload');
    if (!open) return null;
    const adapter = ownerProofAdapter(paymentId);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <div className="relative w-full max-w-md mx-4 rounded-2xl border p-5" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                <div className="flex items-start justify-between mb-3">
                    <h2 className="text-base font-semibold text-[var(--os-text-primary)]">{t('dialogTitle', { ref: invoiceRef })}</h2>
                    <button onClick={() => onOpenChange(false)} aria-label="Close"><X className="w-4 h-4 text-[var(--os-text-muted)]" /></button>
                </div>
                <p className="text-[11px] text-[var(--os-text-muted)] mb-3">{t('intro')}</p>
                <ProofUploader list={adapter.list} upload={adapter.upload} remove={adapter.remove} />
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/owner/
git commit -m "feat(payments): attach-proof action on owner invoice rows with pending wire payment"
```

---

### Task 6: i18n for v7 proof upload (EN + FR)

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`

- [ ] **Step 1: Add the `proofUpload` block under `OwnerPortal` in `en.json`**

Add as a new key inside the `OwnerPortal` object (sibling of `payDialog`):

```json
    "proofUpload": {
      "addButton": "Add proof of payment",
      "hint": "PDF or image, up to {max} MB. You can add several files.",
      "dialogTitle": "Proof of payment — {ref}",
      "intro": "Upload your SWIFT MT103 confirmation. An administrator will verify it before the invoice is marked paid.",
      "removeAria": "Remove {name}",
      "errors": {
        "tooLarge": "File is too large (max {max} MB).",
        "uploadFailed": "Upload failed. Please try again.",
        "deleteFailed": "Could not remove the file."
      }
    },
```

- [ ] **Step 2: Add `proofStep` keys inside `OwnerPortal.payDialog` in `en.json`**

```json
        "proofStep": {
          "created": "Wire payment recorded. Awaiting your proof + admin verification.",
          "intro": "Attach your SWIFT MT103 confirmation now (optional — you can also do it later from the invoice list).",
          "done": "Done"
        },
```

- [ ] **Step 3: Add the French equivalents in `fr.json`**

`OwnerPortal.proofUpload`:

```json
    "proofUpload": {
      "addButton": "Ajouter une preuve de paiement",
      "hint": "PDF ou image, jusqu'à {max} Mo. Vous pouvez ajouter plusieurs fichiers.",
      "dialogTitle": "Preuve de paiement — {ref}",
      "intro": "Téléversez votre confirmation SWIFT MT103. Un administrateur la vérifiera avant que la facture soit marquée payée.",
      "removeAria": "Supprimer {name}",
      "errors": {
        "tooLarge": "Fichier trop volumineux (max {max} Mo).",
        "uploadFailed": "Échec du téléversement. Réessayez.",
        "deleteFailed": "Suppression du fichier impossible."
      }
    },
```

`OwnerPortal.payDialog.proofStep`:

```json
        "proofStep": {
          "created": "Virement enregistré. En attente de votre preuve + vérification admin.",
          "intro": "Joignez votre confirmation SWIFT MT103 maintenant (facultatif — possible aussi plus tard depuis la liste des factures).",
          "done": "Terminé"
        },
```

- [ ] **Step 4: Validate JSON parses**

Run: `cd frontend && node -e "require('./messages/en.json'); require('./messages/fr.json'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json
git commit -m "i18n(payments): EN+FR strings for v7 owner proof upload"
```

---

# PHASE 2 — legacy (`/dashboard/invoices`)

### Task 7: Migration 069 — `transactions.payment_proof_files` JSONB

**Files:**
- Create: `supabase/migrations/069_transaction_payment_proof_files.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 069: Legacy payment-proof files on transactions
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The legacy /dashboard/invoices wire-transfer flow has no `payments` row, so it
-- cannot use the v7 `payment_proofs` table. This adds a JSONB array column to
-- hold uploaded proof files directly on the transaction. Each element:
--   { "path": "...", "mime_type": "...", "size_bytes": 123, "uploaded_at": "ISO" }
-- Files live in the existing `payment-proofs` Storage bucket under legacy/<txId>/.
-- Admin validates via the existing mark-paid flow; uploading a proof never
-- changes the transaction status.

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS payment_proof_files JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.transactions.payment_proof_files IS
    'Legacy wire-transfer proof files: array of {path, mime_type, size_bytes, uploaded_at}. v7 payments use payment_proofs table instead.';

-- DOWN: ALTER TABLE public.transactions DROP COLUMN IF EXISTS payment_proof_files;
```

- [ ] **Step 2: Apply to the hosted DB**

Run (from repo root, password from `frontend/.env.local`):

```bash
PW=$(grep '^SUPABASE_DB_PASSWORD=' frontend/.env.local | cut -d= -f2- | tr -d '"\r')
supabase db push --db-url "postgresql://postgres:${PW}@db.dyjolepwxxsedwngkfox.supabase.co:5432/postgres"
```

Expected: applies `069`, hosted `schema_migrations` tip becomes `069`.

- [ ] **Step 3: Verify the column exists**

```bash
URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' frontend/.env.local | cut -d= -f2- | tr -d '"\r')
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' frontend/.env.local | cut -d= -f2- | tr -d '"\r')
curl -s "$URL/rest/v1/transactions?select=id,payment_proof_files&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: JSON row including `"payment_proof_files":[]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/069_transaction_payment_proof_files.sql
git commit -m "feat(payments): mig 069 add transactions.payment_proof_files for legacy proofs"
```

---

### Task 8: Legacy proof route — POST (upload) + DELETE (remove)

**Files:**
- Create: `frontend/src/app/api/transactions/[id]/proof/route.ts`
- Test: `frontend/src/app/api/transactions/[id]/proof/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/app/api/transactions/[id]/proof/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mockGetUser } }) }));

const storageUpload = vi.fn().mockResolvedValue({ error: null });
const svc: Record<string, unknown> = {};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => svc }));

import { POST } from '../route';

function makeReq(): Request {
    const fd = new FormData();
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'mt103.pdf', { type: 'application/pdf' }));
    return new Request('http://x', { method: 'POST', body: fd });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    let savedFiles: unknown[] = [];
    (svc as { from: unknown }).from = (table: string) => {
        if (table === 'transactions') {
            return {
                select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 't1', vessel_id: 'v1', payment_proof_files: savedFiles, status: 'PENDING' } }) }) }),
                update: (patch: { payment_proof_files: unknown[] }) => ({ eq: async () => { savedFiles = patch.payment_proof_files; return { error: null }; } }),
            };
        }
        if (table === 'vessels') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { owner_id: 'u1' } }) }) }) };
        if (table === 'audit_logs') return { insert: async () => ({ error: null }) };
        return {};
    };
    (svc as { storage: unknown }).storage = { from: () => ({ upload: storageUpload }) };
});

it('uploads a proof for a transaction owned by the caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(makeReq() as never, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(200);
    expect(storageUpload).toHaveBeenCalledOnce();
});

it('403 when the caller does not own the vessel', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'someone-else' } } });
    const res = await POST(makeReq() as never, { params: Promise.resolve({ id: 't1' }) });
    expect(res.status).toBe(403);
    expect(storageUpload).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run "src/app/api/transactions/[id]/proof/__tests__/route.test.ts"`
Expected: FAIL — cannot find module `../route`.

- [ ] **Step 3: Write the route**

```typescript
// frontend/src/app/api/transactions/[id]/proof/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { MAX_PROOF_SIZE_BYTES, ALLOWED_PROOF_MIME_TYPES } from '@/services/paymentProofService';

const BUCKET = 'payment-proofs';
const MODIFIABLE = new Set(['PENDING', 'OVERDUE', 'DISPUTED']);

interface ProofEntry { path: string; mime_type: string; size_bytes: number; uploaded_at: string }

async function authorizeTxn(transactionId: string) {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

    const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: txn } = await admin
        .from('transactions').select('id, vessel_id, payment_proof_files, status').eq('id', transactionId).maybeSingle();
    if (!txn) return { error: NextResponse.json({ error: 'Transaction not found' }, { status: 404 }) };

    const { data: vessel } = await admin.from('vessels').select('owner_id').eq('id', txn.vessel_id).maybeSingle();
    if (!vessel || vessel.owner_id !== user.id) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { admin, userId: user.id, txn: txn as { id: string; vessel_id: string; payment_proof_files: ProofEntry[]; status: string } };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const a = await authorizeTxn(id);
    if ('error' in a) return a.error;
    if (!MODIFIABLE.has(a.txn.status)) {
        return NextResponse.json({ error: `Cannot attach proof to a ${a.txn.status} invoice` }, { status: 409 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    if (file.size > MAX_PROOF_SIZE_BYTES) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 });
    if (!ALLOWED_PROOF_MIME_TYPES.has(file.type)) return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 400 });

    const sanitized = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const path = `legacy/${id}/${Date.now()}-${sanitized}`;

    const { error: upErr } = await a.admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return NextResponse.json({ error: `Storage upload failed: ${upErr.message}` }, { status: 400 });

    const entry: ProofEntry = { path, mime_type: file.type, size_bytes: file.size, uploaded_at: new Date().toISOString() };
    const next = [...(a.txn.payment_proof_files ?? []), entry];
    const { error: updErr } = await a.admin.from('transactions').update({ payment_proof_files: next }).eq('id', id);
    if (updErr) {
        await a.admin.storage.from(BUCKET).remove([path]); // best-effort cleanup
        return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    await a.admin.from('audit_logs').insert({
        user_id: a.userId,
        user_full_name: 'Shipowner',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: id,
        details_json: { event: 'PAYMENT_PROOF_UPLOADED', path, size_bytes: file.size },
    });

    return NextResponse.json({ ok: true, proof: entry });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const a = await authorizeTxn(id);
    if ('error' in a) return a.error;
    if (!MODIFIABLE.has(a.txn.status)) {
        return NextResponse.json({ error: `Cannot modify proofs on a ${a.txn.status} invoice` }, { status: 409 });
    }

    const path = new URL(req.url).searchParams.get('path');
    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });

    await a.admin.storage.from(BUCKET).remove([path]);
    const next = (a.txn.payment_proof_files ?? []).filter((p) => p.path !== path);
    const { error } = await a.admin.from('transactions').update({ payment_proof_files: next }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run "src/app/api/transactions/[id]/proof/__tests__/route.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/transactions/
git commit -m "feat(payments): legacy route to upload + delete transaction payment proofs"
```

---

### Task 9: Legacy adapter + ProofUploader in WireTransferModal

**Files:**
- Create: `frontend/src/components/dashboard/invoices/legacyProofAdapter.ts`
- Modify: `frontend/src/components/dashboard/invoices/WireTransferModal.tsx`

- [ ] **Step 1: Write the legacy adapter**

```typescript
// frontend/src/components/dashboard/invoices/legacyProofAdapter.ts
import type { UploadedProof } from '@/components/payments/ProofUploader';

interface ApiEntry { path: string; mime_type: string; size_bytes: number }
const nameOf = (path: string) => path.split('/').pop() ?? path;

export function legacyProofAdapter(transactionId: string) {
    const base = `/api/transactions/${transactionId}/proof`;
    return {
        list: async (): Promise<UploadedProof[]> => {
            const res = await fetch(`${base}/list`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return (data.proofs as ApiEntry[]).map((p) => ({ id: p.path, name: nameOf(p.path), sizeBytes: p.size_bytes, mimeType: p.mime_type }));
        },
        upload: async (file: File): Promise<void> => {
            const fd = new FormData();
            fd.set('file', file);
            const res = await fetch(base, { method: 'POST', body: fd });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
        remove: async (id: string): Promise<void> => {
            const res = await fetch(`${base}?path=${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
    };
}
```

- [ ] **Step 2: Add a GET (list) handler to the legacy route**

The legacy adapter `list()` calls `${base}/list`. Add a sibling route file:

Create `frontend/src/app/api/transactions/[id]/proof/list/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: txn } = await admin.from('transactions').select('vessel_id, payment_proof_files').eq('id', id).maybeSingle();
    if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data: vessel } = await admin.from('vessels').select('owner_id').eq('id', txn.vessel_id).maybeSingle();
    if (!vessel || vessel.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json({ proofs: txn.payment_proof_files ?? [] });
}
```

- [ ] **Step 3: Mount the uploader in WireTransferModal**

In `WireTransferModal.tsx`, add props + imports. Change the props interface to add `transactionId`:

```tsx
interface WireTransferModalProps {
    instructions: WireTransferInstructions;
    invoiceRef: string;
    vesselName: string;
    transactionId: string;
    onClose: () => void;
}
```

Add imports at top:

```tsx
import { ProofUploader } from '@/components/payments/ProofUploader';
import { legacyProofAdapter } from './legacyProofAdapter';
```

Update the signature: `export function WireTransferModal({ instructions, invoiceRef, vesselName, transactionId, onClose }: WireTransferModalProps) {`

Insert a proof section just before the closing notes block (after the `fields.map(...)` `</div>` and before the settlement-notes `<div>`):

```tsx
                    <div className="mt-4 rounded-lg p-3" style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                            Proof of payment (MT103)
                        </p>
                        <ProofUploader {...legacyProofAdapter(transactionId)} />
                    </div>
```

- [ ] **Step 4: Pass `transactionId` from the caller**

In `frontend/src/components/dashboard/invoices/InvoicesPage.tsx`, the `<WireTransferModal>` is rendered from state. Update where `setWireInstructions` is called (in `handlePayNow`) to also store the transaction id, and pass it to the modal. Add `transactionId: tx.id` to the `setWireInstructions({ ... })` object and extend the state type:

```tsx
    const [wireInstructions, setWireInstructions] = React.useState<{
        instructions: WireTransferInstructions;
        invoiceRef: string;
        vesselName: string;
        transactionId: string;
    } | null>(null);
```

```tsx
                setWireInstructions({
                    instructions: result.wireInstructions,
                    invoiceRef: result.wireInstructions.reference.split('/')[1] || tx.ref,
                    vesselName: tx.vesselName,
                    transactionId: tx.id,
                });
```

Find the `<WireTransferModal ... />` render and add `transactionId={wireInstructions.transactionId}`.

- [ ] **Step 5: Typecheck + run the modal test**

Run: `cd frontend && npx tsc --noEmit`
Expected: EXIT 0.
Run: `cd frontend && npx vitest run src/services/__tests__/paymentService.test.ts`
Expected: PASS (no regression).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/transactions/ frontend/src/components/dashboard/invoices/
git commit -m "feat(payments): MT103 proof uploader in legacy WireTransferModal"
```

---

### Task 10: Legacy admin proof visibility (invoice detail + RecordPaymentModal)

The admin must SEE the proof before validating via mark-paid. Surface signed download links for `payment_proof_files`.

> **Read first (not yet inspected during planning):** `frontend/src/components/dashboard/invoices/RecordPaymentModal.tsx`, the `useTransactions` hook, and the `Transaction` type in `frontend/src/types/secure.ts`. Steps 2 and 4 below describe the change in terms of those files' existing patterns — confirm the exact select/map and prop shapes before editing.

**Files:**
- Create: `frontend/src/app/api/transactions/[id]/proof/[idx]/route.ts` (signed-URL redirect for one file, admin or owner)
- Modify: `frontend/src/components/dashboard/invoices/InvoicesPage.tsx` (proof links in the detail panel + a "Proof submitted" badge)
- Modify: `frontend/src/components/dashboard/invoices/RecordPaymentModal.tsx` (proof links)

- [ ] **Step 1: Write the signed-URL route (returns a short-lived URL per proof index)**

```typescript
// frontend/src/app/api/transactions/[id]/proof/[idx]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// GET → { url } : short-lived signed URL for proof file #idx of a transaction.
// Visible to the owning shipowner OR any authenticated staff user (legacy page
// is staff-facing). We keep it simple: any authenticated user who can already
// see the transaction's invoice may view its proof.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; idx: string }> }) {
    const { id, idx } = await ctx.params;
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: txn } = await admin.from('transactions').select('payment_proof_files').eq('id', id).maybeSingle();
    if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const files = (txn.payment_proof_files ?? []) as { path: string }[];
    const n = Number(idx);
    if (!Number.isInteger(n) || n < 0 || n >= files.length) return NextResponse.json({ error: 'Bad index' }, { status: 400 });

    const { data, error } = await admin.storage.from('payment-proofs').createSignedUrl(files[n].path, 60);
    if (error || !data) return NextResponse.json({ error: 'signed url failed' }, { status: 400 });
    return NextResponse.json({ url: data.signedUrl });
}
```

- [ ] **Step 2: Thread `payment_proof_files` into the legacy invoice data**

The legacy `useTransactions` hook feeds `Transaction` objects. Add the proof files to the type and the badge. In `frontend/src/types/secure.ts` (or wherever `Transaction` is defined — grep `interface Transaction`), add:

```typescript
    paymentProofFiles?: { path: string; mime_type: string; size_bytes: number; uploaded_at: string }[];
```

In the hook/query that builds `Transaction` (grep `useTransactions`), select `payment_proof_files` and map it to `paymentProofFiles`. (Follow the existing select/map pattern in that file.)

- [ ] **Step 3: Show a badge + admin links in InvoicesPage detail panel**

In `InvoicesPage.tsx`, in the selected-invoice detail panel, after the status badge, add a "Proof submitted" indicator when files exist:

```tsx
                {selected.paymentProofFiles && selected.paymentProofFiles.length > 0 && (
                    <div className="mt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">
                            Payment proofs ({selected.paymentProofFiles.length})
                        </p>
                        <div className="flex flex-col gap-1">
                            {selected.paymentProofFiles.map((f, i) => (
                                <button
                                    key={f.path}
                                    onClick={async () => {
                                        const res = await fetch(`/api/transactions/${selected.id}/proof/${i}`);
                                        if (res.ok) window.open((await res.json()).url, '_blank', 'noopener');
                                    }}
                                    className="text-left text-xs text-emerald-400 hover:underline"
                                >
                                    {f.path.split('/').pop()}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
```

- [ ] **Step 4: Show the same links in RecordPaymentModal**

In `RecordPaymentModal.tsx`, accept an optional prop `proofFiles?: { path: string }[]` and `transactionId: string`, and render the same button list near the top of the modal body so the admin reviews proofs before recording the payment. (Mirror the JSX from Step 3, using the props.) Pass `proofFiles={recordPaymentTx?.paymentProofFiles}` and `transactionId={recordPaymentTx.id}` where `<RecordPaymentModal>` is rendered in `InvoicesPage.tsx`.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/api/transactions/ frontend/src/components/dashboard/invoices/ frontend/src/types/secure.ts
git commit -m "feat(payments): admin can view legacy payment proofs before mark-paid"
```

---

### Task 11: i18n for legacy proof labels (EN + FR)

The legacy `WireTransferModal` proof section and `InvoicesPage` badge currently use hardcoded English strings (the legacy page is largely English). To stay consistent, route the new strings through `InvoicesPage` translations.

**Files:**
- Modify: `frontend/messages/en.json` (`InvoicesPage`)
- Modify: `frontend/messages/fr.json` (`InvoicesPage`)
- Modify: `frontend/src/components/dashboard/invoices/WireTransferModal.tsx` + `InvoicesPage.tsx` to use the keys

- [ ] **Step 1: Add keys under `InvoicesPage` in `en.json`**

```json
    "proof_section_title": "Proof of payment (MT103)",
    "proof_submitted_label": "Payment proofs ({count})",
```

- [ ] **Step 2: Add the French equivalents in `fr.json`**

```json
    "proof_section_title": "Preuve de paiement (MT103)",
    "proof_submitted_label": "Preuves de paiement ({count})",
```

- [ ] **Step 3: Replace the hardcoded strings**

In `WireTransferModal.tsx`, the modal is rendered inside `InvoicesPage` which already calls `useTranslations('InvoicesPage')`. Pass a `proofTitle` prop from `InvoicesPage` (`t('proof_section_title')`) into `WireTransferModal` and use it instead of the literal `"Proof of payment (MT103)"`. In `InvoicesPage.tsx` replace `Payment proofs ({n})` with `t('proof_submitted_label', { count: selected.paymentProofFiles.length })`.

- [ ] **Step 4: Validate JSON + typecheck**

Run: `cd frontend && node -e "require('./messages/en.json'); require('./messages/fr.json'); console.log('ok')"`
Expected: `ok`.
Run: `cd frontend && npx tsc --noEmit`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/messages/ frontend/src/components/dashboard/invoices/
git commit -m "i18n(payments): EN+FR strings for legacy proof labels"
```

---

# Final verification (run after all tasks)

- [ ] **Full typecheck:** `cd frontend && npx tsc --noEmit` → EXIT 0
- [ ] **Full test suite:** `cd frontend && npx vitest run` → all pass, no regressions
- [ ] **Build:** `cd frontend && npx next build` → green
- [ ] **Manual v7:** as an ACTIVE shipowner, pay a PROFORMA by WIRE → upload step appears → upload an MT103 → reopen via "Proof" action → file listed + removable. In `/admin/payments` the payment shows PROCESSING with the proof in the drawer → confirm → invoice PAID.
- [ ] **Manual legacy:** as the demo armateur on `/dashboard/invoices`, Pay Now → wire modal → upload a proof → "Proof submitted" badge on the invoice. As admin, open the invoice detail → view the proof → mark-paid → PAID.

---

## Notes for the implementer

- **No auto-PAID anywhere.** v7: proof flips INITIATED→PROCESSING only; admin `confirmPayment` does the PAID transition. Legacy: status untouched; admin `mark-paid` does it.
- **Service-role + explicit ownership check** is the security model for every new route — never trust the path param alone.
- **Deferred (not in this plan):** owner-facing `PROOF_SUBMITTED` in-app notification; an admin-notification system; OCR/auto-matching of MT103.
- Vitest path args containing `[id]` must be quoted in the shell (already quoted in the run commands above).
