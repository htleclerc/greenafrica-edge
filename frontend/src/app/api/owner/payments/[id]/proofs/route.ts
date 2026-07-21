// frontend/src/app/api/owner/payments/[id]/proofs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTenantClient } from '@/lib/supabase/tenant';
import { uploadProof, listProofs } from '@/services/paymentProofService';

const ATTACHABLE = new Set(['INITIATED', 'PROCESSING']);

interface OwnedPayment { id: string; shipowner_id: string; status: string }

type AuthError = { error: NextResponse };
type AuthOk = { admin: SupabaseClient; payment: OwnedPayment; shipownerId: string; jurisdictionId: string; userId: string };
type AuthResult = AuthError | AuthOk;

async function authorize(paymentId: string): Promise<AuthResult> {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

    // Resolve the caller's own shipowner row (id + home jurisdiction) via the RLS
    // session client — owners may SELECT their own row (mig 024/033). Then scope
    // all privileged ops to that jurisdiction: a payment in another State is
    // simply not found (defense in depth on top of the shipowner_id check below).
    const { data: shipowner, error: shipownerErr } = await session
        .from('shipowners').select('id, jurisdiction_id').eq('profile_id', user.id).maybeSingle();
    if (shipownerErr) return { error: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
    if (!shipowner) return { error: NextResponse.json({ error: 'No shipowner record' }, { status: 403 }) };

    const admin = createTenantClient(shipowner.jurisdiction_id as string);

    const { data: payment, error: paymentErr } = await admin
        .from('payments').select('id, shipowner_id, status').eq('id', paymentId).maybeSingle();
    if (paymentErr) return { error: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) };
    if (!payment) return { error: NextResponse.json({ error: 'Payment not found' }, { status: 404 }) };
    if ((payment as OwnedPayment).shipowner_id !== shipowner.id) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return {
        admin,
        payment: payment as OwnedPayment,
        shipownerId: shipowner.id,
        jurisdictionId: shipowner.jurisdiction_id as string,
        userId: user.id,
    };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
    const { id } = await ctx.params;
    const a = await authorize(id);
    if ('error' in a) return a.error;
    const proofs = await listProofs(a.admin, id);
    return NextResponse.json({ proofs });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
    const { id } = await ctx.params;
    const a = await authorize(id);
    if ('error' in a) return a.error;
    if (!ATTACHABLE.has(a.payment.status)) {
        return NextResponse.json({ error: `Cannot attach proof to a ${a.payment.status} payment` }, { status: 409 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
    const rawDescription = form.get('description');
    const description = typeof rawDescription === 'string' ? rawDescription : undefined;

    try {
        const proof = await uploadProof(a.admin, {
            paymentId: id,
            shipownerId: a.shipownerId,
            uploadedBy: a.userId,
            file,
            description,
        });
        if (a.payment.status === 'INITIATED') {
            // Best-effort: the proof is already uploaded, so a failed status flip must not fail the request.
            const { error: flipErr } = await a.admin.from('payments').update({ status: 'PROCESSING' }).eq('id', id);
            if (flipErr) console.warn('[owner proofs] status flip INITIATED->PROCESSING failed', flipErr.message);
        }
        // Best-effort audit log (parity with the legacy proof route). The proof is
        // already saved, so an audit failure must never fail the request.
        try {
            await a.admin.from('audit_logs').insert({
                user_id: a.userId,
                user_full_name: 'Shipowner',
                action: 'TRANSACTION_UPDATED',
                severity: 'INFO',
                entity_type: 'Payment',
                entity_id: id,
                jurisdiction_id: a.jurisdictionId,
                details_json: { event: 'PAYMENT_PROOF_UPLOADED', proofId: proof.id },
            });
        } catch (auditErr) {
            console.warn('[owner proofs] audit log failed', auditErr instanceof Error ? auditErr.message : auditErr);
        }
        return NextResponse.json({ proof });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'upload failed' }, { status: 400 });
    }
}
