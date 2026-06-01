import { NextRequest, NextResponse } from 'next/server';
import { listRefundsForAdmin, type RefundStatus } from '@/services/refundService';
import { requireRole } from '@/lib/auth/requireRole';
import { adminScopedClient } from '@/lib/auth/adminTenant';
import { UserRole } from '@/types/secure';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: GET /api/admin/refunds
//
// List endpoint for the /admin/refunds panel. Service-role client because mig
// 052 enables RLS on refunds with zero policies (same gap as wallets and
// notifications). Auth gate via requireRole keeps non-admins out.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];
const VALID_STATUSES = new Set<RefundStatus>(['REQUESTED', 'APPROVED', 'EXECUTED', 'REJECTED']);

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const statusRaw = url.searchParams.get('status');
    const status = statusRaw && VALID_STATUSES.has(statusRaw as RefundStatus)
        ? (statusRaw as RefundStatus)
        : undefined;
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
    const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

    try {
        const admin = await adminScopedClient(auth.user);
        const refunds = await listRefundsForAdmin(admin, { status, offset, limit });
        return NextResponse.json({ refunds });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
