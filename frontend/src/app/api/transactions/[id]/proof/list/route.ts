// frontend/src/app/api/transactions/[id]/proof/list/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params;
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Legacy vessel-owner proof flow → UNSCOPED platform client (owner_id gate below).
    const admin = createPlatformClient();
    const { data: txn } = await admin.from('transactions').select('vessel_id, payment_proof_files').eq('id', id).maybeSingle();
    if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data: vessel } = await admin.from('vessels').select('owner_id').eq('id', txn.vessel_id).maybeSingle();
    if (!vessel || vessel.owner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    return NextResponse.json({ proofs: txn.payment_proof_files ?? [] });
}
