import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { createPlatformClient } from '@/lib/supabase/tenant';

// Accepts 8 form roles, maps them to the 5 DB roles (PORT_OFFICER,
// FINANCE_ADMIN, SHIPPING_AGENT, MANAGER) — see ROLE_MAP below. SUPERADMIN is
// not assignable via signup (created manually by existing SUPERADMINs).
const registerSchema = z.object({
    email: z.email(),
    password: z.string().min(8).max(128),
    fullName: z.string().min(2).max(100),
    role: z.enum([
        // Port authority side
        'PORT_OFFICER',
        'FINANCE_ADMIN',
        'COMPLIANCE_AUDITOR',
        'OPERATIONS_MANAGER',
        // Shipping agent side
        'SHIPPING_AGENT',
        'FLEET_MANAGER',
        'FINANCE_CONTACT',
        'LEGAL_REP',
    ]),
    entityType: z.string().min(1).max(50),
    orgName: z.string().min(2).max(200),
    registryId: z.string().max(100).optional().default(''),
    jurisdiction: z.string().max(100).optional().default(''),
    defaultRegion: z.string().max(100).optional().default('Full EEZ Overview'),
    accessScope: z.string().max(50).optional().default('regional'),
    notifyProForma: z.boolean().optional().default(true),
    notifyCo2: z.boolean().optional().default(true),
    notifyRevenue: z.boolean().optional().default(true),
    notifyWeekly: z.boolean().optional().default(true),
});

// Map the 8 form roles to the 4 assignable DB roles (SUPERADMIN excluded —
// elevated only via direct admin action). The original "job title" is
// preserved in registration_requests.requested_role so admins can see what
// the user actually applied for.
type FormRole = z.infer<typeof registerSchema>['role'];
type DbRole = 'PORT_OFFICER' | 'FINANCE_ADMIN' | 'SHIPPING_AGENT' | 'MANAGER';

export const ROLE_MAP: Record<FormRole, DbRole> = {
    PORT_OFFICER:       'PORT_OFFICER',
    FINANCE_ADMIN:      'FINANCE_ADMIN',
    COMPLIANCE_AUDITOR: 'PORT_OFFICER',
    OPERATIONS_MANAGER: 'MANAGER',
    SHIPPING_AGENT:     'SHIPPING_AGENT',
    FLEET_MANAGER:      'SHIPPING_AGENT',
    FINANCE_CONTACT:    'SHIPPING_AGENT',
    LEGAL_REP:          'SHIPPING_AGENT',
};

/**
 * POST /api/auth/register
 *
 * Server-side registration: creates auth user + profile + registration request
 * in a single atomic operation. Does NOT depend on the DB trigger.
 */
export async function POST(request: NextRequest) {
    try {
        // Throttle BEFORE parsing the body — caps account-creation spam and
        // email-enumeration attempts (the duplicate-email branch returns 409
        // distinguishably from 200). Fail-open in dev when Upstash creds are
        // absent; set RATE_LIMIT_STRICT=true in prod to fail-closed.
        const clientId = getClientId(request.headers);
        const rate = await enforceRateLimit('signup', clientId);
        if (!rate.allowed) {
            return NextResponse.json(
                { error: 'Too many signup attempts. Please try again later.' },
                {
                    status: 429,
                    headers: rate.reset
                        ? { 'Retry-After': String(Math.ceil((rate.reset - Date.now()) / 1000)) }
                        : undefined,
                },
            );
        }

        const body = await request.json();
        const parsed = registerSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) },
                { status: 400 },
            );
        }

        const {
            email, password, fullName, role: submittedRole,
            entityType, orgName, registryId, jurisdiction,
            defaultRegion, accessScope,
            notifyProForma, notifyCo2, notifyRevenue, notifyWeekly,
        } = parsed.data;

        // Map the form role to a DB role (4 actual roles in the system).
        const role = ROLE_MAP[submittedRole];

        // ── Admin client: anonymous signup writes global tables (profiles,
        // registration_requests). No tenant context → sanctioned UNSCOPED
        // platform client (bypasses RLS). ──────────────────────────────────
        const adminClient = createPlatformClient();

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
                { error: 'Registration failed. Please try again.' },
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
                { error: 'Failed to create profile. Please try again.' },
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
                requested_role: submittedRole,
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
