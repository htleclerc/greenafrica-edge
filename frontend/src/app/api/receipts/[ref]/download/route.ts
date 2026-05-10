import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ADMIN_ROLES = new Set(['FINANCE_ADMIN', 'SUPERADMIN']);

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ ref: string }> },
) {
    const { ref } = await ctx.params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Find the payment by receipt_ref
    const { data: payment } = await supabase
        .from('payments')
        .select('id, shipowner_id, receipt_storage_path, receipt_generated_at')
        .eq('receipt_ref', ref)
        .maybeSingle();
    if (!payment || !payment.receipt_storage_path) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    }

    // Auth check: caller must be the shipowner OR a finance admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    const role = profile?.role as string | undefined;
    const isAdmin = role && ADMIN_ROLES.has(role);

    if (!isAdmin) {
        // Verify caller owns this shipowner row
        const { data: ownerLink } = await supabase
            .from('shipowners')
            .select('id')
            .eq('id', payment.shipowner_id)
            .eq('profile_id', user.id)
            .maybeSingle();
        if (!ownerLink) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Issue 5-minute signed URL
    const { data: signed, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(payment.receipt_storage_path as string, 300);
    if (error || !signed) {
        return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 });
    }

    return NextResponse.redirect(signed.signedUrl);
}
