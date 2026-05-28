import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// GET → { url } : short-lived signed URL for proof file #idx of a transaction.
// Any authenticated user may view (the legacy /dashboard page is staff-facing;
// shipowners only ever see their own transactions there). idx is bounds-checked
// against the transaction's own payment_proof_files array.
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
