import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { approveRegistrationRequest } from '@/services/registrationApproval';

/**
 * POST /api/auth/approve
 * Body: { requestId: string, reviewNote?: string }
 *
 * Called by SUPERADMIN / PORT_OFFICER to approve a registration request. The
 * work itself lives in `approveRegistrationRequest` so that the unified
 * validation queue (`/admin/validations`) approves accounts through exactly the
 * same path; this route is the HTTP shell around it.
 */
const APPROVER_ROLES = [UserRole.SUPERADMIN, UserRole.PORT_OFFICER];

export async function POST(request: NextRequest) {
    const auth = await requireRole(APPROVER_ROLES);
    if (auth.error) return auth.error;

    try {
        const { requestId, reviewNote } = await request.json() as {
            requestId: string;
            reviewNote?: string;
        };

        if (!requestId) {
            return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
        }

        const result = await approveRegistrationRequest(requestId, reviewNote ?? null, auth.user.id);
        if (!result.ok) {
            return NextResponse.json({ error: result.reason }, { status: result.status });
        }

        return NextResponse.json({
            success: true,
            userId: result.userId,
            email: { success: result.emailSent },
        });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
