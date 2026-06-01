import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { UserRole } from '@/types/secure';

// Staff roles that may view ANY transaction's payment proof via the legacy
// staff-facing /dashboard/invoices view. The UserRole enum has no SHIPOWNER
// value — shipowners are external actors tracked via vessels.owner_id and never
// have one of these roles in profiles.role. SHIPPING_AGENT is intentionally
// EXCLUDED: it is "own fleet" scoped (see rbac.ts) so an agent must not read a
// foreign owner's proof; only genuinely-internal staff get the cross-owner view.
const STAFF_ROLES = new Set<string>([
    UserRole.SUPERADMIN,
    UserRole.FINANCE_ADMIN,
    UserRole.PORT_OFFICER,
    UserRole.MANAGER,
]);

// GET → { url } : short-lived signed URL for proof file #idx of a transaction.
// Authorization (IDOR guard): the caller must EITHER own the transaction's
// vessel (vessels.owner_id === user.id) OR be a staff user. The service-role
// client is used only AFTER this gate, for storage signing — storage RLS would
// otherwise block staff who aren't the owner (same reason the sibling routes
// use a service-role client post-authorization).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; idx: string }> }) {
    const { id, idx } = await ctx.params;
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Legacy proof signed-URL flow → UNSCOPED platform client (owner/staff gate below).
    const admin = createPlatformClient();
    const { data: txn } = await admin.from('transactions').select('payment_proof_files, vessel_id').eq('id', id).maybeSingle();
    if (!txn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { data: vessel } = await admin.from('vessels').select('owner_id').eq('id', txn.vessel_id).maybeSingle();
    const isOwner = !!vessel && vessel.owner_id === user.id;

    let isStaff = false;
    if (!isOwner) {
        const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
        isStaff = !!profile && STAFF_ROLES.has(profile.role as string);
    }

    if (!isOwner && !isStaff) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const files = (txn.payment_proof_files ?? []) as { path: string }[];
    const n = Number(idx);
    if (!Number.isInteger(n) || n < 0 || n >= files.length) return NextResponse.json({ error: 'Bad index' }, { status: 400 });

    const { data, error } = await admin.storage.from('payment-proofs').createSignedUrl(files[n].path, 60);
    if (error || !data) return NextResponse.json({ error: 'signed url failed' }, { status: 400 });
    return NextResponse.json({ url: data.signedUrl });
}
