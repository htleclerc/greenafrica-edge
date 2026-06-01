import { NextRequest, NextResponse } from 'next/server';
import { getRefundById } from '@/services/refundService';
import { requireRole } from '@/lib/auth/requireRole';
import { adminScopedClient } from '@/lib/auth/adminTenant';
import { UserRole } from '@/types/secure';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: GET /api/admin/refunds/[id]
//
// Single-refund detail for the RefundDetailDrawer. Service-role client (mig
// 052 RLS-with-zero-policies gap). Auth gate via requireRole.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    try {
        const admin = await adminScopedClient(auth.user);
        const refund = await getRefundById(admin, id);
        if (!refund) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        return NextResponse.json({ refund });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
