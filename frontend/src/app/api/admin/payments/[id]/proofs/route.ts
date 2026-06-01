import { NextRequest, NextResponse } from 'next/server';
import { uploadProof } from '@/services/paymentProofService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { assertAdminCanActOn } from '@/lib/auth/adminTenant';

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

    // Service-role for the Storage upload + metadata insert. Mig 059 added an
    // owner-write Storage RLS policy on `payment-proofs` but no admin-on-behalf-of
    // policy, so a session client would be rejected (current_shipowner_id() is NULL
    // for an admin). The auth gate is requireRole(ADMIN_ROLES) above.
    //
    // GreenGate v8: confine the acting admin to the payment's jurisdiction
    // (SUPERADMIN may act on any) before minting the scoped service-role client.
    const platform = createPlatformClient();
    const { data: pmt, error: pmtErr } = await platform
        .from('payments').select('jurisdiction_id').eq('id', paymentId).maybeSingle();
    if (pmtErr) return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    if (!pmt) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    let serviceClient;
    try {
        serviceClient = createTenantClient(await assertAdminCanActOn(auth.user, (pmt as { jurisdiction_id: string }).jurisdiction_id));
    } catch {
        return NextResponse.json({ error: 'Forbidden: payment belongs to another jurisdiction' }, { status: 403 });
    }

    try {
        const result = await uploadProof(serviceClient, {
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
