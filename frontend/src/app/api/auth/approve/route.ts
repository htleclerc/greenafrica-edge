import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/approve
 * Body: { requestId: string, reviewNote?: string }
 *
 * Called by SUPERADMIN / PORT_OFFICER to approve a registration request.
 * Sets profiles.is_active = true for the user matching the registration email.
 * Updates registration_requests.status = 'APPROVED'.
 */
export async function POST(request: NextRequest) {
    try {
        const client = await createClient();

        // 1. Verify caller is authenticated + admin
        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: callerProfile } = await client
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!callerProfile || !['SUPERADMIN', 'PORT_OFFICER'].includes(callerProfile.role)) {
            return NextResponse.json({ error: 'Forbidden — admin role required' }, { status: 403 });
        }

        // 2. Parse request body
        const { requestId, reviewNote } = await request.json() as {
            requestId: string;
            reviewNote?: string;
        };

        if (!requestId) {
            return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
        }

        // 3. Use service_role client for admin operations (bypasses RLS)
        const adminClient = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        // 4. Fetch the registration request
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

        // 5. Find the profile by email and activate it
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

        // 6. Activate the profile
        const { error: updateError } = await adminClient
            .from('profiles')
            .update({
                is_active: true,
                role: regRequest.requested_role,
            })
            .eq('id', targetProfile.id);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        // 7. Update registration request status
        await adminClient
            .from('registration_requests')
            .update({
                status: 'APPROVED',
                reviewed_by: user.id,
                reviewed_at: new Date().toISOString(),
                review_note: reviewNote ?? null,
            })
            .eq('id', requestId);

        return NextResponse.json({ success: true, userId: targetProfile.id });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
