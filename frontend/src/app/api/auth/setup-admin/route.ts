import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';

const setupAdminSchema = z.object({
    email: z.email(),
    password: z.string().min(12).max(128),
    fullName: z.string().min(2).max(100),
    setupSecret: z.string().min(1),
});

/**
 * POST /api/auth/setup-admin
 *
 * Bootstrap route to create the first SUPERADMIN user.
 * Protected by SETUP_SECRET env var — only works when no SUPERADMIN exists yet.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const parsed = setupAdminSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }

        const { email, password, fullName, setupSecret } = parsed.data;

        // Verify the setup secret with constant-time comparison
        const expectedSecret = process.env.SETUP_SECRET;
        if (!expectedSecret) {
            return NextResponse.json({ error: 'Setup not configured' }, { status: 403 });
        }

        const secretBuffer = Buffer.from(setupSecret, 'utf8');
        const expectedBuffer = Buffer.from(expectedSecret, 'utf8');
        if (secretBuffer.length !== expectedBuffer.length || !timingSafeEqual(secretBuffer, expectedBuffer)) {
            return NextResponse.json({ error: 'Invalid setup secret' }, { status: 403 });
        }

        // Use service_role for admin operations
        const adminClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        // Check if a SUPERADMIN already exists
        const { data: existingAdmin } = await adminClient
            .from('profiles')
            .select('id')
            .eq('role', 'SUPERADMIN')
            .eq('is_active', true)
            .limit(1);

        if (existingAdmin && existingAdmin.length > 0) {
            return NextResponse.json({
                error: 'A SUPERADMIN already exists. Use the dashboard to manage users.',
            }, { status: 409 });
        }

        // Create the user in Supabase Auth with admin API
        // This bypasses email confirmation
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
                role: 'SUPERADMIN',
                is_active: true,
            },
        });

        if (authError) {
            return NextResponse.json({ error: 'Failed to create admin account' }, { status: 500 });
        }

        // Explicitly create/update profile (don't rely on trigger alone)
        if (authData.user) {
            await adminClient
                .from('profiles')
                .upsert({
                    id: authData.user.id,
                    email,
                    full_name: fullName,
                    role: 'SUPERADMIN',
                    is_active: true,
                }, { onConflict: 'id' });
        }

        return NextResponse.json({
            success: true,
            userId: authData.user?.id,
            message: 'SUPERADMIN created and activated. You can now login.',
        });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
