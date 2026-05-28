// frontend/src/app/api/owner/payments/[id]/proofs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { uploadProof, listProofs } from '@/services/paymentProofService';

const ATTACHABLE = new Set(['INITIATED', 'PROCESSING']);

interface OwnedPayment { id: string; shipowner_id: string; status: string }

type AuthError = { error: NextResponse };
type AuthOk = { admin: SupabaseClient; payment: OwnedPayment; shipownerId: string; userId: string };
type AuthResult = AuthError | AuthOk;

async function authorize(paymentId: string): Promise<AuthResult> {
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
    const description = typeof form.get('description') === 'string' ? (form.get('description') as string) : undefined;

    try {
        const proof = await uploadProof(a.admin, {
            paymentId: id,
            shipownerId: a.shipownerId,
            uploadedBy: a.userId,
            file,
            description,
        });
        if (a.payment.status === 'INITIATED') {
            await a.admin.from('payments').update({ status: 'PROCESSING' }).eq('id', id);
        }
        return NextResponse.json({ proof });
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'upload failed' }, { status: 400 });
    }
}
