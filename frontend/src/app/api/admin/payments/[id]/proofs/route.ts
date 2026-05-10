import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
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

    // Use a service-role client for the Storage upload + metadata insert.
    //
    // Mig 059 added an owner-write Storage RLS policy on `payment-proofs`
    // (`current_shipowner_id() IS NOT NULL`) but no admin-on-behalf-of-owner
    // policy. A session-scoped client here would be REJECTED by RLS because
    // `current_shipowner_id()` returns NULL for an admin user.
    //
    // The auth gate is `requireRole(ADMIN_ROLES)` above — service-role here
    // only bypasses Storage RLS, not the route's authorization. Same pattern
    // Plan 7C-1's `initiatePayment` uses for the owner-side payments insert.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const serviceClient = createServiceClient(url, serviceKey);

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
