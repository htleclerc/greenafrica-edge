// ─────────────────────────────────────────────────────────────────────────────
// Server-side guard that resolves the current principal as either an operator
// (shipowner) or a staff member, without requiring callers to know which kind
// of user they are dealing with.
//
// Resolution order:
//   1. If no session → redirect /login
//   2. If a shipowners row exists for this user:
//        ACTIVE   → { kind: 'operator', ... }
//        otherwise → signOut + redirect /login?error=state_<state>
//   3. If no shipowners row → resolve staff via profiles table:
//        profile missing   → redirect /login?error=no_profile
//        is_active = false → redirect /pending-approval
//        otherwise         → { kind: 'staff', ... }
//
// Intentionally does NOT restrict staff by role — callers that need RBAC should
// combine this with their own role check or use requireRole() directly.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { ShipownerListRow } from '@/services/shipownerService';
import { OperationalSite, UserRole, type SecureUser } from '@/types/secure';

// ── Discriminated union ───────────────────────────────────────────────────────

export type Principal =
    | {
          kind: 'operator';
          userId: string;
          email: string;
          shipowner: ShipownerListRow;
          /** The operator's home jurisdiction. Pass to createTenantClient(). */
          jurisdictionId: string;
          supabase: SupabaseClient;
      }
    | {
          kind: 'staff';
          user: SecureUser;
          supabase: SupabaseClient;
      };

// ── Guard ─────────────────────────────────────────────────────────────────────

export async function requirePrincipal(): Promise<Principal> {
    const supabase = await createClient();

    // 1. Resolve session.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) redirect('/login');

    // 2. Attempt operator resolution.
    const { data: shipowner, error: shipownerError } = await supabase
        .from('shipowners')
        .select(
            'id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at, kyc_level_c_completed_at, aoc_number, jurisdiction_id',
        )
        .eq('profile_id', user.id)
        .maybeSingle();

    if (!shipownerError && shipowner) {
        if (shipowner.account_state !== 'ACTIVE') {
            await supabase.auth.signOut();
            redirect(`/login?error=state_${(shipowner.account_state as string).toLowerCase()}`);
        }

        const shipownerRow = shipowner as ShipownerListRow;
        const jurisdictionId = (shipowner as unknown as { jurisdiction_id: string }).jurisdiction_id;

        return {
            kind: 'operator',
            userId: user.id,
            email: user.email ?? shipowner.official_email ?? '',
            shipowner: shipownerRow,
            jurisdictionId,
            supabase,
        };
    }

    // 3. Staff resolution — re-fetch role from DB, never trust the JWT.
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select(
            'id, email, full_name, role, operational_site, country_code, timezone, preferred_language, is_active, ip_address',
        )
        .eq('id', user.id)
        .single();

    if (profileError || !profile) {
        redirect('/login?error=no_profile');
    }

    if (!profile.is_active) {
        redirect('/pending-approval');
    }

    const staffUser: SecureUser = {
        id: profile.id as string,
        email: profile.email as string,
        fullName: profile.full_name as string,
        role: profile.role as UserRole,
        operationalSite: (profile.operational_site as OperationalSite) ?? OperationalSite.BERBERA_PORT,
        countryCode: (profile.country_code as string) ?? 'SO',
        timezone: (profile.timezone as string) ?? 'Africa/Mogadishu',
        preferredLanguage: (profile.preferred_language as 'en' | 'fr' | 'pt' | 'sw' | 'ar' | 'so') ?? 'en',
        lastLogin: user.last_sign_in_at ?? '',
        ipAddress: (profile.ip_address as string) ?? '',
        isActive: profile.is_active as boolean,
    };

    return { kind: 'staff', user: staffUser, supabase };
}
