// ─────────────────────────────────────────────────────────────────────────────
// Server-side role enforcement helper
// ─────────────────────────────────────────────────────────────────────────────
//
// Resolves the current Supabase session, looks up the role from the profiles
// table (NOT the JWT claims — the JWT is stale if the role changed in DB),
// and asserts the role is in the `allowed` set.
//
// Use at the top of EVERY API route that performs money-rail or admin
// operations. Without this helper, middleware.ts only checks authentication
// presence — any authenticated user can call any admin route.
//
// Pattern:
//
//   export async function POST(request: NextRequest) {
//     const { user, supabase, error } = await requireRole(['SUPERADMIN', 'FINANCE_ADMIN']);
//     if (error) return error;  // 401 or 403, already a NextResponse
//     // ...handler logic with user + supabase
//   }
//
// Or use the wrapper for a more functional style:
//
//   export const POST = withRole(['SUPERADMIN'], async ({ user, supabase, request }) => {
//     // ...handler
//     return NextResponse.json({ ok: true });
//   });
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { UserRole, type SecureUser, OperationalSite } from '@/types/secure';

export interface RequireRoleSuccess {
    user: SecureUser;
    supabase: SupabaseClient;
    error: null;
}

export interface RequireRoleFailure {
    user: null;
    supabase: null;
    error: NextResponse;
}

export type RequireRoleResult = RequireRoleSuccess | RequireRoleFailure;

/**
 * Resolves the current session and asserts the role is allowed.
 * Returns either { user, supabase, error: null } on success or
 * { user: null, supabase: null, error: NextResponse } on failure.
 *
 * Failure responses:
 *   401 — no session
 *   403 — session valid but role not in allowed set, or profile inactive
 *
 * The handler must early-return on `error !== null` to avoid leaking access.
 */
export async function requireRole(allowed: UserRole[]): Promise<RequireRoleResult> {
    const supabase = await createClient();

    // 1. Resolve the session via cookies (set by Supabase SSR middleware).
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
        return {
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        };
    }

    // 2. Re-fetch the role from DB on every call — never trust JWT claims for
    //    role decisions. A SUPERADMIN may have demoted a user since their last
    //    login; the JWT still says SUPERADMIN until refresh, but the DB row is
    //    the source of truth.
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, operational_site, country_code, timezone, preferred_language, is_active, ip_address, can_settle_payments, payments_only')
        .eq('id', authUser.id)
        .single();

    if (profileError || !profile) {
        return {
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Forbidden — profile not found' }, { status: 403 }),
        };
    }

    if (!profile.is_active) {
        return {
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Forbidden — account inactive' }, { status: 403 }),
        };
    }

    const role = profile.role as UserRole;
    if (!allowed.includes(role)) {
        return {
            user: null,
            supabase: null,
            error: NextResponse.json({ error: 'Forbidden — insufficient role' }, { status: 403 }),
        };
    }

    const user: SecureUser = {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        role,
        operationalSite: (profile.operational_site as OperationalSite) ?? OperationalSite.BERBERA_PORT,
        countryCode: profile.country_code ?? 'SO',
        timezone: profile.timezone ?? 'Africa/Mogadishu',
        preferredLanguage: (profile.preferred_language as 'en' | 'fr' | 'pt' | 'sw' | 'ar' | 'so') ?? 'en',
        lastLogin: authUser.last_sign_in_at ?? '',
        ipAddress: profile.ip_address ?? '',
        isActive: profile.is_active,
        canSettlePayments: profile.can_settle_payments === true,
        paymentsOnly: profile.payments_only === true,
    };

    return { user, supabase, error: null };
}

/**
 * Functional wrapper: define handler in terms of (request, ctx) and let the
 * wrapper handle the auth gate. Equivalent to the early-return pattern above.
 *
 * Example:
 *   export const POST = withRole(['SUPERADMIN', 'FINANCE_ADMIN'], async ({ user, supabase, request }) => {
 *     const body = await request.json();
 *     // ...
 *     return NextResponse.json({ ok: true });
 *   });
 */
export function withRole(
    allowed: UserRole[],
    handler: (ctx: { user: SecureUser; supabase: SupabaseClient; request: NextRequest }) => Promise<NextResponse>,
): (request: NextRequest) => Promise<NextResponse> {
    return async (request: NextRequest) => {
        const result = await requireRole(allowed);
        if (result.error) return result.error;
        return handler({ user: result.user, supabase: result.supabase, request });
    };
}
