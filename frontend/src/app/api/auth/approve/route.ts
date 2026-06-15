import { NextRequest, NextResponse } from 'next/server';
import { sendRegistrationApprovalEmail } from '@/services/emailService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * POST /api/auth/approve
 * Body: { requestId: string, reviewNote?: string }
 *
 * Called by SUPERADMIN / PORT_OFFICER to approve a registration
 * request. Sets profiles.is_active = true for the user matching the
 * registration email. Updates registration_requests.status = 'APPROVED'.
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

        // Use service_role client for admin operations (bypasses RLS).
        // requireRole already validated the caller — the admin client is only
        // used to perform privileged writes after that gate. Targets global
        // tables (profiles, registration_requests) → UNSCOPED platform client.
        const adminClient = createPlatformClient();

        const { data: regRequest, error: regError } = await adminClient
            .from('registration_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (regError || !regRequest) {
            return NextResponse.json({ error: 'Registration request not found' }, { status: 404 });
        }

        if (regRequest.status === 'APPROVED') {
            return NextResponse.json({ error: 'Already approved' }, { status: 409 });
        }

        const { data: targetProfile, error: profileError } = await adminClient
            .from('profiles')
            .select('id')
            .eq('email', regRequest.contact_email)
            .single();

        if (profileError || !targetProfile) {
            return NextResponse.json({
                error: 'No user account found for this email. The applicant must complete signup first.',
            }, { status: 404 });
        }

        // Only flip is_active. The DB role was already set by /api/auth/register
        // via ROLE_MAP — re-writing it here with regRequest.requested_role would
        // store a form role (e.g. FLEET_MANAGER) into the user_role enum column
        // and raise an enum violation. Single source of truth: register-time mapping.
        const { error: updateError } = await adminClient
            .from('profiles')
            .update({ is_active: true })
            .eq('id', targetProfile.id);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        await adminClient
            .from('registration_requests')
            .update({
                status: 'APPROVED',
                reviewed_by: auth.user.id,
                reviewed_at: new Date().toISOString(),
                review_note: reviewNote ?? null,
            })
            .eq('id', requestId);

        const { data: fullProfile } = await adminClient
            .from('profiles')
            .select('email, full_name, role, operational_site')
            .eq('id', targetProfile.id)
            .single();

        let emailResult: { success: boolean; id?: string; error?: string } = { success: false };
        if (fullProfile?.email) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';
            emailResult = await sendRegistrationApprovalEmail({
                to: fullProfile.email,
                recipientName: fullProfile.full_name || 'User',
                role: fullProfile.role,
                operationalSite: fullProfile.operational_site,
                activationUrl: `${appUrl}/login`,
            });
            if (!emailResult.success) {
                console.error('[Approve] Email failed:', emailResult.error);
            }
        }

        return NextResponse.json({ success: true, userId: targetProfile.id, email: emailResult });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
