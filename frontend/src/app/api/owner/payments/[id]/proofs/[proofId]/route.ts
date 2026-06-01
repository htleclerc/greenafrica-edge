// frontend/src/app/api/owner/payments/[id]/proofs/[proofId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createTenantClient } from '@/lib/supabase/tenant';

const ATTACHABLE = new Set(['INITIATED', 'PROCESSING']);

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; proofId: string }> }) {
    const { id: paymentId, proofId } = await ctx.params;

    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Resolve the caller's own shipowner row (id + home jurisdiction) via the RLS
    // session client, then scope the privileged payment/proof ops to that
    // jurisdiction (a payment in another State is simply not found).
    const { data: shipowner, error: ownerErr } = await session.from('shipowners').select('id, jurisdiction_id').eq('profile_id', user.id).maybeSingle();
    if (ownerErr) return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    if (!shipowner) return NextResponse.json({ error: 'No shipowner record' }, { status: 403 });

    const admin = createTenantClient(shipowner.jurisdiction_id as string);

    const { data: payment, error: payErr } = await admin.from('payments').select('id, shipowner_id, status').eq('id', paymentId).maybeSingle();
    if (payErr) return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (payment.shipowner_id !== shipowner.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!ATTACHABLE.has(payment.status)) return NextResponse.json({ error: `Cannot modify proofs on a ${payment.status} payment` }, { status: 409 });

    const { data: proof } = await admin
        .from('payment_proofs').select('id, payment_id, storage_path').eq('id', proofId).eq('payment_id', paymentId).maybeSingle();
    if (!proof) return NextResponse.json({ error: 'Proof not found' }, { status: 404 });

    await admin.storage.from('payment-proofs').remove([proof.storage_path]);
    const { error: delErr } = await admin.from('payment_proofs').delete().eq('id', proofId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    // If no proofs remain, revert PROCESSING -> INITIATED so the admin isn't asked to verify nothing.
    const { count } = await admin
        .from('payment_proofs').select('id', { count: 'exact', head: true }).eq('payment_id', paymentId);
    if ((count ?? 0) === 0 && payment.status === 'PROCESSING') {
        await admin.from('payments').update({ status: 'INITIATED' }).eq('id', paymentId);
    }

    return NextResponse.json({ ok: true });
}
