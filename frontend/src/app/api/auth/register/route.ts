import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/auth/register
 *
 * Server-side registration: creates auth user + profile + registration request
 * in a single atomic operation. Does NOT depend on the DB trigger.
 *
 * Body: {
 *   email, password, fullName, role,
 *   entityType, orgName, registryId, jurisdiction,
 *   defaultRegion, accessScope,
 *   notifyProForma, notifyCo2, notifyRevenue, notifyWeekly
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as {
            email: string;
            password: string;
            fullName: string;
            role: string;
            entityType: string;
            orgName: string;
            registryId: string;
            jurisdiction: string;
            defaultRegion: string;
            accessScope: string;
            notifyProForma: boolean;
            notifyCo2: boolean;
            notifyRevenue: boolean;
            notifyWeekly: boolean;
        };

        const {
            email, password, fullName, role,
            entityType, orgName, registryId, jurisdiction,
            defaultRegion, accessScope,
            notifyProForma, notifyCo2, notifyRevenue, notifyWeekly,
        } = body;

        // ── Validation ──────────────────────────────────────────────────────
        if (!email || !password || !fullName || !role || !entityType || !orgName) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 },
            );
        }

        const VALID_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SHIPPING_AGENT'];
        if (!VALID_ROLES.includes(role)) {
            return NextResponse.json(
                { error: 'Invalid role. SUPERADMIN cannot self-register.' },
                { status: 400 },
            );
        }

        // ── Admin client (service_role — bypasses RLS) ──────────────────────
        const adminClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        // ── Check for duplicate email ───────────────────────────────────────
        const { data: existing } = await adminClient
            .from('profiles')
            .select('id')
            .eq('email', email.trim().toLowerCase())
            .limit(1);

        if (existing && existing.length > 0) {
            return NextResponse.json(
                { error: 'An account with this email already exists.' },
                { status: 409 },
            );
        }

        // ── 1. Create auth user via admin API ───────────────────────────────
        // email_confirm: true → user can log in immediately (but is_active=false)
        const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password,
            email_confirm: true,
            user_metadata: {
                full_name: fullName.trim(),
                role,
                is_active: false,
            },
        });

        if (authError) {
            return NextResponse.json(
                { error: authError.message },
                { status: 500 },
            );
        }

        const userId = authData.user.id;

        // ── 2. Explicitly create profile (don't rely on trigger) ────────────
        const { error: profileError } = await adminClient
            .from('profiles')
            .upsert({
                id: userId,
                email: email.trim().toLowerCase(),
                full_name: fullName.trim(),
                role,
                is_active: false,
            }, { onConflict: 'id' });

        if (profileError) {
            // Rollback: delete the auth user if profile creation fails
            await adminClient.auth.admin.deleteUser(userId);
            return NextResponse.json(
                { error: 'Failed to create profile: ' + profileError.message },
                { status: 500 },
            );
        }

        // ── 3. Create registration request for admin review ─────────────────
        const { error: regError } = await adminClient
            .from('registration_requests')
            .insert({
                entity_type: entityType,
                org_name: orgName.trim(),
                org_registry_id: registryId.trim(),
                jurisdiction,
                requested_role: role,
                contact_name: fullName.trim(),
                contact_email: email.trim().toLowerCase(),
                password_hash: '***',
                default_region: defaultRegion || 'Full EEZ Overview',
                access_scope: accessScope || 'regional',
                notify_proforma: notifyProForma ?? true,
                notify_co2: notifyCo2 ?? true,
                notify_revenue: notifyRevenue ?? true,
                notify_weekly: notifyWeekly ?? true,
            });

        if (regError) {
            // Non-blocking: user + profile exist, admin just won't see the request row
            console.warn('Registration request insert failed:', regError.message);
        }

        return NextResponse.json({
            success: true,
            userId,
            message: 'Account created. Awaiting admin approval.',
        });
    } catch (err) {
        console.error('Register API error:', err);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 },
        );
    }
}
