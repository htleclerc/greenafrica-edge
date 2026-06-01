// frontend/src/app/api/transactions/[id]/proof/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { MAX_PROOF_SIZE_BYTES, ALLOWED_PROOF_MIME_TYPES } from '@/services/paymentProofService';

const BUCKET = 'payment-proofs';
const MODIFIABLE = new Set(['PENDING', 'OVERDUE', 'DISPUTED']);

interface ProofEntry { path: string; mime_type: string; size_bytes: number; uploaded_at: string }

interface AuthorizedTxn {
    id: string;
    vessel_id: string;
    payment_proof_files: ProofEntry[];
    status: string;
}

type AuthorizeResult =
    | { error: NextResponse }
    | { error?: undefined; admin: SupabaseClient; userId: string; txn: AuthorizedTxn };

async function authorizeTxn(transactionId: string): Promise<AuthorizeResult> {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

    // Legacy vessel-owner proof flow (vessels.owner_id = profile). Single-country
    // foundation → UNSCOPED platform client; the owner_id gate below is the guard
    // (agent jurisdiction scoping deferred to Wedge 2).
    const admin = createPlatformClient();

    const { data: txn } = await admin
        .from('transactions').select('id, vessel_id, payment_proof_files, status').eq('id', transactionId).maybeSingle();
    if (!txn) return { error: NextResponse.json({ error: 'Transaction not found' }, { status: 404 }) };

    const { data: vessel } = await admin.from('vessels').select('owner_id').eq('id', txn.vessel_id).maybeSingle();
    if (!vessel || vessel.owner_id !== user.id) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { admin, userId: user.id, txn: txn as AuthorizedTxn };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const a = await authorizeTxn(id);
    if (a.error) return a.error;
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
    if (a.error) return a.error;
    if (!MODIFIABLE.has(a.txn.status)) {
        return NextResponse.json({ error: `Cannot modify proofs on a ${a.txn.status} invoice` }, { status: 409 });
    }

    const path = new URL(req.url).searchParams.get('path');
    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 });

    // IDOR guard: only allow removing a path that belongs to THIS transaction's
    // own proof list (the route uses a service-role client that bypasses Storage
    // RLS, so an unchecked path would let an owner delete arbitrary bucket objects).
    const existing = (a.txn.payment_proof_files ?? []).find((p) => p.path === path);
    if (!existing) return NextResponse.json({ error: 'Proof not found on this transaction' }, { status: 404 });

    await a.admin.storage.from(BUCKET).remove([existing.path]);
    const next = (a.txn.payment_proof_files ?? []).filter((p) => p.path !== existing.path);
    const { error } = await a.admin.from('transactions').update({ payment_proof_files: next }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
}
