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
